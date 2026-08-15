#!/usr/bin/env bun
/**
 * Propagate reputation from the community-conferred seed, and detect clusters.
 *
 *   bun run seed && bun run reputation
 *
 * Writes two artifacts and validates both. The split is the point:
 *
 *   private/artifacts/reputation.json      per-account, `publication: private`
 *   artifacts/community-structure.json     aggregate, names nobody
 *
 * This command refuses to write an aggregate artifact that is not marked
 * `aggregate_public`, and refuses to write the per-account one anywhere other
 * than under `private/`. Both checks are cheap and both failures would be
 * unrecoverable if they reached a public repository.
 */
import { parseArgs } from "node:util";
import { mkdir } from "node:fs/promises";
import { join, resolve as resolvePath } from "node:path";
import { assertValid } from "../store/validate.ts";
import { ARTIFACTS_DIR, PRIVATE_DIR, repoPath } from "../lib/paths.ts";

const { values } = parseArgs({
  options: {
    list: { type: "string", multiple: true },
    "private-out": { type: "string" },
    "aggregate-out": { type: "string" },
  },
});

// Per list. The account graph differs between lists, so one shared reputation
// file silently gave every agent2agent account a score of zero — computed from
// a graph it was not in.
const suffix = (values.list ?? []).length === 1 ? `-${values.list![0]}` : "";
const privateOut = resolvePath(
  values["private-out"] ?? join(PRIVATE_DIR, "artifacts", `reputation${suffix}.json`),
);
const aggregateOut = resolvePath(
  values["aggregate-out"] ?? join(ARTIFACTS_DIR, `community-structure${suffix}.json`),
);

if (!privateOut.startsWith(PRIVATE_DIR + "/")) {
  throw new Error(
    `refusing to write per-account reputation outside private/: ${privateOut}`,
  );
}

const seedPath = join(PRIVATE_DIR, "artifacts", "seed.json");
if (!(await Bun.file(seedPath).exists())) {
  throw new Error(`no ${seedPath}: run \`bun run seed\` first`);
}

await mkdir(join(PRIVATE_DIR, "artifacts"), { recursive: true });
await mkdir(ARTIFACTS_DIR, { recursive: true });

const args = [
  "run",
  "--quiet",
  "--directory",
  repoPath("python"),
  "python",
  "-m",
  "laocoon.reputation",
  "--events",
  repoPath("events"),
  "--seed",
  seedPath,
  "--out",
  privateOut,
  "--aggregate-out",
  aggregateOut,
];
for (const list of values.list ?? []) args.push("--list", list);

const proc = Bun.spawn(["uv", ...args], { stdout: "inherit", stderr: "inherit" });
const code = await proc.exited;
if (code !== 0) throw new Error(`laocoon.reputation exited ${code}`);

await assertValid("account-reputation", await Bun.file(privateOut).json());
const aggregate = await Bun.file(aggregateOut).json();
await assertValid("community-structure", aggregate);

if (aggregate.publication !== "aggregate_public") {
  throw new Error(`aggregate artifact is not marked aggregate_public: ${aggregateOut}`);
}

// Belt and braces: the aggregate must not contain a sender hash. The schema
// forbids the fields that would carry one, but the check is one line and the
// mistake would be published.
if (/sha256:[0-9a-f]{64}/.test(await Bun.file(aggregateOut).text())) {
  throw new Error(`aggregate artifact contains a sender hash: ${aggregateOut}`);
}

console.log(`\nboth artifacts validate; aggregate contains no sender hash`);
