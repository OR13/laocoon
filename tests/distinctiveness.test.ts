import { describe, expect, test } from "bun:test";
import { distinctiveness, terms, MIN_TERMS } from "../src/classify/distinctiveness.ts";

/**
 * The property under test is the one a model would not report: that a message
 * made of list-general language sits as comfortably in one thread as another.
 * Two threads on distinct subjects, plus a reply of pure boilerplate that
 * belongs to neither.
 */
const CORPUS = [
  { message_id: "a1", thread_id: "tokens", text: "The bearer token binding fails when the intermediary re-establishes the channel." },
  { message_id: "a2", thread_id: "tokens", text: "Agreed on token binding: the channel re-establishment breaks the bearer assumption." },
  { message_id: "a3", thread_id: "tokens", text: "Channel binding for a bearer token needs the intermediary to preserve the hash." },
  { message_id: "b1", thread_id: "registry", text: "The IANA registry needs a media type column for the discovery document." },
  { message_id: "b2", thread_id: "registry", text: "Registering that media type in IANA means the discovery document gets a column." },
  { message_id: "b3", thread_id: "registry", text: "Media type registration and the IANA discovery column are the open registry questions." },
];

/** Fits either thread: agent-protocol language and nothing else. */
const BOILERPLATE =
  "This is an important area for the agent protocol ecosystem and the community should " +
  "consider the interoperability implications carefully across deployments and standards work.";

describe("distinctiveness", () => {
  test("a reply sharing its thread's vocabulary scores positive", () => {
    const scored = distinctiveness(CORPUS);
    for (const row of scored) {
      expect(row.distinctiveness).toBeGreaterThan(0);
      expect(row.similarity_to_own_thread).toBeGreaterThan(row.similarity_to_other_threads);
    }
  });

  test("boilerplate is no closer to its own thread than to any other", () => {
    // The measure the model returned false on for 43 of 43 messages.
    const withFiller = [
      ...CORPUS,
      { message_id: "filler", thread_id: "tokens", text: BOILERPLATE },
    ];
    const scored = distinctiveness(withFiller);
    const filler = scored.find((r) => r.message_id === "filler")!;
    const real = scored.find((r) => r.message_id === "a1")!;
    expect(filler.distinctiveness).toBeLessThan(real.distinctiveness);
    expect(filler.distinctiveness).toBeLessThan(0.05);
  });

  test("the same boilerplate scores the same in either thread", () => {
    // If it were genuinely about one conversation, moving it would cost it.
    const inTokens = distinctiveness([
      ...CORPUS,
      { message_id: "f", thread_id: "tokens", text: BOILERPLATE },
    ]).find((r) => r.message_id === "f")!;
    const inRegistry = distinctiveness([
      ...CORPUS,
      { message_id: "f", thread_id: "registry", text: BOILERPLATE },
    ]).find((r) => r.message_id === "f")!;
    expect(Math.abs(inTokens.distinctiveness - inRegistry.distinctiveness)).toBeLessThan(0.05);
  });

  test("moving a real reply to the wrong thread costs it", () => {
    const moved = distinctiveness(
      CORPUS.map((d) => (d.message_id === "a3" ? { ...d, thread_id: "registry" } : d)),
    ).find((r) => r.message_id === "a3")!;
    const home = distinctiveness(CORPUS).find((r) => r.message_id === "a3")!;
    expect(moved.distinctiveness).toBeLessThan(home.distinctiveness);
  });

  test("it is deterministic — a re-run reproduces exactly", () => {
    expect(distinctiveness(CORPUS)).toEqual(distinctiveness(CORPUS));
  });

  test("a lone message in its thread scores zero own-similarity, not NaN", () => {
    const scored = distinctiveness([
      ...CORPUS,
      { message_id: "solo", thread_id: "alone", text: "Some entirely separate remark about scheduling." },
    ]);
    const solo = scored.find((r) => r.message_id === "solo")!;
    expect(Number.isFinite(solo.distinctiveness)).toBe(true);
    expect(solo.similarity_to_own_thread).toBe(0);
  });

  test("stopwords and list furniture are dropped before counting", () => {
    const found = terms("Hi all, thanks — the token binding is in section 4.2");
    expect(found).not.toContain("the");
    expect(found).not.toContain("thanks");
    expect(found).toContain("token");
    expect(found).toContain("binding");
  });

  test("MIN_TERMS is the caller's floor, and short text reports its term count", () => {
    const scored = distinctiveness([
      ...CORPUS,
      { message_id: "short", thread_id: "tokens", text: "+1" },
    ]);
    expect(scored.find((r) => r.message_id === "short")!.terms).toBeLessThan(MIN_TERMS);
  });
});
