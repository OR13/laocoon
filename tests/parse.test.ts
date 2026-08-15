import { describe, expect, test } from "bun:test";
import {
  bodyShape,
  extractAddress,
  normalizeMessageId,
  parseMessageIdList,
  parseSentAt,
} from "../src/ingest/parse.ts";

describe("normalizeMessageId", () => {
  test("strips brackets and whitespace", () => {
    expect(normalizeMessageId("  <abc@example.org> ")).toBe("abc@example.org");
  });

  test("preserves case, because msg-id comparison is case sensitive", () => {
    expect(normalizeMessageId("<AbC@Example.ORG>")).toBe("AbC@Example.ORG");
  });

  test("returns null for empty and missing values", () => {
    expect(normalizeMessageId("<>")).toBeNull();
    expect(normalizeMessageId(null)).toBeNull();
    expect(normalizeMessageId("   ")).toBeNull();
  });
});

describe("parseMessageIdList", () => {
  test("reads every bracketed id in header order", () => {
    expect(parseMessageIdList("<a@x> <b@x>\r\n <c@x>")).toEqual(["a@x", "b@x", "c@x"]);
  });

  test("deduplicates while keeping first position", () => {
    expect(parseMessageIdList("<a@x> <b@x> <a@x>")).toEqual(["a@x", "b@x"]);
  });

  test("falls back to bare tokens when a client omits brackets", () => {
    expect(parseMessageIdList("a@x b@x")).toEqual(["a@x", "b@x"]);
  });

  test("empty for a missing header", () => {
    expect(parseMessageIdList(undefined)).toEqual([]);
  });
});

describe("bodyShape", () => {
  test("counts quoted and new lines separately", () => {
    const shape = bodyShape(["> they said this", "> and this", "I disagree.", ""].join("\n"));
    expect(shape.quoted_lines).toBe(2);
    expect(shape.unquoted_lines).toBe(1);
  });

  test("excludes the attribution line from new text", () => {
    const shape = bodyShape(
      ["On Mon, 3 Aug 2026, Someone wrote:", "> a point", "Agreed."].join("\n"),
    );
    expect(shape.unquoted_lines).toBe(1);
  });

  test("drops the signature block", () => {
    const shape = bodyShape(["Body text.", "-- ", "Name", "Title"].join("\n"));
    expect(shape.lines).toBe(1);
    expect(shape.unquoted_lines).toBe(1);
  });

  test("drops the mailman footer, which the sender did not write", () => {
    const shape = bodyShape(
      [
        "Body text.",
        "",
        "_".repeat(47),
        "agentproto mailing list -- agentproto@ietf.org",
        "To unsubscribe send an email to agentproto-leave@ietf.org",
      ].join("\n"),
    );
    expect(shape.unquoted_lines).toBe(1);
    expect(shape.lines).toBe(1);
  });

  test("drops the mailman footer when the rule has a leading space", () => {
    // The regression that mattered: on the real corpus the separator arrives as
    // " ______…", and an anchored /^_{20,}$/ matched none of 71 messages, so
    // three lines of list boilerplate were counted as text the sender wrote.
    const shape = bodyShape(
      [
        "Body text.",
        "",
        " " + "_".repeat(47),
        "agentproto mailing list -- agentproto@ietf.org",
        "To unsubscribe send an email to agentproto-leave@ietf.org",
      ].join("\n"),
    );
    expect(shape.unquoted_lines).toBe(1);
    expect(shape.lines).toBe(1);
  });

  test("a quoted footer rule does not truncate the quoting message", () => {
    // "> ____" is the footer of a message being quoted. Truncating there would
    // discard the text the quoting sender actually wrote below it.
    const shape = bodyShape(
      ["> " + "_".repeat(40), "> agentproto mailing list -- agentproto@ietf.org", "My reply."].join(
        "\n",
      ),
    );
    expect(shape.quoted_lines).toBe(2);
    expect(shape.unquoted_lines).toBe(1);
  });

  test("drops a mobile client's Original message header", () => {
    const shape = bodyShape(
      [
        "Short objection.",
        "-------- Original message --------From: Someone <a@b.c> Date: 8/6/26",
        "quoted stuff",
      ].join("\n"),
    );
    expect(shape.unquoted_lines).toBe(1);
  });

  test("an empty body is all zeroes", () => {
    expect(bodyShape("")).toEqual({ chars: 0, lines: 0, quoted_lines: 0, unquoted_lines: 0 });
  });

  test("CRLF is normalised before counting", () => {
    expect(bodyShape("a\r\nb").lines).toBe(2);
  });
});

describe("parseSentAt", () => {
  test("parses an RFC 5322 date to UTC", () => {
    expect(parseSentAt("Mon, 3 Aug 2026 09:14:00 +0200")).toBe("2026-08-03T07:14:00.000Z");
  });

  test("returns null rather than guessing", () => {
    expect(parseSentAt("sometime last week")).toBeNull();
    expect(parseSentAt("")).toBeNull();
  });
});

describe("extractAddress", () => {
  test("prefers the angle-bracketed addr-spec", () => {
    expect(extractAddress('"Someone, Jr." <SOMEONE@Example.org>')).toBe("someone@example.org");
  });

  test("accepts a bare address", () => {
    expect(extractAddress("someone@example.org")).toBe("someone@example.org");
  });

  test("null when there is no address at all", () => {
    expect(extractAddress("Anonymous")).toBeNull();
  });
});
