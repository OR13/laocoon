#!/usr/bin/env bash
# Daily run: crawl, then rebuild the projections.
#
# 100% local — Bun and Python only, no hosted model, no token spend. Intended to
# be driven by launchd, following the com.tradeverifyd.orie-morning-briefing
# pattern. Not installed by this script: scheduling is the operator's decision.
#
#   LAOCOON_IMAP_EMAIL=you@example.org scripts/daily.sh
#   LAOCOON_MODE=full scripts/daily.sh        # weekly reconciliation
#
# The repository root is resolved from this script's own location, never
# hardcoded, so it works in a worktree and in a fresh clone.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIST="${LAOCOON_LIST:-agentproto}"
MODE="${LAOCOON_MODE:-incremental}"

if [[ -z "${LAOCOON_IMAP_EMAIL:-}" ]]; then
  echo "LAOCOON_IMAP_EMAIL must be set: anonymous IETF IMAP uses a contact address." >&2
  exit 2
fi

bun --cwd "$ROOT" run ingest --list "$LIST" --mode "$MODE"
bun --cwd "$ROOT" run graph --list "$LIST"

# Identity resolution and the seed touch the datatracker and write only to
# private/. People already recorded are not re-asked; --refresh does that, and
# is a weekly-or-slower job, not a daily one.
bun --cwd "$ROOT" run resolve
bun --cwd "$ROOT" run seed
bun --cwd "$ROOT" run reputation --list "$LIST"

# Substance classification is local inference and is the slow step. It is
# incremental: only replies with no verdict under the current prompt are sent to
# a model. Verdicts stay in private/; only their per-thread aggregate is public.
bun --cwd "$ROOT" run classify
bun --cwd "$ROOT" run agreement
bun --cwd "$ROOT" run measure --list "$LIST"
bun --cwd "$ROOT" run holdout --list "$LIST"

# Build the static site. Building is not publishing: nothing is deployed here.
bun --cwd "$ROOT" run site

# The operator's private view, which names participants. Written under private/,
# which is gitignored and which the site build cannot reach.
bun --cwd "$ROOT" run private-view

bun --cwd "$ROOT" run stats

# Committing is safe: the log is append-only and the working tree carries nothing
# else. Pushing is not done here — this is a public repository and publishing is
# an operator decision.
if [[ -n "$(git -C "$ROOT" status --porcelain events)" ]]; then
  git -C "$ROOT" add events
  git -C "$ROOT" commit -m "Record $LIST crawl of $(date -u +%Y-%m-%d)"
  echo "Committed. Not pushed: publishing is an operator decision."
fi
