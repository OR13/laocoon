#!/usr/bin/env bun
/**
 * Cluster threads into topics and score reply novelty, per list.
 *
 *   bun run topics
 *
 * Clustering runs on embeddings; the model only names the result, so a bad
 * label cannot corrupt the structure. The distance threshold is calibrated
 * against how well "same topic" predicts "these threads share a participant",
 * and compared with normalising the subject line — if subject matching wins,
 * the report says so.
 */
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { assertNoSenderHash } from "../site/publishable.ts";
import { EMBED_MODEL, EMBED_VARIANT } from "../classify/embed.ts";
import { ARTIFACTS_DIR, CACHE_DIR, repoPath } from "../lib/paths.ts";

const config = parseYaml(await Bun.file(repoPath("lists.yaml")).text()) as {
  lists: { name: string; enabled: boolean }[];
};
const cache = join(CACHE_DIR, "embeddings", `${EMBED_MODEL}__${EMBED_VARIANT}`);

for (const list of config.lists.filter((l) => l.enabled)) {
  const out = join(ARTIFACTS_DIR, `topics-${list.name}.json`);
  const proc = Bun.spawn(
    [
      "uv", "run", "--quiet", "--directory", repoPath("python"),
      "python", "-m", "laocoon.topics",
      "--events", repoPath("events"),
      "--cache", cache,
      "--out", out,
      "--list", list.name,
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  if ((await proc.exited) !== 0) throw new Error(`topics failed for ${list.name}`);
  assertNoSenderHash(`topics-${list.name}.json`, await Bun.file(out).text());
}
console.log(`\nno sender hash in any topics artifact`);
