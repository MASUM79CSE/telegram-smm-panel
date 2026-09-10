import { NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/security/cron-auth";
import { runPollOrderStatusJob } from "@/lib/services/jobs";
import { requestLogger } from "@/lib/logger";

/**
 * `GET /api/cron/poll-order-status` — serverless entry point for the same
 * logic as `npm run poll-order-status` (docs/PRODUCTION_READINESS.md §14).
 * See `app/api/cron/process-orders/route.ts`'s doc comment for the full
 * rationale (Vercel has no long-lived worker process; auth via
 * `verifyCronSecret`; scheduled externally per `.github/workflows/cron.yml`).
 *
 * Different natural cadence than `process-orders` (every few minutes is
 * plenty — see `POLL_STATUS_MIN_RECHECK_INTERVAL_MS` in
 * `lib/services/jobs.ts`, which already prevents re-checking the same
 * order more often than every 2 minutes regardless of how often this
 * route itself is invoked), configured as a separate, less-frequent
 * schedule entry in the cron workflow.
 */
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 60;

export async function GET(request: Request) {
  const unauthorized = verifyCronSecret(request);
  if (unauthorized) return unauthorized;

  const log = requestLogger(request);

  try {
    const result = await runPollOrderStatusJob();
    log.info({ ...result }, "[cron/poll-order-status] Run complete");
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    log.error({ err }, "[cron/poll-order-status] Job run failed");
    return NextResponse.json({ ok: false, error: "Job run failed." }, { status: 500 });
  }
}
