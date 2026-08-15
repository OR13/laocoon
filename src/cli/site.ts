#!/usr/bin/env bun
/**
 * Build the public static site with Next.js.
 *
 *   bun run site
 *
 * Runs `next build` in `web/` with LAOCOON_PRIVATE unset, then copies the export
 * to `site/`. It does **not** deploy: this is a public repository and publishing
 * is the operator's decision (INVARIANTS.md #5).
 *
 * Two guards, both after the fact, because a published file cannot be
 * unpublished:
 *
 *   1. the private page's file is `page.private.tsx`, and `private.tsx` is only
 *      in Next's `pageExtensions` for the private build — so the public export
 *      has no such route at all;
 *   2. every exported byte is scanned for a sender hash. The classifier's prompt
 *      hash is the same shape and is allowed by name, never by loosening the
 *      pattern.
 */
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { assertNoSenderHash } from "../site/publishable.ts";
import { PROMPT_HASH } from "../classify/prompt.ts";
import { repoPath } from "../lib/paths.ts";

const WEB = repoPath("web");
const EXPORT = join(WEB, ".next-public");
const SITE = repoPath("site");

const proc = Bun.spawn(["bun", "run", "build"], {
  cwd: WEB,
  env: { ...process.env, LAOCOON_PRIVATE: "" },
  stdout: "inherit",
  stderr: "inherit",
});
if ((await proc.exited) !== 0) throw new Error("next build failed");

/** Every file in the export, recursively. */
async function* files(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else yield path;
  }
}

const TEXT = /\.(html|json|js|css|txt|map)$/;
let scanned = 0;
for await (const path of files(EXPORT)) {
  if (!TEXT.test(path)) continue;
  scanned += 1;
  assertNoSenderHash(path.slice(EXPORT.length + 1), await Bun.file(path).text(), [PROMPT_HASH]);
  if (path.includes("/private/")) {
    throw new Error(`public export contains a private route: ${path}`);
  }
}

await rm(SITE, { recursive: true, force: true });
await mkdir(SITE, { recursive: true });
await cp(EXPORT, SITE, { recursive: true });

const pages: string[] = [];
for await (const path of files(SITE)) {
  if (path.endsWith(".html")) pages.push(path.slice(SITE.length + 1));
}

console.log(
  JSON.stringify(
    { out: SITE, pages: pages.sort(), files_scanned: scanned },
    null,
    2,
  ),
);
console.log(
  `\nNo sender hash in any exported byte, and no private route. ` +
    `Not deployed: publishing is the operator's decision.`,
);
