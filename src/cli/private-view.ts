#!/usr/bin/env bun
/**
 * Build the operator's private view.
 *
 *   bun run private-view
 *
 * Recomputes the graph data, then runs `next build` with LAOCOON_PRIVATE=1 —
 * which is the only condition under which the private page's file counts as a
 * route — and copies the export to `private/views/`.
 *
 * **This is the one view that names people.** PROBLEM.md §7 makes per-person
 * data private *to Orie*: private, not nonexistent. The published dashboard
 * shows counts; this shows the individuals behind them, because that is what
 * the operator needs to actually read the list.
 *
 * It cannot escape: it is written under `private/` and this command refuses any
 * other path, `private/` is gitignored, and the public build has no such route.
 *
 * `--serve` starts a local static server and prints the URL. A Next export
 * references its assets from the site root, so opening the HTML directly with
 * `file://` loads no CSS and no JavaScript — the page appears as unstyled text
 * with no graph. Serving is not a convenience here, it is how the page works.
 * The server binds to loopback only.
 */
import { cp, mkdir, rm } from "node:fs/promises";
import { join, normalize } from "node:path";
import { parseArgs } from "node:util";
import { PRIVATE_DIR, repoPath } from "../lib/paths.ts";

const { values } = parseArgs({
  options: { serve: { type: "boolean", default: false }, port: { type: "string", default: "4173" } },
});

const WEB = repoPath("web");
const EXPORT = join(WEB, ".next-private");
const OUT = join(PRIVATE_DIR, "views");

if (!OUT.startsWith(PRIVATE_DIR + "/")) {
  throw new Error(`refusing to write a named-participant view outside private/: ${OUT}`);
}

const seedPath = join(PRIVATE_DIR, "artifacts", "seed.json");
if (!(await Bun.file(seedPath).exists())) {
  throw new Error(`no ${seedPath}: run \`bun run seed\` first`);
}

// Recompute the graph data so the page always matches the current log.
const data = Bun.spawn(
  [
    "uv", "run", "--quiet", "--directory", repoPath("python"),
    "python", "-m", "laocoon.private_view",
    "--events", repoPath("events"),
    "--seed", seedPath,
    "--reputation", join(PRIVATE_DIR, "artifacts", "reputation.json"),
    "--measures", repoPath("artifacts", "thread-measures.json"),
    "--out", join(PRIVATE_DIR, "artifacts", "sender-view.json"),
  ],
  { stdout: "inherit", stderr: "inherit" },
);
if ((await data.exited) !== 0) throw new Error("laocoon.private_view failed");

const build = Bun.spawn(["bun", "run", "build"], {
  cwd: WEB,
  env: { ...process.env, LAOCOON_PRIVATE: "1" },
  stdout: "inherit",
  stderr: "inherit",
});
if ((await build.exited) !== 0) throw new Error("next build (private) failed");

const page = join(EXPORT, "private", "graph", "index.html");
if (!(await Bun.file(page).exists())) {
  throw new Error(`private build produced no ${page}`);
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
await cp(EXPORT, OUT, { recursive: true });

const entry = join(OUT, "private", "graph", "index.html");
console.log(JSON.stringify({ out: entry }, null, 2));
console.log(
  `\nPRIVATE. Named participants. gitignored, never published, and the public ` +
    `build has no such route.`,
);

if (values.serve) {
  const handler = {
    hostname: "127.0.0.1", // loopback only: this page names people
    async fetch(request: Request) {
      const url = new URL(request.url);
      // normalize() collapses any ".." before it can climb out of OUT.
      const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
      for (const candidate of [join(OUT, rel), join(OUT, rel, "index.html")]) {
        if (!candidate.startsWith(OUT)) continue;
        const file = Bun.file(candidate);
        if (await file.exists()) {
          const stat = await file.stat();
          if (!stat.isDirectory()) return new Response(file);
        }
      }
      return new Response("not found", { status: 404 });
    },
  } as const;

  // Prefer the requested port so a bookmark keeps working, but fall back to an
  // OS-assigned one rather than failing because something else holds it.
  let server;
  try {
    server = Bun.serve({ ...handler, port: Number(values.port) });
  } catch {
    server = Bun.serve({ ...handler, port: 0 });
    console.warn(`port ${values.port} was busy; using ${server.port} instead`);
  }
  console.log(
    `\nServing on http://127.0.0.1:${server.port}/private/graph/  (Ctrl-C to stop)`,
  );
}
