#!/usr/bin/env bash
#
# Build the public site and publish it to GitHub Pages.
#
# The site cannot be built in CI: it reads artifacts regenerated locally from
# private events and local embeddings, and a runner has neither. So the build
# runs here, where the data and the publishability scan live, and only the
# sanitized `site/` output leaves the machine. That output is pushed to the
# `gh-pages` branch, and the `pages.yml` workflow hands the branch to
# actions/deploy-pages. Nothing about the private build is ever published.
#
#   bun run deploy
#
# Prerequisites, one time: enable Pages with source "GitHub Actions"
#   gh api repos/<owner>/<repo>/pages -X POST -f build_type=workflow
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

REMOTE="$(git config --get remote.origin.url)"
HEAD_SHA="$(git rev-parse --short HEAD)"
NAME="$(git config user.name || echo laocoon-deploy)"
EMAIL="$(git config user.email || echo laocoon-deploy@localhost)"

echo "==> Building site with base path /laocoon (runs the publishability scan)"
NEXT_PUBLIC_BASE_PATH=/laocoon bun run src/cli/site.ts

test -f site/index.html || { echo "site/ did not build" >&2; exit 1; }
# GitHub Pages skips underscore-prefixed dirs (Jekyll) unless this is present.
touch site/.nojekyll

echo "==> Publishing site/ to the gh-pages branch"
(
  cd site
  rm -rf .git
  git init -q
  git checkout -q -b gh-pages
  git add -A
  git -c user.name="$NAME" -c user.email="$EMAIL" \
    commit -qm "Deploy site built from ${HEAD_SHA}"
  git push -qf "$REMOTE" gh-pages
  rm -rf .git
)

echo "==> Triggering the Pages deploy workflow"
if gh workflow run pages.yml >/dev/null 2>&1; then
  echo "    Deploy started. Follow it with:  gh run watch"
else
  echo "    Pushed gh-pages, but could not start the workflow."
  echo "    Enable Pages (Settings -> Pages -> Source: GitHub Actions), then run:"
  echo "      gh workflow run pages.yml"
fi
