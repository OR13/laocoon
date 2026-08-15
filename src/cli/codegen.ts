#!/usr/bin/env bun
/**
 * Type codegen. The YAML files in `schemas/` are the single source of truth;
 * everything this script writes is generated and must not be hand-edited.
 *
 *   schemas/*.yaml
 *     -> schemas/generated/*.json   (JSON Schema, used at runtime by ajv)
 *     -> src/schema/generated.ts    (TypeScript types)
 *     -> python/laocoon/schema/*.py  (Python dataclasses)
 *
 * The Python half shells out to `uv run --with datamodel-code-generator`, which
 * is the only reason this needs a network on first run. It is a build step, not
 * part of the daily pipeline.
 */
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { parse as parseYaml } from "yaml";
import { compile } from "json-schema-to-typescript";
import { repoPath } from "../lib/paths.ts";

const BANNER = [
  "GENERATED FILE - DO NOT EDIT.",
  "Source of truth: schemas/*.yaml. Regenerate with `bun run codegen`.",
];

async function main(): Promise<void> {
  const srcDir = repoPath("schemas");
  const jsonDir = repoPath("schemas", "generated");
  await mkdir(jsonDir, { recursive: true });

  const yamlFiles = (await readdir(srcDir))
    .filter((f) => f.endsWith(".yaml"))
    .sort();

  if (yamlFiles.length === 0) throw new Error(`no .yaml schemas in ${srcDir}`);

  const tsChunks: string[] = [
    BANNER.map((l) => `// ${l}`).join("\n"),
    "",
  ];

  for (const file of yamlFiles) {
    const stem = basename(file, ".yaml");
    const schema = parseYaml(await Bun.file(join(srcDir, file)).text());

    // Deterministic JSON so a no-op regeneration produces no diff.
    const jsonPath = join(jsonDir, `${stem}.json`);
    await writeFile(jsonPath, JSON.stringify(schema, null, 2) + "\n");

    const ts = await compile(schema, schema.title ?? stem, {
      bannerComment: "",
      additionalProperties: false,
      declareExternallyReferenced: true,
      style: { singleQuote: false },
    });
    tsChunks.push(`// --- ${file} ---`, ts.trim(), "");
    console.log(`schema ${file} -> ${basename(jsonPath)}`);
  }

  const tsPath = repoPath("src", "schema", "generated.ts");
  await mkdir(repoPath("src", "schema"), { recursive: true });
  await writeFile(tsPath, tsChunks.join("\n") + "\n");
  console.log(`types  -> src/schema/generated.ts`);

  await generatePython(jsonDir);
}

async function generatePython(jsonDir: string): Promise<void> {
  const out = repoPath("python", "laocoon", "schema");
  await mkdir(out, { recursive: true });

  const proc = Bun.spawn(
    [
      "uv",
      "run",
      "--quiet",
      "--with",
      "datamodel-code-generator",
      "datamodel-codegen",
      "--input",
      jsonDir,
      "--input-file-type",
      "jsonschema",
      "--output",
      out,
      "--output-model-type",
      "dataclasses.dataclass",
      "--target-python-version",
      "3.11",
      "--use-schema-description",
      "--disable-timestamp",
      "--formatters",
      "builtin",
      "--custom-file-header",
      BANNER.map((l) => `# ${l}`).join("\n"),
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const code = await proc.exited;
  if (code !== 0) {
    const err = await new Response(proc.stderr).text();
    console.error(err);
    throw new Error(`datamodel-codegen exited ${code}`);
  }
  console.log(`types  -> python/laocoon/schema/`);
}

await main();
