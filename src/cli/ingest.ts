#!/usr/bin/env bun
/**
 * Crawl a list and append what it saw to the event log.
 *
 *   bun run ingest --list agentproto
 *   bun run ingest --list agentproto --mode full
 *   bun run ingest --list agentproto --max 25        # budgeted first crawl
 *
 * Anonymous IMAP needs a contact address: set LAOCOON_IMAP_EMAIL.
 */
import { parseArgs } from "node:util";
import { ImapSource } from "../crawl/imap-source.ts";
import { JsonlEventStore } from "../store/jsonl-store.ts";
import { ingestList } from "../ingest/ingest.ts";
import { EVENTS_DIR } from "../lib/paths.ts";

const { values } = parseArgs({
  options: {
    list: { type: "string", default: "agentproto" },
    mode: { type: "string", default: "incremental" },
    max: { type: "string" },
    "min-interval-ms": { type: "string", default: "1000" },
    "batch-size": { type: "string", default: "25" },
  },
});

if (values.mode !== "incremental" && values.mode !== "full") {
  throw new Error(`--mode must be "incremental" or "full", got ${values.mode}`);
}

const source = new ImapSource({
  minIntervalMs: Number(values["min-interval-ms"]),
  batchSize: Number(values["batch-size"]),
});
const store = new JsonlEventStore(EVENTS_DIR);

try {
  const report = await ingestList(source, store, {
    listName: values.list!,
    mode: values.mode,
    maxMessages: values.max ? Number(values.max) : undefined,
  });

  console.log(JSON.stringify(report, null, 2));
  if (report.truncated) {
    console.warn(
      `\n--max stopped this crawl early. Coverage is partial: ` +
        `${report.uidsExamined} of the UIDs above the watermark were examined.`,
    );
  }
  if (report.failures.length > 0) {
    console.warn(`\n${report.failures.length} UID(s) failed; recorded in the crawl window.`);
  }
} finally {
  await source.close();
}
