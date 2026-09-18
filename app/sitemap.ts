import type { MetadataRoute } from "next";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * Native Next.js App Router sitemap generation
 * (https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap).
 *
 * Lists only genuinely public, unauthenticated pages — `/dashboard`,
 * `/admin`, and API routes are intentionally excluded (see app/robots.ts).
 *
 * Now async (per the note this function carried in Phase 1.1): the public
 * `/services` catalog page shipped in Phase 1.2
 * (docs/IMPLEMENTATION_PLAN.md), so this now lists `/services` plus one
 * entry per active `Category` slug, generated from the database rather
 * than hardcoded, since the catalog changes far more often than a static
 * list could stay accurate. `ServiceGroup`s don't get their own sitemap
 * entries (yet) since Phase 1.2's `/services` page doesn't expose
 * per-group deep links — only per-category ones (`#category-<slug>`
 * anchors are same-page, not separate URLs worth listing).
 *
 * If the DB is unreachable at build/request time, fail soft to the static
 * pages only rather than breaking the whole sitemap (and therefore SEO
 * crawling of the rest of the site) over a transient DB blip.
 */
// Without this, Next.js pre-renders this route as static output at BUILD
// time (it has no obvious signal to treat it as dynamic, since it doesn't
// call headers()/cookies()/searchParams) — which would silently bake in
// whatever categories existed in the DB at build time and never update
// again until the next deploy, defeating the entire point of making this
// DB-backed instead of hardcoded. Confirmed this was happening live: a
// `next build` run before seeding extra demo categories produced a
// sitemap.xml that still only listed the pre-seed category after the new
// ones were added to the DB, until this was added.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Reads process.env directly rather than the shared `env` object from
  // lib/env.ts for the same reason as app/robots.ts: that object validates
  // the FULL env schema (DATABASE_URL, AUTH_SECRET, etc.) on first property
  // access, and this route has no legitimate need for any of those to
  // render its own base URL. `dynamic = "force-dynamic"` above currently
  // keeps this route from being prerendered at build time (so it wasn't
  // actually hit by the same build-time failure app/robots.ts was), but
  // that's a fragile single point of protection against a config change
  // silently reintroducing the same class of bug — reading the var
  // directly removes the sharp edge entirely regardless.
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const now = new Date();

  const staticEntries: MetadataRoute.Sitemap = [
    { url: baseUrl, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${baseUrl}/services`, lastModified: now, changeFrequency: "hourly", priority: 0.9 },
    { url: `${baseUrl}/login`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${baseUrl}/register`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
  ];

  try {
    const categories = await prisma.category.findMany({
      where: { active: true },
      select: { slug: true, updatedAt: true },
    });

    const categoryEntries: MetadataRoute.Sitemap = categories.map((c) => ({
      url: `${baseUrl}/services#${c.slug}`,
      lastModified: c.updatedAt ?? now,
      changeFrequency: "daily",
      priority: 0.6,
    }));

    return [...staticEntries, ...categoryEntries];
  } catch (error) {
    logger.error({ err: error }, "Sitemap category fetch failed, returning static entries only");
    return staticEntries;
  }
}
