/**
 * What is allowed to be published, enforced rather than remembered.
 *
 * PROBLEM.md section 7 splits the world in two: per-thread and aggregate
 * measures are public; per-person quality scores, ranked participant lists, and
 * any label attached to a named individual are not. Getting that wrong is not a
 * bug you can fix — a published file is published.
 *
 * So the site build refuses input rather than trusting the author of the build:
 *
 *   1. an artifact whose `publication` is not `aggregate_public` is rejected;
 *   2. anything reaching the output that carries a sender hash is rejected;
 *   3. the only event types read from the log are the two that are per-thread
 *      or per-system, named here explicitly rather than by exclusion.
 *
 * Rule 3 is a whitelist on purpose. A blacklist would silently start publishing
 * the next event type someone adds.
 */
import type {
  CrawlWindowCompleted,
  Event,
  ForecastEvaluated,
  ThreadMeasured,
} from "../schema/generated.ts";

/**
 * The only event types that may reach the site.
 *
 * `CrawlWindowCompleted` is here because PROBLEM.md section 9 requires the
 * actual coverage window to appear in every output — a figure whose coverage is
 * invisible is a figure nobody can check. It carries counts and timestamps and
 * no participant data.
 */
export const PUBLISHABLE_EVENT_TYPES = [
  "ThreadMeasured",
  "ForecastEvaluated",
  "CrawlWindowCompleted",
] as const;

export const SENDER_HASH = /sha256:[0-9a-f]{64}/;

export class NotPublishableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotPublishableError";
  }
}

/** Throw unless the artifact declares itself publishable. */
export function assertPublishableArtifact(name: string, artifact: unknown): void {
  const publication = (artifact as { publication?: unknown } | null)?.publication;
  if (publication !== "aggregate_public") {
    throw new NotPublishableError(
      `refusing to publish ${name}: publication is ${JSON.stringify(publication)}, ` +
        `expected "aggregate_public"`,
    );
  }
}

/**
 * Throw if any sender hash appears in what is about to be written.
 *
 * `ThreadMeasured.thread_id` is a Message-ID, never a sender hash, so nothing
 * legitimate trips this. The provenance block's `prompt_hash` is a sha256 of a
 * prompt, so it is excluded by name rather than by pattern.
 */
export function assertNoSenderHash(name: string, text: string, allow: readonly string[] = []): void {
  let scrubbed = text;
  for (const allowed of allow) scrubbed = scrubbed.split(allowed).join("");
  const found = scrubbed.match(SENDER_HASH);
  if (found) {
    throw new NotPublishableError(
      `refusing to publish ${name}: it contains a sender hash (${found[0].slice(0, 24)}…)`,
    );
  }
}

export interface PublishableEvents {
  measures: ThreadMeasured[];
  forecasts: ForecastEvaluated[];
  windows: CrawlWindowCompleted[];
}

/**
 * Select publishable events from the log.
 *
 * For each thread only the newest measurement is kept — the site shows the
 * current state — but every forecast evaluation is kept, because the accuracy
 * history is the point of publishing accuracy at all.
 */
export function selectPublishable(events: readonly Event[]): PublishableEvents {
  const latest = new Map<string, ThreadMeasured>();
  const forecasts: ForecastEvaluated[] = [];
  const windows: CrawlWindowCompleted[] = [];

  for (const event of events) {
    if (event.event_type === "ThreadMeasured") {
      const measure = event.payload as ThreadMeasured;
      const existing = latest.get(measure.thread_id);
      // `>=`, not `>`: two measurements can share a horizon when the same
      // horizon is recomputed after more replies were classified. Log order
      // breaks the tie, so the later — better-covered — one wins.
      if (!existing || measure.measured_at >= existing.measured_at) {
        latest.set(measure.thread_id, measure);
      }
    } else if (event.event_type === "ForecastEvaluated") {
      forecasts.push(event.payload as ForecastEvaluated);
    } else if (event.event_type === "CrawlWindowCompleted") {
      windows.push(event.payload as CrawlWindowCompleted);
    }
  }

  const measures = [...latest.values()].sort(
    (a, b) => b.messages_total - a.messages_total || a.thread_id.localeCompare(b.thread_id),
  );
  forecasts.sort(
    (a, b) => a.origin_at.localeCompare(b.origin_at) || a.forecaster.localeCompare(b.forecaster),
  );
  windows.sort((a, b) => a.completed_at.localeCompare(b.completed_at));
  return { measures, forecasts, windows };
}
