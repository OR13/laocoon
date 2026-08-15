#!/usr/bin/env bun
/**
 * Embed every message body with the local embedding model.
 *
 *   bun run embed
 *
 * Cached by (model, body digest), so a re-run only embeds what is new. Nothing
 * here leaves the machine: the endpoint check in OllamaClient applies, and the
 * cache is gitignored.
 */
import { parseArgs } from "node:util";
import type { Event, MessageObserved } from "../schema/generated.ts";
import { JsonlEventStore } from "../store/jsonl-store.ts";
import { BodyCache } from "../ingest/body-cache.ts";
import { newText } from "../ingest/parse.ts";
import { OllamaClient } from "../classify/ollama.ts";
import { EMBED_MODEL, EmbeddingCache, embed, sentences } from "../classify/embed.ts";
import { EVENTS_DIR } from "../lib/paths.ts";

const { values } = parseArgs({
  options: { model: { type: "string", default: EMBED_MODEL }, limit: { type: "string" } },
});

const ollama = new OllamaClient();
const available = await ollama.models();
if (!available.some((m) => m === values.model || m.startsWith(`${values.model}:`))) {
  throw new Error(`model ${values.model} not installed. Available: ${available.join(", ")}`);
}

const store = new JsonlEventStore<Event>(EVENTS_DIR, "event");
const superseded = new Set<string>();
const observed: { id: string; payload: MessageObserved }[] = [];
for await (const event of store.read()) {
  if (event.event_type === "ObservationSuperseded") {
    superseded.add((event.payload as { superseded_event_id: string }).superseded_event_id);
  } else if (event.event_type === "MessageObserved") {
    observed.push({ id: event.event_id, payload: event.payload as MessageObserved });
  }
}

const digests = new Map<string, string>();
for (const o of observed) {
  if (superseded.has(o.id)) continue;
  digests.set(o.payload.body.sha256, o.payload.list_name);
}

const bodies = new BodyCache();
const cache = new EmbeddingCache(values.model);
let todo = [...digests.keys()];
if (values.limit) todo = todo.slice(0, Number(values.limit));

let embedded = 0;
let cached = 0;
let missingBody = 0;
let empty = 0;
let embeddedSentences = 0;
let failed = 0;
const started = Date.now();

for (const [index, digest] of todo.entries()) {
  if (await cache.getSentences(digest)) {
    cached += 1;
    continue;
  }
  const body = await bodies.get(digest);
  if (body === null) {
    missingBody += 1;
    continue;
  }
  // Only what this sender actually wrote, split into sentences. Novelty is a
  // fraction of new sentences, which is length-invariant; scoring whole
  // messages measured quoting habit or brevity instead.
  const units = sentences(newText(body));
  if (units.length === 0) {
    empty += 1;
    continue;
  }
  const vectors: number[][] = [];
  let ok = true;
  for (const unit of units) {
    try {
      vectors.push(await embed(ollama, values.model, unit));
    } catch {
      ok = false;
      break;
    }
  }
  if (ok) {
    await cache.putSentences(digest, units, vectors);
    embedded += 1;
    embeddedSentences += units.length;
  } else {
    failed += 1;
  }
  if ((index + 1) % 200 === 0) process.stderr.write(`  ${index + 1}/${todo.length}\n`);
}

console.log(
  JSON.stringify(
    {
      model: values.model,
      bodies: todo.length,
      embedded,
      sentences: embeddedSentences,
      already_cached: cached,
      missing_body: missingBody,
      no_new_text: empty,
      failed,
      elapsed_s: Math.round((Date.now() - started) / 1000),
    },
    null,
    2,
  ),
);
