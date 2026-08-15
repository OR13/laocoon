import { describe, expect, test } from "bun:test";
import { parseVerdict } from "../src/classify/classify.ts";
import {
  MAX_EXCERPT_CHARS,
  PROMPT_HASH,
  SUBSTANCE_PROMPT,
  excerpt,
  renderPrompt,
} from "../src/classify/prompt.ts";
import { OllamaClient } from "../src/classify/ollama.ts";

describe("the substance prompt", () => {
  test("asks about engagement between two texts", () => {
    expect(SUBSTANCE_PROMPT).toContain("engages with the message it is answering");
  });

  test("explicitly forbids the model from guessing at provenance", () => {
    // The single most important line in the prompt. A model asked to judge
    // engagement will otherwise volunteer an opinion on authorship, and that
    // opinion would then be sitting in the log.
    expect(SUBSTANCE_PROMPT).toContain("Do not speculate about who wrote either message");
    expect(SUBSTANCE_PROMPT).toContain("whether any tool was involved");
  });

  test("contains no provenance vocabulary at all", () => {
    const forbidden = ["AI-generated", "machine-generated", "LLM", "bot", "authentic", "genuine"];
    for (const word of forbidden) {
      expect(SUBSTANCE_PROMPT.toLowerCase()).not.toContain(word.toLowerCase());
    }
  });

  test("names neither sender", () => {
    expect(SUBSTANCE_PROMPT).not.toContain("sender");
    expect(SUBSTANCE_PROMPT).not.toContain("author");
  });

  test("says length is not the criterion", () => {
    expect(SUBSTANCE_PROMPT).toContain("Length is not the criterion");
  });

  test("the hash is of the template, so every message shares it", () => {
    const a = renderPrompt("parent one", "reply one");
    const b = renderPrompt("parent two", "reply two");
    expect(a).not.toBe(b);
    expect(PROMPT_HASH).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test("substitutes both messages", () => {
    const rendered = renderPrompt("PARENT TEXT", "REPLY TEXT");
    expect(rendered).toContain("PARENT TEXT");
    expect(rendered).toContain("REPLY TEXT");
    expect(rendered).not.toContain("{{parent}}");
    expect(rendered).not.toContain("{{reply}}");
  });
});

describe("excerpt", () => {
  test("keeps a short body whole", () => {
    expect(excerpt("short")).toBe("short");
  });

  test("trims the tail and says so", () => {
    const long = "x".repeat(MAX_EXCERPT_CHARS + 500);
    const trimmed = excerpt(long);
    expect(trimmed.startsWith("x".repeat(100))).toBe(true);
    expect(trimmed).toContain("[... truncated ...]");
  });
});

describe("parseVerdict", () => {
  test("reads a well-formed answer", () => {
    expect(parseVerdict('{"verdict":"substantive","reason":"answers the question"}')).toEqual({
      verdict: "substantive",
      reason: "answers the question",
    });
  });

  test("accepts any case", () => {
    expect(parseVerdict('{"verdict":"HOLLOW","reason":"restates"}').verdict).toBe("hollow");
  });

  test("non-JSON becomes unclear, never a guess", () => {
    const parsed = parseVerdict("I think this reply is quite substantive, actually.");
    expect(parsed.verdict).toBe("unclear");
    expect(parsed.reason).toContain("did not return JSON");
  });

  test("an unrecognised verdict becomes unclear and says what it saw", () => {
    // Coercing "somewhat substantive" to "substantive" would fabricate data.
    const parsed = parseVerdict('{"verdict":"somewhat substantive","reason":"hedging"}');
    expect(parsed.verdict).toBe("unclear");
    expect(parsed.reason).toContain("somewhat substantive");
  });

  test("a JSON array is not an answer", () => {
    expect(parseVerdict('["substantive"]').verdict).toBe("unclear");
  });

  test("never returns error — that is the pipeline's word, not the model's", () => {
    for (const text of ["{}", "null", '{"verdict":"error"}', "garbage"]) {
      expect(parseVerdict(text).verdict).not.toBe("error");
    }
  });
});

describe("OllamaClient", () => {
  test("refuses a non-local endpoint", () => {
    // Daily operation is local-only by design, not by configuration.
    expect(() => new OllamaClient({ baseUrl: "https://api.example.com" })).toThrow(
      /non-local model endpoint/,
    );
    expect(() => new OllamaClient({ baseUrl: "http://10.0.0.5:11434" })).toThrow(
      /non-local model endpoint/,
    );
  });

  test("accepts localhost and the loopback address", () => {
    expect(() => new OllamaClient({ baseUrl: "http://localhost:11434" })).not.toThrow();
    expect(() => new OllamaClient({ baseUrl: "http://127.0.0.1:11434" })).not.toThrow();
  });
});
