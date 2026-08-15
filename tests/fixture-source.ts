import type { MailboxSnapshot, MessageSource, RawMessage } from "../src/crawl/source.ts";
import type { SourceRef } from "../src/schema/generated.ts";

export interface FixtureMessage {
  uid: number;
  raw: string;
}

/**
 * In-memory {@link MessageSource}. Exists to prove the interface is the only
 * thing ingestion depends on — swapping IMAP out is a constructor argument.
 */
export class FixtureSource implements MessageSource {
  readonly ref: SourceRef = { kind: "fixture", name: "fixture" };
  connected = false;
  fetchCalls = 0;

  constructor(
    public messages: FixtureMessage[],
    public uidValidity = 1,
  ) {}

  async connect(): Promise<void> {
    this.connected = true;
  }

  async close(): Promise<void> {
    this.connected = false;
  }

  async snapshot(): Promise<MailboxSnapshot> {
    return { uidValidity: this.uidValidity, exists: this.messages.length };
  }

  async uids(_list: string, afterUid: number | null): Promise<number[]> {
    return this.messages
      .map((m) => m.uid)
      .filter((uid) => afterUid === null || uid > afterUid)
      .sort((a, b) => a - b);
  }

  async *fetch(_list: string, uids: readonly number[]): AsyncIterable<RawMessage> {
    this.fetchCalls += 1;
    const wanted = new Set(uids);
    for (const message of this.messages) {
      if (!wanted.has(message.uid)) continue;
      yield { uid: message.uid, source: new TextEncoder().encode(message.raw) };
    }
  }
}

export function rfc822(options: {
  messageId: string;
  from?: string;
  subject?: string;
  date?: string;
  inReplyTo?: string;
  references?: string;
  body?: string;
}): string {
  const lines = [
    `From: ${options.from ?? "Someone <someone@example.org>"}`,
    `To: testlist@ietf.org`,
    `Subject: ${options.subject ?? "a subject"}`,
    `Date: ${options.date ?? "Sat, 1 Aug 2026 00:00:00 +0000"}`,
    `Message-ID: <${options.messageId}>`,
  ];
  if (options.inReplyTo) lines.push(`In-Reply-To: <${options.inReplyTo}>`);
  if (options.references) lines.push(`References: ${options.references}`);
  lines.push("MIME-Version: 1.0", 'Content-Type: text/plain; charset="utf-8"', "");
  lines.push(options.body ?? "Body text.");
  return lines.join("\r\n");
}
