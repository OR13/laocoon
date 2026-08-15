/**
 * Path resolution. Never hardcode an absolute path: everything is resolved from
 * this file's own location, so the tree works in a worktree, a fresh clone, and
 * on a machine that is not the author's.
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root — two levels above `src/lib/`. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function repoPath(...parts: string[]): string {
  return join(REPO_ROOT, ...parts);
}

/** Committed, append-only event log. */
export const EVENTS_DIR = repoPath("events");

/** Derived projections. Gitignored: regenerating them is cheap, committing a
 *  full regenerated graph every day is exactly the snapshot bloat PROBLEM.md
 *  section 9 forbids. */
export const ARTIFACTS_DIR = repoPath("artifacts");

/** Per-person data. Gitignored, and must stay that way. */
export const PRIVATE_DIR = repoPath("private");

/** Local caches — message bodies, crawl watermarks. Gitignored. */
export const CACHE_DIR = repoPath(".cache");
