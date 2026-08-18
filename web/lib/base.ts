/**
 * Base-path prefixing for internal links.
 *
 * GitHub Pages serves this repo under `/laocoon`, so an absolute link like
 * `/lists/agentproto/` has to become `/laocoon/lists/agentproto/`. Next's
 * `basePath` already handles `<Link>` and the `_next` assets, but it does not
 * touch plain `<a href>` tags, which is how the rest of the site links. Every
 * such link goes through `withBase` so the prefix lives in exactly one place.
 *
 * The value is read from `NEXT_PUBLIC_BASE_PATH`, the same variable `next.config`
 * uses, and is inlined at build time. It is empty for `bun run dev` and the
 * local preview, so links stay at root there; the deploy sets it to `/laocoon`.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Prefix an absolute internal path with the base path. External URLs and
 *  fragments pass through untouched. */
export function withBase(path: string): string {
  if (!BASE_PATH) return path;
  return path.startsWith("/") ? `${BASE_PATH}${path}` : path;
}
