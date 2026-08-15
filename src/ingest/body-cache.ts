/**
 * Local cache of message bodies, keyed by body digest.
 *
 * Phase 3 classifies message text with a local model. It must be able to do that
 * without re-crawling shared IETF infrastructure, and the event log must not
 * carry the text: the corpus is already published by the IETF, and re-publishing
 * it here would be both redundant and — the log being immutable — permanent.
 *
 * `.cache/` is gitignored. Keying on the digest recorded in the event means a
 * cached body can always be checked against the observation that references it.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { CACHE_DIR } from "../lib/paths.ts";

export class BodyCache {
  #root: string;

  constructor(root: string = join(CACHE_DIR, "bodies")) {
    this.#root = root;
  }

  async put(bodySha256: string, text: string): Promise<void> {
    const { dir, path } = this.#locate(bodySha256);
    await mkdir(dir, { recursive: true });
    await Bun.write(path, text);
  }

  async get(bodySha256: string): Promise<string | null> {
    const { path } = this.#locate(bodySha256);
    const file = Bun.file(path);
    return (await file.exists()) ? file.text() : null;
  }

  /** Two-level fan-out so a single directory never holds the whole corpus. */
  #locate(bodySha256: string): { dir: string; path: string } {
    const hex = bodySha256.replace(/^sha256:/, "");
    const dir = join(this.#root, hex.slice(0, 2));
    return { dir, path: join(dir, `${hex}.txt`) };
  }
}
