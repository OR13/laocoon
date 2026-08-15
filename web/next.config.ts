import type { NextConfig } from "next";

/**
 * Static export. Two builds come out of this app:
 *
 *   LAOCOON_PRIVATE unset -> the public site, exported to ../site
 *   LAOCOON_PRIVATE=1     -> the operator's private view, exported to ../private/views
 *
 * The private page's file is `page.private.tsx`, and `private.tsx` is only in
 * `pageExtensions` for the private build. In a public build that file is not a
 * page at all, so the route does not exist rather than existing and being empty
 * — there is nothing to accidentally populate. A byte-level scan for sender
 * hashes over the exported files backs that up, because a published file cannot
 * be unpublished.
 */
const isPrivate = process.env.LAOCOON_PRIVATE === "1";

const nextConfig: NextConfig = {
  output: "export",
  pageExtensions: isPrivate ? ["private.tsx", "tsx", "ts"] : ["tsx", "ts"],
  distDir: isPrivate ? ".next-private" : ".next-public",
  images: { unoptimized: true },
  trailingSlash: true,
  typedRoutes: false,
};

export default nextConfig;
