/**
 * Who currently manages each list.
 *
 * Distinct from the community-conferred seed. The seed is global standing and
 * answers "did anyone established engage"; stewards are this list's current
 * chairs, ADs and moderators, and answer "did the people responsible for this
 * discussion engage". A thread with the first and not the second is a
 * discussion its own leadership has not touched — which is only visible if the
 * two are measured separately.
 *
 * A list with no Datatracker group has no stewards. That is recorded as
 * `group_found: false` and reported as a fact about the list, never inferred as
 * an absence of oversight.
 */
import type { ListStewardsFetched, PrivateEvent, PrivateSourceRef } from "../schema/generated.ts";
import type { EventStore } from "../store/event-store.ts";
import { makePrivateEvent } from "../events/factory.ts";
import { senderId } from "../lib/hash.ts";
import { DatatrackerClient, DATATRACKER_HOST, idFromUri, slugFromUri } from "./client.ts";

const SOURCE: PrivateSourceRef = { kind: "datatracker", name: DATATRACKER_HOST };

/** Roles that constitute stewardship of a discussion. */
const STEWARD_ROLES = ["chair", "ad", "delegate", "secr", "techadv"] as const;

interface GroupObject {
  id: number;
  acronym: string;
  type: string;
  state: string;
  charter: string | null;
}

interface RoleObject {
  name: string;
  email: string;
  person: string;
}

export interface StewardReport {
  list_name: string;
  group_found: boolean;
  stewards: number;
  roles: string[];
}

export async function fetchStewards(
  client: DatatrackerClient,
  store: EventStore<PrivateEvent>,
  lists: { name: string; group_acronym: string }[],
  now: () => Date = () => new Date(),
): Promise<StewardReport[]> {
  const pending: PrivateEvent[] = [];
  const reports: StewardReport[] = [];

  for (const list of lists) {
    const before = client.visited.length;
    const groups = await client.page<GroupObject>("group/group/", {
      acronym: list.group_acronym,
      limit: 1,
    });
    const group = groups.objects[0];

    const stewards: ListStewardsFetched["stewards"] = [];
    if (group) {
      const roles = await client.page<RoleObject>("group/role/", {
        group__acronym: list.group_acronym,
        limit: 50,
      });
      for (const role of roles.objects) {
        const slug = slugFromUri(role.name);
        if (!(STEWARD_ROLES as readonly string[]).includes(slug)) continue;
        // The email resource URI ends in the address itself.
        const address = decodeURIComponent(slugFromUri(role.email)).toLowerCase();
        const personId = idFromUri(role.person);
        if (!address || personId === null) continue;
        stewards.push({ role: slug, person_id: personId, address, sender_id: senderId(address) });
      }
      stewards.sort((a, b) => a.role.localeCompare(b.role) || a.address.localeCompare(b.address));
    }

    const payload: ListStewardsFetched = {
      list_name: list.name,
      group_acronym: list.group_acronym,
      group_found: Boolean(group),
      group_id: group?.id ?? null,
      group_type: group ? slugFromUri(group.type) : "",
      group_state: group ? slugFromUri(group.state) : "",
      charter_document: group?.charter ? slugFromUri(group.charter) : null,
      stewards,
      fetched_at: now().toISOString(),
      endpoints: client.visited.slice(before),
    };
    pending.push(makePrivateEvent("ListStewardsFetched", payload, SOURCE, now().toISOString()));
    reports.push({
      list_name: list.name,
      group_found: Boolean(group),
      stewards: stewards.length,
      roles: [...new Set(stewards.map((s) => s.role))].sort(),
    });
  }

  await store.append(pending);
  return reports;
}
