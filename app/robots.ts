import type { MetadataRoute } from "next";
import { env } from "@/lib/env";

/**
 * Native Next.js App Router robots.txt generation
 * (https://nextjs.org/docs/app/api-reference/file-conventions/metadata/robots).
 *
 * Policy: allow indexing of the public marketing/catalog surface, disallow
 * everything that requires a session (dashboard/admin) and the API surface
 * (no reason for a crawler to hit JSON endpoints). This mirrors the
 * disallow list observed on the reference site analyzed in
 * `docs/COMPETITIVE_ANALYSIS_AND_ROADMAP.md` §2.1 for the same
 * private-route-exclusion reasons — keep private surfaces out of search
 * results without hiding the public catalog that's meant to be found.
 *
 * `/services` (the public, unauthenticated service catalog, shipped in
 * Phase 1.2 of docs/IMPLEMENTATION_PLAN.md) is explicitly allowed here.
 */
export default function robots(): MetadataRoute.Robots {
  const baseUrl = env.NEXT_PUBLIC_APP_URL;

  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/services", "/login", "/register"],
      disallow: ["/api/", "/dashboard", "/admin"],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
