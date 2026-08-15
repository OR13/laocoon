#!/usr/bin/env bun
/**
 * Name each topic cluster with the local 31b model.
 *
 *   bun run name-topics
 *
 * Naming happens *after* clustering and never feeds back into it, so a bad
 * label cannot corrupt the structure — the worst it can do is mislabel a group
 * whose membership is already fixed by the embeddings.
 *
 * Only clusters holding more than one thread are named. A single-thread cluster
 * already has a perfectly good name: its subject line. Naming them all would
 * cost roughly 40 minutes of local inference to relabel things that are already
 * labelled.
 */
import { parseArgs } from "node:util";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { OllamaClient } from "../classify/ollama.ts";
import { sha256 } from "../lib/hash.ts";
import { ARTIFACTS_DIR, repoPath } from "../lib/paths.ts";

const { values } = parseArgs({
  options: { model: { type: "string", default: "gemma4:31b" }, "min-threads": { type: "string", default: "2" } },
});

/**
 * The naming prompt. Like the substance prompt it forbids speculation about how
 * anything was written — a model asked to summarise will otherwise volunteer it.
 */
export const TOPIC_PROMPT = `You are naming a cluster of related discussion threads from a technical standards mailing list.

Below are the subject lines of every thread in the cluster. Give the cluster a short name describing the technical subject they have in common.

Do not speculate about who wrote anything or how it was produced. Name the subject matter only.

Rules:
- at most 6 words
- no leading "Re:", no list tag, no trailing punctuation
- describe the topic, not the activity: "session lifecycle and correlation", not "discussion about sessions"

SUBJECTS:
{{subjects}}

Respond with JSON only: {"name": "<at most 6 words>"}`;

const PROMPT_HASH = sha256(TOPIC_PROMPT);

const config = parseYaml(await Bun.file(repoPath("lists.yaml")).text()) as {
  lists: { name: string; enabled: boolean }[];
};
const ollama = new OllamaClient();
const minThreads = Number(values["min-threads"]);

for (const list of config.lists.filter((l) => l.enabled)) {
  const path = join(ARTIFACTS_DIR, `topic-tree-${list.name}.json`);
  if (!(await Bun.file(path).exists())) continue;
  const artifact = (await Bun.file(path).json()) as {
    topics: { id: string; subjects: string[]; thread_count: number; label: string | null }[];
    topic_naming?: unknown;
  };
  if (artifact.topics.length === 0) {
    console.log(JSON.stringify({ list: list.name, topics: 0, note: "nothing to name" }));
    continue;
  }

  let named = 0;
  let inherited = 0;
  const started = Date.now();
  for (const topic of artifact.topics) {
    if (topic.thread_count < minThreads) {
      // Its own subject is already the best name it could have.
      topic.label = topic.subjects[0]?.replace(/^\[[^\]]+\]\s*/, "").replace(/^((Re|Fwd):\s*)+/i, "") ?? topic.id;
      inherited += 1;
      continue;
    }
    const prompt = TOPIC_PROMPT.replace("{{subjects}}", topic.subjects.slice(0, 25).join("\n"));
    try {
      const { text } = await ollama.generateJson(values.model!, prompt, 60);
      const parsed = JSON.parse(text) as { name?: unknown };
      const name = String(parsed.name ?? "").trim();
      topic.label = name.length > 0 && name.length <= 80 ? name : topic.subjects[0] ?? topic.id;
      named += 1;
    } catch {
      topic.label = topic.subjects[0] ?? topic.id;
    }
  }

  artifact.topic_naming = {
    model: values.model,
    prompt_hash: PROMPT_HASH,
    named,
    inherited_from_subject: inherited,
    min_threads: minThreads,
  };
  await Bun.write(path, JSON.stringify(artifact, null, 2) + "\n");
  console.log(
    JSON.stringify(
      { list: list.name, named, inherited, elapsed_s: Math.round((Date.now() - started) / 1000) },
    ),
  );
}
