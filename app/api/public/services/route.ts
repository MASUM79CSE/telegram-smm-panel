import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { getPublicCatalog } from "@/lib/services/catalog";
import { requestLogger } from "@/lib/logger";

/**
 * Public, UNAUTHENTICATED service catalog — no `auth()` call at all, by
 * design (see docs/IMPLEMENTATION_PLAN.md Phase 1.2). This is the first
 * genuinely public, unauthenticated data-serving route in this project;
 * the field projection is delegated entirely to
 * `lib/services/catalog.ts#getPublicCatalog()` so the customer-safe
 * exclusion list (no provider fields) only needs to be maintained in one
 * place, shared with the authenticated `/api/services` route.
 *
 * Not subject to `lib/security/origin.ts`'s cross-origin check by choice —
 * it stays same-origin-only for now (the default posture for every other
 * `/api/**` route) rather than being made cross-origin-callable, since
 * there is no current use case (e.g. an embeddable widget) that needs it.
 * Revisit this decision explicitly if such a use case appears — don't
 * silently add it to the origin-check exemption list without a reason.
 *
 * Cache-Control: short-lived public caching (60s fresh, 5min
 * stale-while-revalidate) rather than `no-store` — chosen deliberately
 * over the reference site's own `no-store` choice (see
 * docs/COMPETITIVE_ANALYSIS_AND_ROADMAP.md §2.2) because this project has
 * no CDN/edge cache layer in front of it yet; a short server-side-friendly
 * cache window reduces DB load from repeated public catalog views without
 * meaningfully staling prices. Revisit if/when a CDN is introduced.
 */
export async function GET(request: Request) {
  const log = requestLogger(request);
  try {
    await connectDB();
    const catalog = await getPublicCatalog();

    return NextResponse.json(catalog, {
      headers: {
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      },
    });
  } catch (error) {
    log.error({ err: error }, "Public services fetch error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
