#!/usr/bin/env bun
/**
 * Regenerate the reply graph projection.
 *
 *   bun run graph
 *   bun run graph --list agentproto
 *
 * The graph is built in Python (networkx) and handed back as a schema-versioned
 * JSON artifact on disk. This process validates that artifact against the same
 * generated schema the Python side was written from, so a drift between the two
 * runtimes fails here instead of surfacing as a wrong number on the site.
 */
import { parseArgs } from "node:util";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { ARTIFACTS_DIR, repoPath } from "../lib/paths.ts";

const { values } = parseArgs({
  options: {
    list: { type: "string", multiple: true },
    out: { type: "string" },
  },
});

const out = values.out ?? join(ARTIFACTS_DIR, "reply-graph.json");
await mkdir(ARTIFACTS_DIR, { recursive: true });

const args = [
  "run",
  "--quiet",
  "--directory",
  repoPath("python"),
  "python",
  "-m",
  "laocoon.reply_graph",
  "--events",
  repoPath("events"),
  "--out",
  out,
];
for (const list of values.list ?? []) args.push("--list", list);

const proc = Bun.spawn(["uv", ...args], { stdout: "inherit", stderr: "inherit" });
const code = await proc.exited;
if (code !== 0) throw new Error(`reply_graph exited ${code}`);

const schema = await Bun.file(repoPath("schemas", "generated", "reply-graph.json")).json();
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);
const artifact = await Bun.file(out).json();
if (!validate(artifact)) {
  for (const error of validate.errors ?? []) {
    console.error(`  ${error.instancePath || "/"} ${error.message}`);
  }
  throw new Error(`artifact ${out} does not match schemas/reply-graph.yaml`);
}
console.log(`\nartifact validates against schemas/reply-graph.yaml`);
