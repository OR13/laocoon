/**
 * Identity resolution against the datatracker, written to the private log.
 *
 * Facts only. This module fetches what the datatracker says about a person and
 * records it; whether that makes them part of the community-conferred seed is
 * decided later by `src/seed/rule.ts`, as a projection. Keeping the two apart
 * means the rule can be argued with and re-run without touching the network and
 * without rewriting a single event.
 *
 * Every query is a filtered count. The datatracker can filter roles by group
 * type and acronym server-side, so a person's WG-chair status costs one request
 * rather than one request per group they have ever held a role in.
 */
import type {
  DatatrackerRecordFetched,
  PrivateEvent,
  PrivateSourceRef,
  RoleFact,
  SenderResolved,
} from "../schema/generated.ts";
import type { EventStore } from "../store/event-store.ts";
import { DatatrackerClient, DATATRACKER_HOST, idFromUri, slugFromUri } from "./client.ts";
import { makePrivateEvent } from "../events/factory.ts";

/** Documents recorded per person. Existence decides the rule; the rest is audit. */
const MAX_DOCUMENT_NAMES = 10;
/** Role examples recorded per clause. */
const ROLE_SAMPLE = 5;

const SOURCE: PrivateSourceRef = { kind: "datatracker", name: DATATRACKER_HOST };

interface EmailObject {
  address: string;
  origin: string;
  person: string | null;
}

interface RoleObject {
  group: string;
  name: string;
}

interface DocumentAuthorObject {
  document: string;
}

export interface SenderInput {
  sender_id: string;
  address: string;
}

export interface ResolveReport {
  addresses: number;
  matched: number;
  noRecord: number;
  personsFetched: number;
  personsAlreadyKnown: number;
  eventsAppended: number;
  eventsDuplicate: number;
  requests: number;
  failures: { address: string; reason: string }[];
}

/**
 * Resolve each address and fetch the person's record.
 *
 * A person already present in the private log is not re-fetched unless
 * `refresh` is set: datatracker roles change on the timescale of IETF cycles,
 * not hours, and this is someone else's server.
 */
export async function resolveSenders(
  client: DatatrackerClient,
  store: EventStore<PrivateEvent>,
  senders: readonly SenderInput[],
  options: { refresh?: boolean; now?: () => Date } = {},
): Promise<ResolveReport> {
  const now = options.now ?? (() => new Date());
  const known = await knownPersonIds(store);

  const pending: PrivateEvent[] = [];
  const failures: { address: string; reason: string }[] = [];
  const fetchedThisRun = new Set<number>();
  let matched = 0;
  let noRecord = 0;
  let alreadyKnown = 0;

  for (const sender of senders) {
    let email: EmailObject | undefined;
    try {
      const page = await client.page<EmailObject>("person/email/", {
        address: sender.address,
        limit: 1,
      });
      email = page.objects[0];
    } catch (error) {
      failures.push({ address: sender.address, reason: describe(error) });
      continue;
    }

    const personId = idFromUri(email?.person);
    const resolution: SenderResolved = {
      sender_id: sender.sender_id,
      address: sender.address,
      person_id: personId,
      resolution: personId === null ? "no_record" : "matched",
      origin: email?.origin ?? "",
    };
    pending.push(makePrivateEvent("SenderResolved", resolution, SOURCE, now().toISOString()));

    if (personId === null) {
      noRecord += 1;
      continue;
    }
    matched += 1;

    if (fetchedThisRun.has(personId)) continue;
    if (known.has(personId) && !options.refresh) {
      alreadyKnown += 1;
      continue;
    }

    try {
      const record = await fetchPersonRecord(client, personId, now);
      fetchedThisRun.add(personId);
      pending.push(
        makePrivateEvent("DatatrackerRecordFetched", record, SOURCE, now().toISOString()),
      );
    } catch (error) {
      failures.push({ address: sender.address, reason: `person ${personId}: ${describe(error)}` });
    }
  }

  const appended = await store.append(pending);
  return {
    addresses: senders.length,
    matched,
    noRecord,
    personsFetched: fetchedThisRun.size,
    personsAlreadyKnown: alreadyKnown,
    eventsAppended: appended.appended,
    eventsDuplicate: appended.duplicates,
    requests: client.visited.length,
    failures,
  };
}

