/**
 * Schema validation at the store boundary.
 *
 * The log is immutable, so a malformed event is permanent. Validation happens on
 * the way in, against the generated JSON Schema — the same artifact the Python
 * side reads — rather than against a hand-written TypeScript guard that could
 * drift from it.
 *
 * Which schema is a parameter, because there are two logs. The public log at
 * `events/` accepts observations of the mailing list; the private log at
 * `private/events/` accepts identity resolution, which PROBLEM.md section 7
 * keeps out of anything published. Giving each store its own schema means the
 * separation is enforced by validation rather than by remembering.
 */
// The schemas declare draft 2020-12, so the draft-07 default export will not do.
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { repoPath } from "../lib/paths.ts";

const cache = new Map<string, ValidateFunction>();

/** Compile (once) the generated schema of the given name, e.g. "event". */
export async function schemaValidator(name: string): Promise<ValidateFunction> {
  const existing = cache.get(name);
  if (existing) return existing;
  const schema = await Bun.file(repoPath("schemas", "generated", `${name}.json`)).json();
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  cache.set(name, validate);
  return validate;
}

export class EventValidationError extends Error {
  constructor(readonly errors: string[]) {
    super(`event failed schema validation:\n  ${errors.join("\n  ")}`);
    this.name = "EventValidationError";
  }
}

/** Throw unless `value` matches the named generated schema. */
export async function assertValid<T>(schemaName: string, value: unknown): Promise<T> {
  const validate = await schemaValidator(schemaName);
  if (!validate(value)) {
    const errors = (validate.errors ?? []).map(
      (e) => `${e.instancePath || "/"} ${e.message ?? "invalid"}`,
    );
    throw new EventValidationError(errors);
  }
  return value as T;
}
