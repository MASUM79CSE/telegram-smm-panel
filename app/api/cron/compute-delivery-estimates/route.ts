import { NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/security/cron-auth";
import { runComputeDeliveryEstimatesJob } from "@/lib/services/jobs";
import { requestLogger } from "@/lib/logger";

/**
 * `GET /api/cron/compute-delivery-estimates` — serverless entry point for
 * the same logic as `npm run compute-delivery-estimates`
 * (docs/PRODUCTION_READINESS.md §14). See
 * `app/api/cron/process-orders/route.ts`'s doc comment for the full
 * rationale (Vercel has no long-lived worker process; auth via
 * `verifyCronSecret`; scheduled externally per `.github/workflows/cron.yml`).
 *
 * Cheapest of the three jobs by far (one query per `Service`, no external
 * provider network calls) — scheduled hourly in the cron workflow, same
 * cadence as the original script's `--loop` mode.
 */
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 60;

export async function GET(request: Request) {
  const unauthorized = verifyCronSecret(request);
  if (unauthorized) return unauthorized;

  const log = requestLogger(request);

  try {
    const result = await runComputeDeliveryEstimatesJob();
    log.info({ ...result }, "[cron/compute-delivery-estimates] Run complete");
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    log.error({ err }, "[cron/compute-delivery-estimates] Job run failed");
    return NextResponse.json({ ok: false, error: "Job run failed." }, { status: 500 });
  }
}
