/**
 * Local embeddings for message bodies.
 *
 * These feed two things: **novelty** — how much a reply adds over what the
 * thread already said — and **topic clustering**. Both replace guesswork with a
 * measured quantity, and neither asks or answers anything about who wrote a
 * message or how.
 *
 * Embeddings are cached on disk keyed by (model, body digest) rather than
 * written to the event log. They are deterministic given the model and the
 * text, so they are regenerable rather than observed, and 768 floats per message
 * would bloat an append-only log for no audit value. The model tag is part of
 * the key, so changing models invalidates rather than silently mixes.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { CACHE_DIR } from "../lib/paths.ts";
import { OllamaClient } from "./ollama.ts";

export const EMBED_MODEL = "nomic-embed-text";
/** Cache namespace. Bumped when the preprocessing changes, so a stale vector
 *  computed over different text can never be reused. */
export const EMBED_VARIANT = "sentence-v1";

/**
 * Split authored text into sentence-like units for embedding.
 *
 * Novelty is scored per sentence and reported as a *fraction*, which is what
 * makes it length-invariant. Scoring a whole message against the thread does not
 * work: measured over full bodies, novelty tracked how much a reply quoted
 * (rho -0.32); measured over whole authored bodies it tracked how short the
 * reply was (rho -0.58), because a short text embeds far from everything. A
 * fraction of new sentences has neither bias by construction.
 */
export function sentences(text: string, minChars = 24): string[] {
  return text
    .split(/(?<=[.!?;:])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= minChars && /[a-zA-Z]/.test(s));
}
/** Characters of a body sent to the embedder. nomic-embed-text has an 8k
 *  context; the median body here is ~5k characters, so this truncates rarely. */
export const MAX_EMBED_CHARS = 20000;

export class EmbeddingCache {
  #root: string;

  constructor(model: string = EMBED_MODEL, root: string = join(CACHE_DIR, "embeddings")) {
    this.#root = join(root, `${model.replace(/[^a-z0-9._-]/gi, "_")}__${EMBED_VARIANT}`);
  }

  #path(digest: string): { dir: string; file: string } {
    const hex = digest.replace(/^sha256:/, "");
    const dir = join(this.#root, hex.slice(0, 2));
    return { dir, file: join(dir, `${hex}.json`) };
  }

  async get(digest: string): Promise<number[] | null> {
    const { file } = this.#path(digest);
    const handle = Bun.file(file);
    return (await handle.exists()) ? ((await handle.json()) as number[]) : null;
  }

  async put(digest: string, vector: number[]): Promise<void> {
    const { dir, file } = this.#path(digest);
    await mkdir(dir, { recursive: true });
    await Bun.write(file, JSON.stringify(vector));
  }

  /** Per-sentence vectors for one message, with the sentences alongside so a
   *  cached entry can be checked against the text that produced it. */
  async putSentences(digest: string, units: string[], vectors: number[][]): Promise<void> {
    const { dir, file } = this.#path(digest);
    await mkdir(dir, { recursive: true });
    await Bun.write(file, JSON.stringify({ sentences: units, vectors }));
  }

  async getSentences(
    digest: string,
  ): Promise<{ sentences: string[]; vectors: number[][] } | null> {
    const { file } = this.#path(digest);
    const handle = Bun.file(file);
    if (!(await handle.exists())) return null;
    return (await handle.json()) as { sentences: string[]; vectors: number[][] };
  }
}

/** Ollama's embedding endpoint. Localhost only, same as the classifier. */
export async function embed(
  ollama: OllamaClient,
  model: string,
  input: string,
): Promise<number[]> {
  const response = await fetch("http://localhost:11434/api/embed", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, input: input.slice(0, MAX_EMBED_CHARS) }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`embed: HTTP ${response.status}`);
  const body = (await response.json()) as { embeddings?: number[][]; error?: string };
  if (body.error) throw new Error(`embed: ${body.error}`);
  const vector = body.embeddings?.[0];
  if (!vector || vector.length === 0) throw new Error("embed: empty vector");
  return vector;
}
