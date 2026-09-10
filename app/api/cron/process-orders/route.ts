import { NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/security/cron-auth";
import { runProcessOrdersJob, checkQueueDepth } from "@/lib/services/jobs";
import { requestLogger } from "@/lib/logger";

/**
 * `GET /api/cron/process-orders` — serverless entry point for the same
 * logic as `npm run process-orders` (docs/PRODUCTION_READINESS.md §14).
 *
 * Vercel deployments cannot run `scripts/process-orders.ts` as a long-lived
 * process at all (serverless functions don't persist between requests) —
 * this route exists so an EXTERNAL scheduler can invoke the exact same
 * `runProcessOrdersJob()` (`lib/services/jobs.ts`) on a schedule instead.
 * See `.github/workflows/cron.yml` for the actual scheduler used by this
 * project (GitHub Actions `schedule` trigger, since Vercel's own native
 * Cron Jobs require a paid Pro plan for anything more frequent than once a
 * day — see that workflow file's header comment for the full trade-off).
 *
 * Auth: `verifyCronSecret` (shared-secret Bearer token, fails closed if
 * `CRON_SECRET` isn't configured — see that module's doc comment). This is
 * NOT a page/session-cookie-protected route; it's invoked server-to-server
 * by the scheduler, which is why it uses the same shared-secret shape as
 * the Telegram webhook rather than `auth()`.
 *
 * `maxDuration = 60`: Vercel Hobby's function timeout maximum (Pro/
 * Enterprise support longer, but this project targets Hobby per the
 * deployment decision in docs/PRODUCTION_READINESS.md §14). The job
 * processes at most 25 orders per invocation
 * (`PROCESS_ORDERS_BATCH_SIZE` in `lib/services/jobs.ts`) sequentially,
 * each a real network call to a provider — if real-world provider latency
 * ever makes 25 sequential dispatches routinely approach 60s, lower that
 * batch size rather than relying on this timeout as the safety net (a
 * mid-batch timeout still leaves already-dispatched orders correctly
 * updated; it just means fewer than 25 got processed that cycle, no data
 * corruption — the next scheduled run picks up where this one left off).
 *
 * Queue-depth alerting (docs/PRODUCTION_READINESS.md §6): after the job
 * itself runs, `checkQueueDepth()` looks for stale-PROCESSING orders and
 * an oversized PENDING backlog — either one indicates the same underlying
 * failure mode (dispatch stuck or the scheduler itself not actually
 * running) from a different angle. Checked here (the highest-frequency of
 * the three cron routes) rather than as a fourth separate endpoint. If
 * either threshold is breached, this route responds `503` even though the
 * batch itself ran successfully — matching `GET /api/health`'s existing
 * "503 means something needs attention" convention — which fails the
 * scheduled `.github/workflows/cron.yml` run and surfaces as a GitHub
 * Actions failure notification, the zero-additional-infra alert path this
 * project deliberately relies on instead of a dedicated metrics backend.
 */
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 60;

export async function GET(request: Request) {
  const unauthorized = verifyCronSecret(request);
  if (unauthorized) return unauthorized;

  const log = requestLogger(request);

  try {
    const result = await runProcessOrdersJob();
    log.info({ ...result }, "[cron/process-orders] Run complete");

    const queueDepth = await checkQueueDepth();
    if (queueDepth.alert) {
      log.error({ ...queueDepth }, "[cron/process-orders] Queue depth alert threshold breached");
      return NextResponse.json({ ok: true, ...result, queueDepth }, { status: 503 });
    }

    return NextResponse.json({ ok: true, ...result, queueDepth });
  } catch (err) {
    log.error({ err }, "[cron/process-orders] Job run failed");
    return NextResponse.json({ ok: false, error: "Job run failed." }, { status: 500 });
  }
}
