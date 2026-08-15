#!/usr/bin/env bun
/**
 * Resolve list senders against the datatracker, into the private log.
 *
 *   bun run resolve
 *   bun run resolve --refresh        # re-ask about people already recorded
 *   bun run resolve --limit 5        # budgeted first pass
 *
 * Input is `private/senders.jsonl`, written by ingestion. Output is
 * `private/events/`. Neither is committed, and this command writes nothing to
 * the public log.
 *
 * Addresses are never printed. A failure is reported by the sender hash that
 * appears in the public log, so a captured terminal or a launchd log does not
 * become the address list the hashing exists to avoid.
 */
import { parseArgs } from "node:util";
import { join } from "node:path";
import type { PrivateEvent } from "../schema/generated.ts";
import { JsonlEventStore } from "../store/jsonl-store.ts";
import { DatatrackerClient } from "../datatracker/client.ts";
import { resolveSenders, type SenderInput } from "../datatracker/resolve.ts";
import { PRIVATE_DIR } from "../lib/paths.ts";

const { values } = parseArgs({
  options: {
    refresh: { type: "boolean", default: false },
    limit: { type: "string" },
    "min-interval-ms": { type: "string", default: "400" },
  },
});

const sendersPath = join(PRIVATE_DIR, "senders.jsonl");
const file = Bun.file(sendersPath);
if (!(await file.exists())) {
  throw new Error(`no ${sendersPath}: run \`bun run ingest\` first`);
}

const byId = new Map<string, SenderInput>();
for (const line of (await file.text()).split("\n")) {
  if (!line.trim()) continue;
  const record = JSON.parse(line) as { sender_id: string; address: string };
  if (!byId.has(record.sender_id)) {
    byId.set(record.sender_id, { sender_id: record.sender_id, address: record.address });
  }
}

const senderByAddress = new Map([...byId.values()].map((s) => [s.address, s.sender_id]));

let senders = [...byId.values()];
if (values.limit) senders = senders.slice(0, Number(values.limit));

const client = new DatatrackerClient({ minIntervalMs: Number(values["min-interval-ms"]) });
const store = new JsonlEventStore<PrivateEvent>(join(PRIVATE_DIR, "events"), "private-event");

const report = await resolveSenders(client, store, senders, { refresh: values.refresh });

console.log(
  JSON.stringify(
    {
      ...report,
      failures: report.failures.map((f) => ({
        sender: (senderByAddress.get(f.address) ?? "unknown").slice(0, 20),
        reason: f.reason,
      })),
    },
    null,
    2,
  ),
);
