#!/usr/bin/env bun
/**
 * Classify every reply as substantive or hollow, with local models.
 *
 *   bun run classify
 *   bun run classify --models gemma4:12b
 *   bun run classify --limit 10          # budgeted pass
 *
 * Requires `bun run graph` first: the reply edges come from the graph artifact,
 * which is the documented seam between the two runtimes. Bodies come from the
 * local cache written at ingestion, so this never re-crawls.
 *
 * Verdicts are written to the private log only. Nothing here writes to the
 * public log, and nothing here talks to a hosted model.
 */
import { parseArgs } from "node:util";
import { join } from "node:path";
import type { Event, MessageObserved, PrivateEvent, ReplyGraph } from "../schema/generated.ts";
import { JsonlEventStore } from "../store/jsonl-store.ts";
import { OllamaClient } from "../classify/ollama.ts";
import { classifyReplies, type ClassifiableReply } from "../classify/classify.ts";
import { PROMPT_HASH, PROMPT_VERSION } from "../classify/prompt.ts";
import { ARTIFACTS_DIR, EVENTS_DIR, PRIVATE_DIR } from "../lib/paths.ts";

const { values } = parseArgs({
  options: {
    models: { type: "string", default: "gemma4:12b,gemma4:31b" },
    limit: { type: "string" },
    graph: { type: "string" },
  },
});

const graphPath = values.graph ?? join(ARTIFACTS_DIR, "reply-graph.json");
if (!(await Bun.file(graphPath).exists())) {
  throw new Error(`no ${graphPath}: run \`bun run graph\` first`);
}
const graph = (await Bun.file(graphPath).json()) as ReplyGraph;

/** message_id -> body digest, from live observations in the public log. */
const publicStore = new JsonlEventStore<Event>(EVENTS_DIR, "event");
const superseded = new Set<string>();
const observed: { eventId: string; payload: MessageObserved }[] = [];
for await (const event of publicStore.read()) {
  if (event.event_type === "ObservationSuperseded") {
    superseded.add((event.payload as { superseded_event_id: string }).superseded_event_id);
  } else if (event.event_type === "MessageObserved") {
    observed.push({ eventId: event.event_id, payload: event.payload as MessageObserved });
  }
}
const bodyOf = new Map<string, string>();
for (const o of observed) {
  if (superseded.has(o.eventId) || !o.payload.message_id) continue;
  bodyOf.set(o.payload.message_id, o.payload.body.sha256);
}

let replies: ClassifiableReply[] = [];
let missingDigest = 0;
for (const edge of graph.edges) {
  const body = bodyOf.get(edge.child);
  const parentBody = bodyOf.get(edge.parent);
  if (!body || !parentBody) {
    missingDigest += 1;
    continue;
  }
  const node = graph.nodes.find((n) => n.message_id === edge.child);
  replies.push({
    message_id: edge.child,
    list_name: node?.list_name ?? "",
    parent_message_id: edge.parent,
    body_sha256: body,
    parent_body_sha256: parentBody,
  });
}
replies.sort((a, b) => a.message_id.localeCompare(b.message_id));
if (values.limit) replies = replies.slice(0, Number(values.limit));

const models = values.models.split(",").map((m) => m.trim()).filter(Boolean);
const store = new JsonlEventStore<PrivateEvent>(join(PRIVATE_DIR, "events"), "private-event");
const ollama = new OllamaClient();

let lastLogged = 0;
const report = await classifyReplies(ollama, store, replies, {
  models,
  onProgress: (done, total) => {
    if (done - lastLogged >= 10 || done === total) {
      lastLogged = done;
      process.stderr.write(`  ${done}/${total}\n`);
    }
  },
});

console.log(
  JSON.stringify(
    {
      ...report,
      prompt_version: PROMPT_VERSION,
      prompt_hash: PROMPT_HASH,
      edges_without_a_body_digest: missingDigest,
      elapsed_s: Math.round(report.elapsedMs / 1000),
    },
    null,
    2,
  ),
);
