/**
 * A minimal, read-only IMAP4rev1 client.
 *
 * Written rather than taken off the shelf because the obvious choice does not
 * work against the only server this project talks to. imapflow 1.7.1 raises
 * inside its NAMESPACE handler when a server returns a NIL personal namespace,
 * as imap.ietf.org does; the exception happens before `response.next()`, so the
 * command queue never drains and `connect()` hangs forever with no output. A
 * daily unattended job cannot be built on that, and patching a dependency in
 * place is worse than owning 200 lines of protocol.
 *
 * The surface is deliberately tiny: LOGIN, EXAMINE, UID SEARCH, UID FETCH,
 * LOGOUT. There is no SELECT, no STORE, no APPEND — this client is structurally
 * incapable of modifying a mailbox. Every command carries a timeout, so a server
 * that stops answering fails the run instead of hanging it.
 */

export class ImapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImapError";
  }
}

/**
 * One logical response line, with any literals lifted out of the text.
 * Exported for tests: line and literal framing is the part of this file most
 * likely to be wrong, so it is exercised directly rather than over a socket.
 */
export interface ResponseLine {
  text: string;
  literals: Uint8Array[];
}

const LF = 0x0a;
const CR = 0x0d;
const LITERAL_PLACEHOLDER = " ";

/**
 * Byte stream with line and exact-length reads.
 *
 * Chunks are kept in a queue with a read offset rather than concatenated, so
 * reading a multi-megabyte FETCH batch stays linear.
 */
export class ByteStream {
  #chunks: Uint8Array[] = [];
  #offset = 0;
  #available = 0;
  #wake: (() => void) | null = null;
  #error: Error | null = null;
  #ended = false;

  push(chunk: Uint8Array): void {
    if (chunk.length === 0) return;
    this.#chunks.push(chunk);
    this.#available += chunk.length;
    this.#signal();
  }

  end(): void {
    this.#ended = true;
    this.#signal();
  }

  fail(error: Error): void {
    this.#error ??= error;
    this.#signal();
  }

  async readLine(): Promise<string> {
    for (;;) {
      const index = this.#indexOfLF();
      if (index !== -1) {
        const raw = this.#take(index + 1);
        let end = raw.length - 1;
        if (end > 0 && raw[end - 1] === CR) end -= 1;
        return new TextDecoder("utf-8").decode(raw.subarray(0, end));
      }
      await this.#more();
    }
  }

  async readExact(n: number): Promise<Uint8Array> {
    while (this.#available < n) await this.#more();
    return this.#take(n);
  }

  #signal(): void {
    const wake = this.#wake;
    this.#wake = null;
    wake?.();
  }

  async #more(): Promise<void> {
    if (this.#error) throw this.#error;
    if (this.#ended) throw new ImapError("connection closed by the server");
    await new Promise<void>((resolve) => {
      this.#wake = resolve;
    });
    if (this.#error) throw this.#error;
  }

  #indexOfLF(): number {
    let seen = 0;
    for (let i = 0; i < this.#chunks.length; i += 1) {
      const chunk = this.#chunks[i]!;
      const start = i === 0 ? this.#offset : 0;
      const found = chunk.indexOf(LF, start);
      if (found !== -1) return seen + (found - start);
      seen += chunk.length - start;
    }
    return -1;
  }

  #take(n: number): Uint8Array {
    const out = new Uint8Array(n);
    let written = 0;
    while (written < n) {
      const chunk = this.#chunks[0]!;
      const take = Math.min(chunk.length - this.#offset, n - written);
      out.set(chunk.subarray(this.#offset, this.#offset + take), written);
      written += take;
      this.#offset += take;
      if (this.#offset >= chunk.length) {
        this.#chunks.shift();
        this.#offset = 0;
      }
    }
    this.#available -= n;
    return out;
  }
}

export interface ImapClientOptions {
  host: string;
  port?: number;
  /** Milliseconds a single command may take before the run fails. */
  commandTimeoutMs?: number;
}

export interface MailboxStatus {
  uidValidity: number;
  exists: number;
}

export interface FetchedMessage {
  uid: number;
  source: Uint8Array;
}

export class ImapClient {
  #socket: Awaited<ReturnType<typeof Bun.connect>> | undefined;
  #stream = new ByteStream();
  #tag = 0;
  #host: string;
  #port: number;
  #timeoutMs: number;

  constructor(options: ImapClientOptions) {
    this.#host = options.host;
    this.#port = options.port ?? 993;
    this.#timeoutMs = options.commandTimeoutMs ?? 60_000;
  }

  async connect(): Promise<void> {
    if (this.#socket) return;
    this.#stream = new ByteStream();
    this.#socket = await Bun.connect({
      hostname: this.#host,
      port: this.#port,
      tls: true,
      socket: {
        data: (_socket, data) => this.#stream.push(new Uint8Array(data)),
        close: () => this.#stream.end(),
        error: (_socket, error) => this.#stream.fail(error),
        connectError: (_socket, error) => this.#stream.fail(error),
      },
    });
    const greeting = await this.#deadline(this.#readLine(), "greeting");
    if (!/^\* (OK|PREAUTH)\b/.test(greeting.text)) {
      throw new ImapError(`unexpected greeting: ${greeting.text}`);
    }
  }

  async login(user: string, pass: string): Promise<void> {
    // LOGIN, not AUTHENTICATE PLAIN: imap.ietf.org advertises AUTH=PLAIN but
    // answers "AUTHENTICATION has failed" to it for the anonymous account.
    await this.#exec(`LOGIN ${quote(user)} ${quote(pass)}`);
  }

  /** Open a mailbox read-only. EXAMINE, never SELECT. */
  async examine(mailbox: string): Promise<MailboxStatus> {
    let uidValidity = 0;
    let exists = 0;
    await this.#exec(`EXAMINE ${quote(mailbox)}`, (line) => {
      const validity = line.text.match(/\[UIDVALIDITY (\d+)\]/i);
      if (validity) uidValidity = Number(validity[1]);
      const count = line.text.match(/^\* (\d+) EXISTS\b/i);
      if (count) exists = Number(count[1]);
    });
    return { uidValidity, exists };
  }

