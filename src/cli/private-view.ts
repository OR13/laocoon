#!/usr/bin/env bun
/**
 * The operator's private view: named senders, who replied to whom, and which
 * threads each took part in.
 *
 *   bun run private-view
 *
 * **This is the one view that names people.** PROBLEM.md section 7 makes
 * per-person data private *to Orie* — private, not nonexistent. The published
 * dashboard shows counts; this shows the individuals behind them, because that
 * is what the operator needs to actually read the list.
 *
 * Three things keep it from leaking:
 *   * it is written under `private/`, and refuses to write anywhere else;
 *   * `private/` is gitignored, and the site build reads only the public log;
 *   * the source artifact declares `publication: private`, which the site
 *     build rejects on sight.
 *
 * Names come from `private/senders.jsonl`, the local address book that
 * ingestion writes and that never enters the public log.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { PRIVATE_DIR, repoPath } from "../lib/paths.ts";
import { escapeHtml } from "../site/render.ts";
import { renderPrivateView, type SenderView } from "../site/private-render.ts";

const artifactPath = join(PRIVATE_DIR, "artifacts", "sender-view.json");
const seedPath = join(PRIVATE_DIR, "artifacts", "seed.json");
const outPath = join(PRIVATE_DIR, "views", "senders.html");

if (!outPath.startsWith(PRIVATE_DIR + "/")) {
  throw new Error(`refusing to write a named-participant view outside private/: ${outPath}`);
}

if (!(await Bun.file(seedPath).exists())) {
  throw new Error(`no ${seedPath}: run \`bun run seed\` first`);
}

// Recompute the view data so it always matches the current log.
const proc = Bun.spawn(
  [
    "uv", "run", "--quiet", "--directory", repoPath("python"),
    "python", "-m", "laocoon.private_view",
    "--events", repoPath("events"),
    "--seed", seedPath,
    "--reputation", join(PRIVATE_DIR, "artifacts", "reputation.json"),
    "--out", artifactPath,
  ],
  { stdout: "pipe", stderr: "inherit" },
);
if ((await proc.exited) !== 0) throw new Error("laocoon.private_view failed");

const view = (await Bun.file(artifactPath).json()) as SenderView;
if (view.publication !== "private") {
  throw new Error(`sender view is not marked private: ${artifactPath}`);
}

/** sender_id -> the best display name we have, from the local address book. */
const names = new Map<string, { name: string; address: string }>();
const book = Bun.file(join(PRIVATE_DIR, "senders.jsonl"));
if (await book.exists()) {
  for (const line of (await book.text()).split("\n")) {
    if (!line.trim()) continue;
    const r = JSON.parse(line) as { sender_id: string; address: string; display_name: string };
    const existing = names.get(r.sender_id);
    // Prefer a record that actually has a display name.
    if (!existing || (!existing.name && r.display_name)) {
      names.set(r.sender_id, { name: r.display_name, address: r.address });
    }
  }
}

const html = renderPrivateView(view, names, escapeHtml);
await mkdir(join(PRIVATE_DIR, "views"), { recursive: true });
await Bun.write(outPath, html);

const named = view.senders.filter((s) => names.has(s.sender_id)).length;
console.log(
  JSON.stringify(
    {
      out: outPath,
      senders: view.senders.length,
      with_a_name: named,
      edges: view.edges.length,
      threads: view.threads.length,
    },
    null,
    2,
  ),
);
console.log(
  `\nPRIVATE. Named participants. gitignored, never published, and the site ` +
    `build cannot reach it.`,
);
