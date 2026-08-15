/**
 * IMAP implementation of {@link MessageSource}, against imap.ietf.org.
 *
 * Deliberately a good citizen of infrastructure this project does not own:
 *
 *   * read-only — mailboxes are opened with EXAMINE, and the client underneath
 *     has no command that can modify a mailbox;
 *   * rate limited — a minimum interval between commands;
 *   * batched — messages are fetched in UID ranges, so 106 messages cost a
 *     handful of commands rather than 106 round trips.
 *
 * Anonymous access uses an email address as the password. That is the IETF's
 * convention for the public archive, not a credential, so it lives in
 * configuration rather than behind a secret manager.
 */
import type { SourceRef } from "../schema/generated.ts";
import type { MailboxSnapshot, MessageSource, RawMessage } from "./source.ts";
import { ImapClient } from "./imap-client.ts";
import { RateLimiter } from "./rate-limiter.ts";

export interface ImapSourceOptions {
  host?: string;
  port?: number;
  user?: string;
  /** For anonymous access this is a contact email address, not a secret. */
  pass?: string;
  /** Lists live under this prefix on imap.ietf.org. */
  mailboxPrefix?: string;
  minIntervalMs?: number;
  /** UIDs per FETCH command. */
  batchSize?: number;
  commandTimeoutMs?: number;
}

const DEFAULTS = {
  host: "imap.ietf.org",
  port: 993,
  user: "anonymous",
  mailboxPrefix: "Shared Folders/",
  minIntervalMs: 1000,
  batchSize: 25,
  commandTimeoutMs: 120_000,
} as const;

export class ImapSource implements MessageSource {
  readonly ref: SourceRef;
  #client: ImapClient | undefined;
  #limiter: RateLimiter;
  #opts: Required<ImapSourceOptions>;
  #examined: string | undefined;

  constructor(options: ImapSourceOptions = {}) {
    const pass =
      options.pass ?? process.env.LAOCOON_IMAP_EMAIL ?? process.env.IETF_IMAP_EMAIL ?? "";
    if (!pass) {
      throw new Error(
        "anonymous IMAP access needs a contact email address: set LAOCOON_IMAP_EMAIL",
      );
    }
    this.#opts = {
      host: options.host ?? DEFAULTS.host,
      port: options.port ?? DEFAULTS.port,
      user: options.user ?? DEFAULTS.user,
      pass,
      mailboxPrefix: options.mailboxPrefix ?? DEFAULTS.mailboxPrefix,
      minIntervalMs: options.minIntervalMs ?? DEFAULTS.minIntervalMs,
      batchSize: options.batchSize ?? DEFAULTS.batchSize,
      commandTimeoutMs: options.commandTimeoutMs ?? DEFAULTS.commandTimeoutMs,
    };
    this.#limiter = new RateLimiter(this.#opts.minIntervalMs);
    this.ref = { kind: "imap", name: this.#opts.host };
  }

  async connect(): Promise<void> {
    if (this.#client) return;
    const client = new ImapClient({
      host: this.#opts.host,
      port: this.#opts.port,
      commandTimeoutMs: this.#opts.commandTimeoutMs,
    });
    await client.connect();
    await client.login(this.#opts.user, this.#opts.pass);
    this.#client = client;
    this.#examined = undefined;
  }

  async close(): Promise<void> {
    const client = this.#client;
    this.#client = undefined;
    this.#examined = undefined;
    await client?.logout();
  }

  mailboxPath(listName: string): string {
    return listName.includes("/") ? listName : this.#opts.mailboxPrefix + listName;
  }

  async snapshot(listName: string): Promise<MailboxSnapshot> {
    const { client, status } = await this.#examine(listName, true);
    void client;
    return status;
  }

  async uids(listName: string, afterUid: number | null): Promise<number[]> {
    const { client } = await this.#examine(listName);
    await this.#limiter.wait();
    const found = await client.uidSearch(afterUid === null ? "ALL" : `UID ${afterUid + 1}:*`);
    // An IMAP `n:*` range always matches the highest UID even when it is below
    // n, so the server's answer is filtered rather than trusted.
    const floor = afterUid ?? 0;
    return found.filter((uid) => uid > floor);
  }

  async *fetch(listName: string, uids: readonly number[]): AsyncIterable<RawMessage> {
    if (uids.length === 0) return;
    const { client } = await this.#examine(listName);
    for (let i = 0; i < uids.length; i += this.#opts.batchSize) {
      const batch = uids.slice(i, i + this.#opts.batchSize);
      await this.#limiter.wait();
      for (const message of await client.uidFetch(batch.join(","))) {
        yield { uid: message.uid, source: message.source };
      }
    }
  }

  /** EXAMINE the mailbox if it is not already the open one. */
  async #examine(
    listName: string,
    force = false,
  ): Promise<{ client: ImapClient; status: MailboxSnapshot }> {
    await this.connect();
    const client = this.#client!;
    const path = this.mailboxPath(listName);
    if (!force && this.#examined === path && this.#status) {
      return { client, status: this.#status };
    }
    await this.#limiter.wait();
    const status = await client.examine(path);
    this.#examined = path;
    this.#status = status;
    return { client, status };
  }

  #status: MailboxSnapshot | undefined;
}
