import { NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/security/cron-auth";
import { runCleanupExpiredTokensJob } from "@/lib/services/jobs";
import { requestLogger } from "@/lib/logger";

/**
 * `GET /api/cron/cleanup-expired-tokens` — serverless entry point for the
 * same logic as `npm run cleanup-expired-tokens`.
 *
 * MongoDB's version of the `VerificationToken` collection had a native TTL
 * index (`expireAfterSeconds: 0` on `expiresAt`) that deleted expired
 * documents automatically in the background — no application code
 * involved. Postgres has no equivalent, so this route (plus the identical
 * CLI script, for any deployment that runs a long-lived process instead)
 * is what replaces it: an external scheduler invokes this on a schedule
 * (see `.github/workflows/cron.yml`) to physically delete rows past their
 * retention window (`EXPIRED_TOKEN_RETENTION_DAYS` in
 * `lib/services/jobs.ts`).
 *
 * See `app/api/cron/process-orders/route.ts`'s doc comment for the full
 * rationale shared by every route in this directory (why Vercel needs an
 * external scheduler at all, and why auth is a shared-secret bearer token
 * rather than a session cookie).
 *
 * Cheapest of the four cron jobs by a wide margin (a single `deleteMany`
 * with an indexed `expiresAt` filter, no external network calls) —
 * scheduled once daily in the cron workflow, since token expiry cleanup
 * has no meaningful urgency.
 */
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 60;

export async function GET(request: Request) {
  const unauthorized = verifyCronSecret(request);
  if (unauthorized) return unauthorized;

  const log = requestLogger(request);

  try {
    const result = await runCleanupExpiredTokensJob();
    log.info({ ...result }, "[cron/cleanup-expired-tokens] Run complete");
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    log.error({ err }, "[cron/cleanup-expired-tokens] Job run failed");
    return NextResponse.json({ ok: false, error: "Job run failed." }, { status: 500 });
  }
}