  /** UIDs matching a search key, ascending. */
  async uidSearch(criteria: string): Promise<number[]> {
    const uids: number[] = [];
    await this.#exec(`UID SEARCH ${criteria}`, (line) => {
      const match = line.text.match(/^\* SEARCH\b(.*)$/i);
      if (!match) return;
      for (const token of match[1]!.trim().split(/\s+/)) {
        if (token) uids.push(Number(token));
      }
    });
    return uids.filter((uid) => Number.isFinite(uid)).sort((a, b) => a - b);
  }

  /** Full messages for a UID set. BODY.PEEK, so the \Seen flag is never set. */
  async uidFetch(uidSet: string): Promise<FetchedMessage[]> {
    const messages: FetchedMessage[] = [];
    await this.#exec(`UID FETCH ${uidSet} (UID BODY.PEEK[])`, (line) => {
      if (!/^\* \d+ FETCH /i.test(line.text)) return;
      const uid = line.text.match(/\bUID (\d+)/i);
      const body = line.literals[0];
      if (!uid || !body) return;
      messages.push({ uid: Number(uid[1]), source: body });
    });
    return messages;
  }

  async logout(): Promise<void> {
    if (!this.#socket) return;
    try {
      await this.#exec("LOGOUT");
    } catch {
      // The server hanging up mid-LOGOUT is the expected outcome, not an error.
    } finally {
      this.#socket.end();
      this.#socket = undefined;
    }
  }

  /** Drop the connection without a LOGOUT roundtrip. */
  destroy(): void {
    this.#socket?.end();
    this.#socket = undefined;
  }

  async #exec(
    command: string,
    onUntagged?: (line: ResponseLine) => void,
  ): Promise<ResponseLine> {
    if (!this.#socket) throw new ImapError("not connected");
    const tag = `L${String(++this.#tag).padStart(4, "0")}`;
    const verb = command.split(" ", 1)[0]!;
    this.#socket.write(`${tag} ${command}\r\n`);

    const run = async (): Promise<ResponseLine> => {
      for (;;) {
        const line = await this.#readLine();
        if (line.text.startsWith(`${tag} `)) {
          const status = line.text.slice(tag.length + 1).split(" ", 1)[0];
          if (status !== "OK") throw new ImapError(`${verb} failed: ${line.text}`);
          return line;
        }
        if (line.text.startsWith("+")) continue; // continuation request; unused
        onUntagged?.(line);
      }
    };
    return this.#deadline(run(), verb);
  }

  #readLine(): Promise<ResponseLine> {
    return readResponseLine(this.#stream);
  }

  async #deadline<T>(work: Promise<T>, what: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new ImapError(`${what} timed out after ${this.#timeoutMs}ms`)),
        this.#timeoutMs,
      );
    });
    try {
      return await Promise.race([work, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Read one logical response line.
 *
 * A line ending in `{n}` is followed by exactly n bytes of literal and then the
 * rest of the same logical line. The literal is lifted out and its position
 * replaced by a space, so callers can match the response against plain text
 * without worrying about where the message body happened to sit.
 */
export async function readResponseLine(stream: ByteStream): Promise<ResponseLine> {
  let text = await stream.readLine();
  const literals: Uint8Array[] = [];
  for (;;) {
    const match = text.match(/\{(\d+)\+?\}$/);
    if (!match) return { text, literals };
    literals.push(await stream.readExact(Number(match[1])));
    text = text.slice(0, match.index) + LITERAL_PLACEHOLDER + (await stream.readLine());
  }
}

/** IMAP quoted string. */
export function quote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
