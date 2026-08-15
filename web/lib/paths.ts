import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root — one level above `web/`. Never hardcode an absolute path. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const repoPath = (...parts: string[]) => join(REPO_ROOT, ...parts);
export const EVENTS_DIR = repoPath("events");
export const ARTIFACTS_DIR = repoPath("artifacts");
export const PRIVATE_DIR = repoPath("private");

/** True only for the private build. Set by `bun run private-view`. */
export const IS_PRIVATE_BUILD = process.env.LAOCOON_PRIVATE === "1";
