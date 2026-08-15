/**
 * JSONL-on-disk implementation of {@link EventStore}, partitioned by observation
 * date: `events/YYYY/MM/DD.jsonl`.
 *
 * Partitioning by *observation* date rather than by the date a message was sent
 * is what makes the log genuinely append-only — a run only ever appends to
 * today's file and never rewrites yesterday's. Ordering within a file is append
 * order; ordering across files is lexicographic path order, which for this naming
 * scheme is chronological.
 *
 * Deduplication is an in-memory set of `event_id`, built by scanning the log
 * once. That is O(events) per process. At the corpus size this project targets
 * (10^2 to 10^5 events) the scan is milliseconds; past roughly 10^6 it needs a
 * sidecar index, and that is the point at which this implementation should be
 * replaced rather than patched.
 */
import { appendFile, mkdir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Event } from "../schema/generated.ts";
import type { AppendResult, EventStore } from "./event-store.ts";
import { assertValidEvent } from "./validate.ts";

export class JsonlEventStore implements EventStore {
  #index: Set<string> | undefined;

  constructor(private readonly root: string) {}

  async append(events: readonly Event[]): Promise<AppendResult> {
    const index = await this.#loadIndex();
    const byPartition = new Map<string, string[]>();
    let duplicates = 0;

    for (const event of events) {
      await assertValidEvent(event);
      if (index.has(event.event_id)) {
        duplicates += 1;
        continue;
      }
      index.add(event.event_id);
      const path = this.#partitionPath(event.observed_at);
      const lines = byPartition.get(path) ?? [];
      lines.push(JSON.stringify(event));
      byPartition.set(path, lines);
    }

    let appended = 0;
    for (const [path, lines] of [...byPartition].sort()) {
      await mkdir(dirname(path), { recursive: true });
      await appendFile(path, lines.join("\n") + "\n", "utf8");
      appended += lines.length;
    }
    return { appended, duplicates };
  }

  async *read(): AsyncIterable<Event> {
    for (const path of await this.#partitions()) {
      const text = await Bun.file(path).text();
      let lineNo = 0;
      for (const line of text.split("\n")) {
        lineNo += 1;
        if (!line.trim()) continue;
        try {
          yield JSON.parse(line) as Event;
        } catch (cause) {
          throw new Error(`corrupt event log line ${path}:${lineNo}`, { cause });
        }
      }
    }
  }

  async has(eventId: string): Promise<boolean> {
    return (await this.#loadIndex()).has(eventId);
  }

  async count(): Promise<number> {
    return (await this.#loadIndex()).size;
  }

  #partitionPath(observedAt: string): string {
    const d = new Date(observedAt);
    if (Number.isNaN(d.getTime())) throw new Error(`unparseable observed_at: ${observedAt}`);
    const yyyy = String(d.getUTCFullYear());
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    return join(this.root, yyyy, mm, `${dd}.jsonl`);
  }

  /** All partition files, in chronological order. */
  async #partitions(): Promise<string[]> {
    const found: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return; // no log yet
      }
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) await walk(path);
        else if (entry.name.endsWith(".jsonl")) found.push(path);
      }
    };
    await walk(this.root);
    return found.sort();
  }

  async #loadIndex(): Promise<Set<string>> {
    if (this.#index) return this.#index;
    const index = new Set<string>();
    for await (const event of this.read()) index.add(event.event_id);
    this.#index = index;
    return index;
  }
}
