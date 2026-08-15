/**
 * The address book that never leaves this machine.
 *
 * The public event log carries only `sender_id`, a hash. This file is the only
 * place the plaintext address and display name exist, and `private/` is
 * gitignored. Keeping it out of the log is not reversible caution — the log is
 * immutable, so an address committed once is committed for good.
 *
 * Losing this file loses nothing that the published measures depend on: they are
 * all keyed on `sender_id`. It is an operator convenience for private analysis.
 */
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { PRIVATE_DIR } from "../lib/paths.ts";

export interface SenderRecord {
  sender_id: string;
  address: string;
  display_name: string;
  list_name: string;
  first_observed_at: string;
}

/**
 * Dedupe key for a record. Fields are joined with NUL, which cannot occur in an
 * address, a display name, or a list name, so no combination of values can
 * collide with another.
 */
function dedupeKey(record: SenderRecord): string {
  return [record.sender_id, record.display_name, record.list_name].join("\u0000");
}

export class PrivateSenderMap {
  #path: string;
  #seen: Set<string> | undefined;
  #pending: SenderRecord[] = [];

  constructor(path: string = join(PRIVATE_DIR, "senders.jsonl")) {
    this.#path = path;
  }

  async record(record: SenderRecord): Promise<void> {
    const seen = await this.#load();
    const key = dedupeKey(record);
    if (seen.has(key)) return;
    seen.add(key);
    this.#pending.push(record);
  }

  async flush(): Promise<number> {
    if (this.#pending.length === 0) return 0;
    await mkdir(dirname(this.#path), { recursive: true });
    await appendFile(
      this.#path,
      this.#pending.map((r) => JSON.stringify(r)).join("\n") + "\n",
      "utf8",
    );
    const written = this.#pending.length;
    this.#pending = [];
    return written;
  }

  async #load(): Promise<Set<string>> {
    if (this.#seen) return this.#seen;
    const seen = new Set<string>();
    const file = Bun.file(this.#path);
    if (await file.exists()) {
      for (const line of (await file.text()).split("\n")) {
        if (!line.trim()) continue;
        const r = JSON.parse(line) as SenderRecord;
        seen.add(dedupeKey(r));
      }
    }
    this.#seen = seen;
    return seen;
  }
}
