import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical.ts";

/** `sha256:<64 hex>` over a UTF-8 string. */
export function sha256(input: string): string {
  return "sha256:" + createHash("sha256").update(input, "utf8").digest("hex");
}

/** `sha256:<64 hex>` over the canonical JSON of a value. */
export function sha256Json(value: unknown): string {
  return sha256(canonicalJson(value));
}

/**
 * Stable pseudonym for an email address.
 *
 * Unsalted on purpose. A participant can hash their own address and identify
 * exactly which rows are theirs, which the contestability commitment in
 * PROBLEM.md section 8 requires. A salt would break that; a plaintext column
 * would turn a public repository into a harvestable address list.
 */
export function senderId(address: string): string {
  return sha256(address.trim().toLowerCase());
}
