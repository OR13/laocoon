/**
 * Substantive-vs-hollow classification of replies.
 *
 * Every reply that has a parent in the corpus is judged against that parent by
 * each configured model. Verdicts go to the private log: a per-message quality
 * label joined to the sender_id in the public log is a per-person quality score,
 * which PROBLEM.md section 7 keeps unpublished. The publishable object is the
 * per-thread ratio.
 *
 * Idempotent, because the verdict's `event_id` covers the message, the parent,
 * the model, the prompt hash and both body digests. Re-running classifies only
 * what is new, and a re-run after a prompt change re-classifies everything
 * without editing a single earlier verdict.
 *
 * A model that fails is recorded as `verdict: "error"`, which is a different
 * fact from the model answering `unclear`. Collapsing the two would make a
 * broken run look like an inconclusive corpus.
 *
 * Models are run one at a time over the whole corpus rather than both over each
 * message: Ollama keeps one model resident, so interleaving a 7.6 GB and a 19 GB
 * model evicts and reloads one of them on every single call.
 *
 * Verdicts are flushed to the log in batches rather than at the end. A full pass
 * over this corpus takes tens of minutes on local hardware; buffering all of it
 * in memory would mean a crash at message 80 discards 79 answers that were
 * correctly computed and paid for.
 */
import type { MessageClassified, PrivateEvent, PrivateSourceRef } from "../schema/generated.ts";
import type { EventStore } from "../store/event-store.ts";
import { makePrivateEvent } from "../events/factory.ts";
import { BodyCache } from "../ingest/body-cache.ts";
import { OllamaClient } from "./ollama.ts";
import { PROMPT_HASH, PROMPT_VERSION, renderPrompt } from "./prompt.ts";

const SOURCE: PrivateSourceRef = { kind: "ollama", name: "localhost:11434" };

export type Verdict = MessageClassified["verdict"];

export interface ClassifiableReply {
  message_id: string;
  list_name: string;
  parent_message_id: string;
  body_sha256: string;
  parent_body_sha256: string;
}

export interface ClassifyReport {
  models: string[];
  candidates: number;
  classified: number;
  alreadyClassified: number;
  skippedMissingBody: number;
  errors: number;
  verdicts: Record<string, Record<string, number>>;
  eventsAppended: number;
  eventsDuplicate: number;
  elapsedMs: number;
}

/**
 * Parse the model's answer.
 *
 * `format: "json"` makes Ollama emit JSON, but it does not make the model emit
 * the right *shape*. An unrecognised verdict becomes `unclear` rather than being
 * coerced to a usable one — guessing here would fabricate data.
 */
export function parseVerdict(text: string): { verdict: Verdict; reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { verdict: "unclear", reason: "model did not return JSON" };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { verdict: "unclear", reason: "model returned a non-object" };
  }
  const record = parsed as Record<string, unknown>;
  const raw = String(record.verdict ?? "").toLowerCase().trim();
  const verdict: Verdict =
    raw === "substantive" || raw === "hollow" || raw === "unclear" ? raw : "unclear";
  const reason = String(record.reason ?? "").slice(0, 200);
  return {
    verdict,
    reason: verdict === "unclear" && raw && raw !== "unclear"
      ? `unrecognised verdict ${JSON.stringify(raw)}`
      : reason,
  };
}

