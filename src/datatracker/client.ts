/**
 * Keyless client for the IETF Datatracker REST API.
 *
 * Rate limited and retrying, because this is shared infrastructure the project
 * does not own and a resolution pass makes a few hundred requests. No API key
 * exists for this API and none is needed; nothing here authenticates, and
 * nothing here writes.
 *
 * This is not a hosted model and costs nothing per call. PROBLEM.md section 9's
 * "100% local" rules out remote *inference*, and section 5 puts datatracker role
 * records explicitly in scope.
 */
import { RateLimiter } from "../crawl/rate-limiter.ts";

export const DATATRACKER_HOST = "datatracker.ietf.org";

export interface DatatrackerPage<T> {
  meta: { total_count: number; next: string | null };
  objects: T[];
}

export interface DatatrackerClientOptions {
  baseUrl?: string;
  minIntervalMs?: number;
  maxRetries?: number;
  timeoutMs?: number;
  userAgent?: string;
}

export class DatatrackerError extends Error {
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(message);
    this.name = "DatatrackerError";
  }
}

export class DatatrackerClient {
  #base: string;
  #limiter: RateLimiter;
  #maxRetries: number;
  #timeoutMs: number;
  #userAgent: string;
  /** Endpoint paths visited, recorded onto the events for audit. */
  readonly visited: string[] = [];

  constructor(options: DatatrackerClientOptions = {}) {
    this.#base = options.baseUrl ?? `https://${DATATRACKER_HOST}/api/v1`;
    this.#limiter = new RateLimiter(options.minIntervalMs ?? 400);
    this.#maxRetries = options.maxRetries ?? 3;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    this.#userAgent =
      options.userAgent ??
      "laocoon/0.1 (research; https://github.com/OR13/laocoon)";
  }

  /**
   * One page of a list endpoint. `path` is relative to /api/v1, e.g.
   * "group/role/". Query values are encoded; `format=json` is always added.
   */
  async page<T>(path: string, query: Record<string, string | number>): Promise<DatatrackerPage<T>> {
    const params = new URLSearchParams({ format: "json" });
    for (const [key, value] of Object.entries(query)) params.set(key, String(value));
    const url = `${this.#base}/${path}?${params.toString()}`;
    const relative = `${path}?${params.toString()}`;
    this.visited.push(relative);

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.#maxRetries; attempt += 1) {
      await this.#limiter.wait();
      try {
        const response = await fetch(url, {
          headers: { accept: "application/json", "user-agent": this.#userAgent },
          signal: AbortSignal.timeout(this.#timeoutMs),
        });
        if (response.status === 429 || response.status >= 500) {
          lastError = new DatatrackerError(`HTTP ${response.status}`, relative);
          await Bun.sleep(backoffMs(attempt));
          continue;
        }
        if (!response.ok) throw new DatatrackerError(`HTTP ${response.status}`, relative);
        const body = (await response.json()) as DatatrackerPage<T> | Record<string, unknown>;
        if (!("meta" in body)) {
          // An unsupported filter comes back as an error object, not a page.
          // Failing loudly here stops a silently-empty result from being read
          // as "this person has no roles".
          throw new DatatrackerError(
            `unexpected response shape (unsupported filter?): ${JSON.stringify(body).slice(0, 200)}`,
            relative,
          );
        }
        return body as DatatrackerPage<T>;
      } catch (error) {
        if (error instanceof DatatrackerError && !/HTTP (429|5\d\d)/.test(error.message)) throw error;
        lastError = error;
        await Bun.sleep(backoffMs(attempt));
      }
    }
    throw new DatatrackerError(
      `giving up after ${this.#maxRetries + 1} attempts: ${describe(lastError)}`,
      relative,
    );
  }

  /** A single detail endpoint, e.g. "group/group/1748/". */
  async detail<T>(path: string): Promise<T> {
    const url = `${this.#base}/${path}?format=json`;
    this.visited.push(`${path}?format=json`);
    await this.#limiter.wait();
    const response = await fetch(url, {
      headers: { accept: "application/json", "user-agent": this.#userAgent },
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    if (!response.ok) throw new DatatrackerError(`HTTP ${response.status}`, path);
    return (await response.json()) as T;
  }

  /** Every page of a list endpoint, up to `maxPages`. */
  async *all<T>(
    path: string,
    query: Record<string, string | number>,
    maxPages = 20,
  ): AsyncIterable<T> {
    let offset = 0;
    for (let pageNo = 0; pageNo < maxPages; pageNo += 1) {
      const page = await this.page<T>(path, { ...query, offset });
      for (const object of page.objects) yield object;
      if (!page.meta.next || page.objects.length === 0) return;
      offset += page.objects.length;
    }
  }
}

function backoffMs(attempt: number): number {
  return Math.min(8000, 500 * 2 ** attempt);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Trailing id from a resource URI, e.g. "/api/v1/person/person/105857/" -> 105857. */
export function idFromUri(uri: string | null | undefined): number | null {
  if (!uri) return null;
  const match = uri.match(/\/(\d+)\/?$/);
  return match ? Number(match[1]) : null;
}

/** Trailing slug from a name URI, e.g. "/api/v1/name/rolename/chair/" -> "chair". */
export function slugFromUri(uri: string | null | undefined): string {
  if (!uri) return "";
  const parts = uri.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] ?? "";
}
