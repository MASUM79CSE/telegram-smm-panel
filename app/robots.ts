import type { MetadataRoute } from "next";

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
 *
 * Deliberately reads `process.env.NEXT_PUBLIC_APP_URL` directly instead of
 * importing the shared `env` object from `lib/env.ts`. That object
 * Zod-validates the ENTIRE environment schema (DATABASE_URL, AUTH_SECRET,
 * etc.) the instant any single property on it is read, and Next.js
 * prerenders this route as static output at build time (no dynamic
 * signal) — so touching `env` here made an unrelated env var elsewhere
 * (or an env var simply not being configured yet on a given deploy
 * target) fail the ENTIRE production build over a static SEO file that
 * has no actual need for a database connection or auth secret. Confirmed
 * this exact failure mode against a real Vercel deploy log. Falls back to
 * the same default `lib/env.ts` uses so behavior is unchanged when the
 * var is genuinely unset.
 */
export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/services", "/login", "/register"],
      disallow: ["/api/", "/dashboard", "/admin"],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
