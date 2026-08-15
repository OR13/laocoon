import { describe, expect, test } from "bun:test";
import { ByteStream, quote, readResponseLine } from "../src/crawl/imap-client.ts";

const bytes = (text: string) => new TextEncoder().encode(text);
const decode = (data: Uint8Array) => new TextDecoder().decode(data);

/** Feed a response one chunk at a time, as a socket would. */
function feed(chunks: string[]): ByteStream {
  const stream = new ByteStream();
  for (const chunk of chunks) stream.push(bytes(chunk));
  return stream;
}

describe("ByteStream", () => {
  test("reads a line that arrives whole", async () => {
    expect(await feed(["* OK ready\r\n"]).readLine()).toBe("* OK ready");
  });

  test("reads a line split across chunk boundaries", async () => {
    const stream = feed(["* OK re", "ady\r", "\n"]);
    expect(await stream.readLine()).toBe("* OK ready");
  });

  test("tolerates a bare LF", async () => {
    expect(await feed(["* OK ready\n"]).readLine()).toBe("* OK ready");
  });

  test("reads exact byte counts across chunks", async () => {
    const stream = feed(["abcde", "fghij"]);
    expect(decode(await stream.readExact(3))).toBe("abc");
    expect(decode(await stream.readExact(5))).toBe("defgh");
    expect(decode(await stream.readExact(2))).toBe("ij");
  });

  test("a line following a literal is read from the right offset", async () => {
    const stream = feed(["12345\r\nnext line\r\n"]);
    expect(decode(await stream.readExact(5))).toBe("12345");
    expect(await stream.readLine()).toBe("");
    expect(await stream.readLine()).toBe("next line");
  });

  test("waits for bytes that have not arrived yet", async () => {
    const stream = new ByteStream();
    const pending = stream.readLine();
    stream.push(bytes("late\r\n"));
    expect(await pending).toBe("late");
  });

  test("a server hang-up mid-line is an error, not a silent truncation", async () => {
    const stream = new ByteStream();
    const pending = stream.readLine();
    stream.push(bytes("partial"));
    stream.end();
    await expect(pending).rejects.toThrow(/connection closed/);
  });
});

describe("readResponseLine", () => {
  test("a plain line has no literals", async () => {
    const line = await readResponseLine(feed(["* 106 EXISTS\r\n"]));
    expect(line.text).toBe("* 106 EXISTS");
    expect(line.literals).toEqual([]);
  });

  test("lifts a literal out and keeps the rest of the logical line", async () => {
    const line = await readResponseLine(
      feed(["* 1 FETCH (UID 7 BODY[] {11}\r\nhello world)\r\n"]),
    );
    expect(line.text).toBe("* 1 FETCH (UID 7 BODY[]  )");
    expect(line.literals).toHaveLength(1);
    expect(decode(line.literals[0]!)).toBe("hello world");
  });

  test("the UID is still matchable when the literal comes first", async () => {
    const line = await readResponseLine(feed(["* 1 FETCH (BODY[] {5}\r\nbody! UID 42)\r\n"]));
    expect(line.text.match(/\bUID (\d+)/)?.[1]).toBe("42");
    expect(decode(line.literals[0]!)).toBe("body!");
  });

  test("a literal containing CRLF is read by length, not by line", async () => {
    const payload = "line one\r\nline two\r\n";
    const line = await readResponseLine(
      feed([`* 1 FETCH (UID 3 BODY[] {${payload.length}}\r\n${payload})\r\n`]),
    );
    expect(decode(line.literals[0]!)).toBe(payload);
    expect(line.text.endsWith(")")).toBe(true);
  });

  test("handles two literals in one logical line", async () => {
    const line = await readResponseLine(feed(["* 1 FETCH (A {2}\r\naa B {3}\r\nbbb)\r\n"]));
    expect(line.literals.map(decode)).toEqual(["aa", "bbb"]);
  });

  test("accepts the literal+ form", async () => {
    const line = await readResponseLine(feed(["* 1 FETCH (BODY[] {3+}\r\nxyz)\r\n"]));
    expect(decode(line.literals[0]!)).toBe("xyz");
  });
});

describe("quote", () => {
  test("wraps and escapes", () => {
    expect(quote("Shared Folders/agentproto")).toBe('"Shared Folders/agentproto"');
    expect(quote('a"b\\c')).toBe('"a\\"b\\\\c"');
  });
});