/**
 * Everything the seed rule can consult about one person.
 *
 * Eight filtered queries. Each asks the datatracker a question whose answer is
 * the fact; nothing is inferred from a group object fetched afterwards.
 */
export async function fetchPersonRecord(
  client: DatatrackerClient,
  personId: number,
  now: () => Date,
): Promise<DatatrackerRecordFetched> {
  const before = client.visited.length;

  const chairCurrent = await roles(client, "group/role/", personId, {
    name: "chair",
    group__type: "wg",
  }, "wg", true);
  const chairPast = await roles(client, "group/rolehistory/", personId, {
    name: "chair",
    group__type: "wg",
  }, "wg", false);

  const adCurrent = await roles(client, "group/role/", personId, { name: "ad" }, "", true);
  const adPast = await roles(client, "group/rolehistory/", personId, { name: "ad" }, "", false);

  const bodyCurrent = await roles(client, "group/role/", personId, {
    group__acronym__in: "iab,iesg",
  }, "iab_or_iesg", true);
  const bodyPast = await roles(client, "group/rolehistory/", personId, {
    group__acronym__in: "iab,iesg",
  }, "iab_or_iesg", false);

  const rfcPage = await client.page<DocumentAuthorObject>("doc/documentauthor/", {
    person: personId,
    document__type: "rfc",
    limit: 1,
  });

  const documents = await adoptedDocumentNames(client, personId);

  return {
    person_id: personId,
    fetched_at: now().toISOString(),
    chair_roles: [...chairCurrent, ...chairPast],
    ad_roles: [...adCurrent, ...adPast],
    iab_iesg_roles: [...bodyCurrent, ...bodyPast],
    rfc_authorships: rfcPage.meta.total_count,
    wg_document_authorships: documents,
    endpoints: client.visited.slice(before),
  };
}

async function roles(
  client: DatatrackerClient,
  path: string,
  personId: number,
  filters: Record<string, string>,
  groupType: string,
  current: boolean,
): Promise<RoleFact[]> {
  const page = await client.page<RoleObject>(path, {
    person: personId,
    limit: ROLE_SAMPLE,
    ...filters,
  });
  return page.objects.map((object) => ({
    role: slugFromUri(object.name),
    group_ref: object.group,
    group_type: groupType,
    current,
  }));
}

/**
 * Names of adopted working-group documents this person authored.
 *
 * The server filter narrows to documents whose group is a working group; the
 * `draft-ietf-` test is then applied to the actual name, because the group
 * filter is evidence of adoption, not proof of it. Paging stops as soon as the
 * cap is reached — existence is all the rule needs.
 */
async function adoptedDocumentNames(
  client: DatatrackerClient,
  personId: number,
): Promise<string[]> {
  const names: string[] = [];
  for await (const object of client.all<DocumentAuthorObject>(
    "doc/documentauthor/",
    { person: personId, document__group__type: "wg", limit: 25 },
    3,
  )) {
    const name = slugFromUri(object.document);
    if (name.startsWith("draft-ietf-") && !names.includes(name)) names.push(name);
    if (names.length >= MAX_DOCUMENT_NAMES) break;
  }
  return names;
}

/** Person ids already recorded, so a re-run does not re-ask. */
async function knownPersonIds(store: EventStore<PrivateEvent>): Promise<Set<number>> {
  const known = new Set<number>();
  for await (const event of store.read()) {
    if (event.event_type === "DatatrackerRecordFetched") {
      known.add((event.payload as unknown as DatatrackerRecordFetched).person_id);
    }
  }
  return known;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
