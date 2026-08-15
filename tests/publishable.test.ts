import { describe, expect, test } from "bun:test";
import {
  NotPublishableError,
  PUBLISHABLE_EVENT_TYPES,
  assertNoSenderHash,
  assertPublishableArtifact,
  selectPublishable,
} from "../src/site/publishable.ts";
import type { Event, ForecastEvaluated, ThreadMeasured } from "../src/schema/generated.ts";

const HASH = "sha256:" + "a".repeat(64);

function measure(overrides: Partial<ThreadMeasured> = {}): ThreadMeasured {
  return {
    thread_id: "root@x",
    list_name: "testlist",
    subject: "[Agentproto] a thread",
    measured_at: "2026-08-15T00:00:00Z",
    window_days: 7,
    new_participant_window_days: 14,
    messages_total: 3,
    distinct_senders: 2,
    max_depth: 1,
    reply_pairs: 2,
    mean_branching_factor: 2,
    messages_in_window: 1,
    distinct_senders_in_window: 1,
    replies_classified: 2,
    substantive_replies: 1,
    hollow_replies: 1,
    unclear_replies: 0,
    unclassified_replies: 0,
    substantive_reply_ratio: 0.5,
    quoting_reply_ratio: 1,
    median_novelty: 0.7,
    reach: 0.5,
    uptake_from_standing: 0.3,
    seeded_participants: 1,
    new_participants: 1,
    new_participant_share: 0.5,
    max_core_number: 1,
    mean_core_number: 1,
    provenance: {
      seed_rule_version: "1.0.0",
      classifier_model: "gemma4:12b",
      prompt_hash: "sha256:" + "b".repeat(64),
      prompt_version: "1.0.0",
      generator: "test",
    },
    ...overrides,
  };
}

const event = (type: Event["event_type"], payload: unknown, id = "sha256:" + "0".repeat(64)) =>
  ({
    event_id: id,
    event_type: type,
    schema_version: "1.0.0",
    observed_at: "2026-08-15T00:00:00Z",
    source: { kind: "projection", name: "test" },
    payload,
  }) as Event;

describe("assertPublishableArtifact", () => {
  test("accepts an artifact that declares itself aggregate", () => {
    expect(() =>
      assertPublishableArtifact("x.json", { publication: "aggregate_public" }),
    ).not.toThrow();
  });

  test("refuses one marked private", () => {
    expect(() => assertPublishableArtifact("x.json", { publication: "private" })).toThrow(
      NotPublishableError,
    );
  });

  test("refuses one that says nothing — silence is not consent", () => {
    expect(() => assertPublishableArtifact("x.json", {})).toThrow(NotPublishableError);
    expect(() => assertPublishableArtifact("x.json", null)).toThrow(NotPublishableError);
  });
});

describe("assertNoSenderHash", () => {
  test("passes ordinary output", () => {
    expect(() => assertNoSenderHash("page", "<p>24 threads</p>")).not.toThrow();
  });

  test("refuses output containing a sender hash", () => {
    expect(() => assertNoSenderHash("page", `<p>${HASH}</p>`)).toThrow(NotPublishableError);
  });

  test("allows a named exception, so a prompt hash is not a false positive", () => {
    const promptHash = "sha256:" + "b".repeat(64);
    expect(() => assertNoSenderHash("page", `prompt ${promptHash}`, [promptHash])).not.toThrow();
  });
});

describe("selectPublishable", () => {
  test("only per-thread, per-system and coverage events are publishable", () => {
    // A whitelist, so adding a new event type does not silently publish it.
    // Coverage is here because section 9 requires it in every output.
    expect(PUBLISHABLE_EVENT_TYPES).toEqual([
      "ThreadMeasured",
      "ForecastEvaluated",
      "CrawlWindowCompleted",
    ]);
  });

  test("ignores message observations entirely — they carry sender hashes", () => {
    const selected = selectPublishable([
      event("MessageObserved", { sender_id: HASH }),
      event("ObservationSuperseded", { superseded_event_id: HASH }),
    ]);
    expect(selected.measures).toEqual([]);
    expect(selected.forecasts).toEqual([]);
    expect(selected.windows).toEqual([]);
  });

  test("keeps the newest measurement per thread", () => {
    const selected = selectPublishable([
      event("ThreadMeasured", measure({ measured_at: "2026-08-01T00:00:00Z", messages_total: 1 })),
      event("ThreadMeasured", measure({ measured_at: "2026-08-15T00:00:00Z", messages_total: 9 }), "sha256:" + "1".repeat(64)),
    ]);
    expect(selected.measures).toHaveLength(1);
    expect(selected.measures[0]!.messages_total).toBe(9);
  });

  test("on a tied horizon the later measurement wins", () => {
    // Recomputing the same horizon after more replies were classified produces a
    // second measurement with the same measured_at. The better-covered one is
    // the one appended later.
    const selected = selectPublishable([
      event("ThreadMeasured", measure({ unclassified_replies: 5, substantive_replies: 0 })),
      event(
        "ThreadMeasured",
        measure({ unclassified_replies: 0, substantive_replies: 5 }),
        "sha256:" + "3".repeat(64),
      ),
    ]);
    expect(selected.measures).toHaveLength(1);
    expect(selected.measures[0]!.unclassified_replies).toBe(0);
  });

  test("keeps every forecast evaluation — accuracy history is the point", () => {
    const forecast = (origin: string): ForecastEvaluated => ({
      list_name: "testlist",
      origin_at: origin,
      horizon_days: 7,
      forecaster: "recent_replies",
      is_baseline: true,
      threads_scored: 5,
      threads_with_engagement: 2,
      spearman: 0.4,
      p_value: 0.3,
      precision_at_3: 0.66,
      actual_metric: "replies_in_horizon",
      generator: "test",
    });
    const selected = selectPublishable([
      event("ForecastEvaluated", forecast("2026-08-01T00:00:00Z")),
      event("ForecastEvaluated", forecast("2026-08-08T00:00:00Z"), "sha256:" + "2".repeat(64)),
    ]);
    expect(selected.forecasts).toHaveLength(2);
    expect(selected.forecasts.map((f) => f.origin_at)).toEqual([
      "2026-08-01T00:00:00Z",
      "2026-08-08T00:00:00Z",
    ]);
  });

  test("a selected measure carries no sender hash", () => {
    const selected = selectPublishable([event("ThreadMeasured", measure())]);
    expect(() =>
      assertNoSenderHash("measures", JSON.stringify(selected.measures), [
        measure().provenance.prompt_hash,
      ]),
    ).not.toThrow();
  });
});
