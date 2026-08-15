/**
 * Schema validation at the store boundary.
 *
 * The log is immutable, so a malformed event is permanent. Validation happens on
 * the way in, against the generated JSON Schema — the same artifact the Python
 * side reads — rather than against a hand-written TypeScript guard that could
 * drift from it.
 */
// The schemas declare draft 2020-12, so the draft-07 default export will not do.
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { Event } from "../schema/generated.ts";
import { repoPath } from "../lib/paths.ts";

let cached: ValidateFunction | undefined;

async function validator(): Promise<ValidateFunction> {
  if (cached) return cached;
  const schema = await Bun.file(repoPath("schemas", "generated", "event.json")).json();
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  cached = ajv.compile(schema);
  return cached;
}

export class EventValidationError extends Error {
  constructor(readonly errors: string[]) {
    super(`event failed schema validation:\n  ${errors.join("\n  ")}`);
    this.name = "EventValidationError";
  }
}

export async function assertValidEvent(event: unknown): Promise<Event> {
  const validate = await validator();
  if (!validate(event)) {
    const errors = (validate.errors ?? []).map(
      (e) => `${e.instancePath || "/"} ${e.message ?? "invalid"}`,
    );
    throw new EventValidationError(errors);
  }
  return event as Event;
}
