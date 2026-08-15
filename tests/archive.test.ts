import { describe, expect, test } from "bun:test";
import { archiveListUrl, archiveMessageUrl, archiveToken } from "../src/lib/archive.ts";

describe("archiveToken", () => {
  test("reproduces a real archived message's token", () => {
    // Recovered by fetching https://mailarchive.ietf.org/arch/msg/rtg-bfd/
    // lDxFfNpqo4kwuNEUY0AbjMBb8JU/ and reading its Message-ID. This test is the
    // only thing standing between a working link scheme and a plausible guess:
    // one published description of it says base32, which is wrong.
    expect(
      archiveToken("b4a3419f-b465-90fd-0f92-7385fa5595c4@mikrotik.com", "rtg-bfd"),
    ).toBe("lDxFfNpqo4kwuNEUY0AbjMBb8JU");
  });

  test("angle brackets are stripped before hashing", () => {
    expect(archiveToken("<a@b.c>", "x")).toBe(archiveToken("a@b.c", "x"));
  });

  test("the list name is part of the hash", () => {
    // The same message cross-posted to two lists has two different tokens.
    expect(archiveToken("a@b.c", "one")).not.toBe(archiveToken("a@b.c", "two"));
  });

  test("no padding, url-safe alphabet only", () => {
    const token = archiveToken("some-id@example.org", "agentproto");
    expect(token).not.toContain("=");
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("urls", () => {
  test("message permalink has the expected shape", () => {
    expect(archiveMessageUrl("b4a3419f-b465-90fd-0f92-7385fa5595c4@mikrotik.com", "rtg-bfd")).toBe(
      "https://mailarchive.ietf.org/arch/msg/rtg-bfd/lDxFfNpqo4kwuNEUY0AbjMBb8JU/",
    );
  });

  test("list browse url", () => {
    expect(archiveListUrl("agentproto")).toBe(
      "https://mailarchive.ietf.org/arch/browse/agentproto/",
    );
  });
});