export async function classifyReplies(
  ollama: OllamaClient,
  store: EventStore<PrivateEvent>,
  replies: readonly ClassifiableReply[],
  options: {
    models: string[];
    bodies?: BodyCache;
    now?: () => Date;
    onProgress?: (done: number, total: number) => void;
    /** Verdicts buffered before being appended. */
    flushEvery?: number;
  },
): Promise<ClassifyReport> {
  const now = options.now ?? (() => new Date());
  const bodies = options.bodies ?? new BodyCache();
  const started = Date.now();

  const available = await ollama.models();
  const missing = options.models.filter((m) => !available.includes(m));
  if (missing.length > 0) {
    throw new Error(
      `model(s) not present locally: ${missing.join(", ")}. Available: ${available.join(", ")}`,
    );
  }

  const done = await classifiedKeys(store);
  const flushEvery = options.flushEvery ?? 10;
  let pending: PrivateEvent[] = [];
  let eventsAppended = 0;
  let eventsDuplicate = 0;

  const flush = async (): Promise<void> => {
    if (pending.length === 0) return;
    const result = await store.append(pending);
    eventsAppended += result.appended;
    eventsDuplicate += result.duplicates;
    pending = [];
  };
  const verdicts: Record<string, Record<string, number>> = {};
  let classified = 0;
  let alreadyClassified = 0;
  let skippedMissingBody = 0;
  let errors = 0;

  const total = replies.length * options.models.length;
  let processed = 0;

  // Model-major, not message-major. Ollama keeps one model resident, so
  // alternating between a 7.6 GB and a 19 GB model on every message would evict
  // and reload one of them every single call. Running each model over the whole
  // corpus in turn costs one swap for the entire pass.
  for (const model of options.models) {
    for (const reply of replies) {
      processed += 1;
      const key = `${reply.message_id}|${reply.parent_message_id}|${model}|${PROMPT_HASH}|${reply.body_sha256}`;
      if (done.has(key)) {
        alreadyClassified += 1;
        continue;
      }

      const replyBody = await bodies.get(reply.body_sha256);
      const parentBody = await bodies.get(reply.parent_body_sha256);
      if (replyBody === null || parentBody === null) {
        // The body cache is local and rebuildable, but a verdict on text we no
        // longer hold could never be checked. Skip and count.
        skippedMissingBody += 1;
        continue;
      }

      let verdict: Verdict;
      let reason: string;
      let durationMs: number;
      try {
        const generation = await ollama.generateJson(
          model,
          renderPrompt(parentBody, replyBody),
        );
        const parsedVerdict = parseVerdict(generation.text);
        verdict = parsedVerdict.verdict;
        reason = parsedVerdict.reason;
        durationMs = generation.durationMs;
      } catch (error) {
        verdict = "error";
        reason = error instanceof Error ? error.message.slice(0, 200) : String(error);
        durationMs = 0;
        errors += 1;
      }

      const payload: MessageClassified = {
        message_id: reply.message_id,
        list_name: reply.list_name,
        parent_message_id: reply.parent_message_id,
        model,
        prompt_hash: PROMPT_HASH,
        prompt_version: PROMPT_VERSION,
        verdict,
        reason,
        body_sha256: reply.body_sha256,
        parent_body_sha256: reply.parent_body_sha256,
        classified_at: now().toISOString(),
        duration_ms: durationMs,
      };
      pending.push(makePrivateEvent("MessageClassified", payload, SOURCE, now().toISOString()));
      classified += 1;
      done.add(key);

      verdicts[model] ??= {};
      verdicts[model][verdict] = (verdicts[model][verdict] ?? 0) + 1;

      if (pending.length >= flushEvery) await flush();
      options.onProgress?.(processed, total);
    }
  }

  await flush();
  return {
    models: options.models,
    candidates: replies.length,
    classified,
    alreadyClassified,
    skippedMissingBody,
    errors,
    verdicts,
    eventsAppended,
    eventsDuplicate,
    elapsedMs: Date.now() - started,
  };
}

/**
 * Verdicts already in the log.
 *
 * Keyed on everything the verdict depends on — message, parent, model, prompt,
 * and the body digest — so a prompt change or an edited message re-classifies
 * rather than reusing a stale answer.
 */
async function classifiedKeys(store: EventStore<PrivateEvent>): Promise<Set<string>> {
  const keys = new Set<string>();
  for await (const event of store.read()) {
    if (event.event_type !== "MessageClassified") continue;
    const p = event.payload as unknown as MessageClassified;
    // An error is not an answer: leave it eligible for a later attempt.
    if (p.verdict === "error") continue;
    keys.add(
      `${p.message_id}|${p.parent_message_id}|${p.model}|${p.prompt_hash}|${p.body_sha256}`,
    );
  }
  return keys;
}
