import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { connectDB } from "@/lib/db";
import { getPublicCatalog } from "@/lib/services/catalog";
import { requestLogger } from "@/lib/logger";

/**
 * Authenticated service catalog endpoint. Shares its field projection and
 * grouping logic with the public `/api/public/services` route via
 * `lib/services/catalog.ts#getPublicCatalog()` (see
 * docs/IMPLEMENTATION_PLAN.md Phase 1.2) — kept as a single source of truth
 * for the customer-safe field exclusion list rather than two independently
 * maintained queries.
 *
 * The only difference from the public route: this one still requires a
 * session, and is not cached (session-authenticated responses shouldn't be
 * cached by shared/proxy caches). If you don't need session-gating for
 * this data, prefer the public route directly.
 */
export async function GET(request: Request) {
  const log = requestLogger(request);
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectDB();
    const catalog = await getPublicCatalog();

    return NextResponse.json(catalog);
  } catch (error) {
    log.error({ err: error }, "Services fetch error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
