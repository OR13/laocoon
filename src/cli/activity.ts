#!/usr/bin/env bun
/**
 * Build the daily activity rollup and the thread co-participation graph.
 *
 *   bun run activity
 *
 * Both are `aggregate_public`: every figure is a count over a day or a thread,
 * and no account appears. That is what lets the dashboard show a trend line and
 * a graph without publishing a ranked participant list. Verified here rather
 * than assumed — the artifact is scanned for a sender hash before it is kept.
 */
import { join } from "node:path";
import { assertNoSenderHash } from "../site/publishable.ts";
import { parse as parseYaml } from "yaml";
import { ARTIFACTS_DIR, PRIVATE_DIR, repoPath } from "../lib/paths.ts";

const config = parseYaml(await Bun.file(repoPath("lists.yaml")).text()) as {
  lists: { name: string; enabled: boolean }[];
};
const lists = config.lists.filter((l) => l.enabled);

const seedPath = join(PRIVATE_DIR, "artifacts", "seed.json");
if (!(await Bun.file(seedPath).exists())) throw new Error(`no ${seedPath}: run \`bun run seed\``);

const out = join(ARTIFACTS_DIR, "activity.json");
const proc = Bun.spawn(
  [
    "uv", "run", "--quiet", "--directory", repoPath("python"),
    "python", "-m", "laocoon.activity",
    "--events", repoPath("events"),
    "--private-events", join(PRIVATE_DIR, "events"),
    "--seed", seedPath,
    "--out", out,
    ...lists.flatMap((l) => ["--list", l.name]),
  ],
  { stdout: "inherit", stderr: "inherit" },
);
if ((await proc.exited) !== 0) throw new Error("laocoon.activity failed");

const text = await Bun.file(out).text();
assertNoSenderHash("activity.json", text);
const artifact = JSON.parse(text) as { publication: string };
if (artifact.publication !== "aggregate_public") {
  throw new Error(`activity.json is not marked aggregate_public`);
}
console.log(`\nactivity.json contains no sender hash and is marked aggregate_public`);
