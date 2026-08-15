#!/usr/bin/env bun
/**
 * Fetch each list's current chairs, ADs and moderators into the private log.
 *
 *   bun run stewards
 *
 * Private, because it maps named people to a list. The *counts* that reach the
 * dashboard are aggregate; this is the join behind them.
 */
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { PrivateEvent } from "../schema/generated.ts";
import { JsonlEventStore } from "../store/jsonl-store.ts";
import { DatatrackerClient } from "../datatracker/client.ts";
import { fetchStewards } from "../datatracker/stewards.ts";
import { PRIVATE_DIR, repoPath } from "../lib/paths.ts";

const config = parseYaml(await Bun.file(repoPath("lists.yaml")).text()) as {
  lists: { name: string; group_acronym: string; enabled: boolean }[];
};
const lists = config.lists.filter((l) => l.enabled);

const store = new JsonlEventStore<PrivateEvent>(join(PRIVATE_DIR, "events"), "private-event");
const reports = await fetchStewards(new DatatrackerClient(), store, lists);

console.log(JSON.stringify(reports, null, 2));
for (const r of reports) {
  if (!r.group_found) {
    console.log(
      `\n${r.list_name}: no Datatracker group, so no stewards. That is a fact ` +
        `about the list, not a gap — a plain mailing list has no chairs to find.`,
    );
  }
}
