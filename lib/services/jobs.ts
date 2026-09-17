import { connectDB, prisma } from "@/lib/db";
import { dispatchOrderToProvider, pollOrderStatus } from "@/lib/fulfillment";
import { logger } from "@/lib/logger";

/**
 * Shared background-job logic (docs/PRODUCTION_READINESS.md §14).
 *
 * Extracted out of `scripts/process-orders.ts` / `scripts/poll-order-
 * status.ts` / `scripts/compute-delivery-estimates.ts` so the EXACT SAME
 * logic can be invoked two ways, unchanged:
 *
 *   1. The original CLI scripts (`npm run process-orders`, etc.) — for any
 *      deployment that runs a real long-lived process (systemd/pm2/Docker),
 *      per `docs/ARCHITECTURE.md` §6's documented deployment shape. These
 *      keep working exactly as before; this refactor changes nothing about
 *      their behavior, only where the loop body's code lives.
 *   2. New authenticated `GET /api/cron/*` routes (`app/api/cron/**`) — for
 *      a Vercel deployment, which cannot run a long-lived background
 *      process at all (serverless-only). An external scheduler (see
 *      `.github/workflows/cron.yml`) invokes these on a schedule instead.
 *
 * Every function here is safe to call concurrently/overlapping with itself
 * (e.g. if a scheduler's previous invocation is still finishing when the
 * next one starts) — each just re-queries "what's currently eligible right
 * now" from the DB rather than holding any in-process state between calls,
 * the same property the original scripts' `--loop` mode already relied on
 * (a slow cycle could already overlap the next 30s/120s timer tick there).
 * `dispatchOrderToProvider`/`pollOrderStatus` are themselves per-order
 * operations already guarded by the order's own state checks, so two
 * concurrent workers racing on the exact same order id degrade to a no-op
 * for the loser, not a double-dispatch — see `lib/fulfillment.ts`.
 */

const PROCESS_ORDERS_MAX_ATTEMPTS = 5;
const PROCESS_ORDERS_BATCH_SIZE = 25;

const POLL_STATUS_BATCH_SIZE = 25;
const POLL_STATUS_MIN_RECHECK_INTERVAL_MS = 2 * 60 * 1000;

const DELIVERY_ESTIMATE_SAMPLE_SIZE = 50;

// A PROCESSING order that hasn't moved to IN_PROGRESS/COMPLETED/FAILED
// within this window is either stuck on a provider-side issue or on a bug
// in dispatchOrderToProvider — either way, worth a human looking at it.
// See docs/PRODUCTION_READINESS.md §6's "Order-processing throughput/queue
// depth" alert item.
export const STALE_PROCESSING_MINUTES = 15;

// A PENDING backlog above this size (orders that exist but haven't even
// been picked up by a process-orders run yet) most likely means
// process-orders itself has stopped running (scheduler down, CRON_SECRET
// drift, etc.) rather than a per-order problem — same signal, different
// cause, so it's checked and reported alongside the stale-PROCESSING count
// rather than as a wholly separate alert.
export const PENDING_BACKLOG_ALERT_THRESHOLD = 20;

export interface JobRunResult {
  candidateCount: number;
  succeeded: number;
  failed: number;
}

export interface QueueDepthCheckResult {
  staleProcessingCount: number;
  pendingBacklogCount: number;
  staleProcessingThresholdMinutes: number;
  pendingBacklogThreshold: number;
  /** true if either count breaches its threshold — callers (the cron route) use this to decide the HTTP status, so a breach shows up as a failed scheduled-workflow run (see .github/workflows/cron.yml), the same zero-additional-infra alert path already used elsewhere in this project. */
  alert: boolean;
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Dispatches PENDING orders to their provider and retries PROCESSING
 * orders stuck there due to a transient dispatch failure. See
 * `scripts/process-orders.ts`'s original doc comment for the full
 * rationale (in particular: deliberately does NOT filter on
 * `providerId: { not: null }` — see that file for why).
 */
export async function runProcessOrdersJob(): Promise<JobRunResult> {
  await connectDB();

  const candidates = await prisma.order.findMany({
    where: {
      status: { in: ["PENDING", "PROCESSING"] },
      attempts: { lt: PROCESS_ORDERS_MAX_ATTEMPTS },
    },
    orderBy: { createdAt: "asc" },
    take: PROCESS_ORDERS_BATCH_SIZE,
    select: { id: true },
  });

  let succeeded = 0;
  let failed = 0;

  for (const c of candidates) {
    try {
      await dispatchOrderToProvider(c.id);
      succeeded += 1;
    } catch (err) {
      failed += 1;
      logger.error({ err, orderId: c.id }, "[jobs/process-orders] Failed to dispatch order");
    }
  }

  return { candidateCount: candidates.length, succeeded, failed };
}

/**
 * Polls upstream providers for the current delivery status of already-
 * `IN_PROGRESS` orders. See `scripts/poll-order-status.ts`'s original doc
 * comment for why this is a separate job from `runProcessOrdersJob`
 * (different natural cadence, different failure blast radius).
 */
export async function runPollOrderStatusJob(): Promise<JobRunResult> {
  await connectDB();

  const cutoff = new Date(Date.now() - POLL_STATUS_MIN_RECHECK_INTERVAL_MS);

  const candidates = await prisma.order.findMany({
    where: {
      status: "IN_PROGRESS",
      providerId: { not: null },
      providerOrderId: { not: null },
      OR: [{ lastStatusCheckAt: null }, { lastStatusCheckAt: { lt: cutoff } }],
    },
    // Postgres sorts NULLs last by default in ascending order, unlike
    // MongoDB (which sorts them first) — `nulls: "first"` restores the
    // original "never-checked orders first, then longest-stale" ordering.
    orderBy: { lastStatusCheckAt: { sort: "asc", nulls: "first" } },
    take: POLL_STATUS_BATCH_SIZE,
    select: { id: true },
  });

  let succeeded = 0;
  let failed = 0;

  for (const c of candidates) {
    try {
      await pollOrderStatus(c.id);
      succeeded += 1;
    } catch (err) {
      failed += 1;
      logger.error({ err, orderId: c.id }, "[jobs/poll-order-status] Failed to poll order status");
    }
  }

  return { candidateCount: candidates.length, succeeded, failed };
}

/**
 * Computes each Service's median order-creation-to-COMPLETED time from its
 * most recent completed orders, and caches the result on
 * `Service.estimatedDeliveryMinutes`. See
 * `scripts/compute-delivery-estimates.ts`'s original doc comment for why
 * median (not mean) is used.
 */
export async function runComputeDeliveryEstimatesJob(): Promise<JobRunResult> {
  await connectDB();

  const services = await prisma.service.findMany({ select: { id: true } });

  let succeeded = 0;
  let failed = 0;

  for (const service of services) {
    try {
      const completedOrders = await prisma.order.findMany({
        where: {
          serviceId: service.id,
          status: "COMPLETED",
          completedAt: { not: null },
        },
        orderBy: { completedAt: "desc" },
        take: DELIVERY_ESTIMATE_SAMPLE_SIZE,
        select: { createdAt: true, completedAt: true },
      });

      if (completedOrders.length === 0) continue;

      const minutesSamples = completedOrders
        .map((o) => (o.completedAt!.getTime() - o.createdAt.getTime()) / 60_000)
        .filter((m) => m >= 0) // defensive: skip any data anomaly rather than let it skew the median
        .sort((a, b) => a - b);

      if (minutesSamples.length === 0) continue;

      const estimate = Math.round(median(minutesSamples));

      await prisma.service.update({ where: { id: service.id }, data: { estimatedDeliveryMinutes: estimate } });
      succeeded += 1;
    } catch (err) {
      failed += 1;
      logger.error(
        { err, serviceId: service.id },
        "[jobs/compute-delivery-estimates] Failed to compute estimate for service"
      );
    }
  }

  return { candidateCount: services.length, succeeded, failed };
}

/**
 * Order-processing queue-depth check (docs/PRODUCTION_READINESS.md §6 —
 * closes the "order-processing queue depth" alerting item that was
 * previously an honest open gap: no custom metrics/APM pipeline exists in
 * this project to host a real gauge, so this deliberately piggybacks on
 * the free alert path already in place for the cron endpoints themselves
 * — a non-2xx response from GET /api/cron/process-orders fails that
 * scheduled GitHub Actions run, which GitHub can notify on (Settings ->
 * Notifications -> failed workflow runs) at zero additional cost/infra.
 *
 * Two independent signals, both indicating the same underlying failure
 * mode from different angles:
 *   1. `staleProcessingCount` — orders stuck in PROCESSING for longer than
 *      `STALE_PROCESSING_MINUTES`. A healthy order moves to IN_PROGRESS
 *      (or FAILED, after PROCESS_ORDERS_MAX_ATTEMPTS) within seconds of
 *      being dispatched — sitting in PROCESSING this long means either a
 *      provider-side issue or a bug in `dispatchOrderToProvider` is
 *      silently swallowing the state transition.
 *   2. `pendingBacklogCount` — PENDING orders that haven't even been
 *      picked up yet. A backlog this large most likely means
 *      `process-orders` itself has stopped running altogether (scheduler
 *      down, `CRON_SECRET` drift between Vercel and the GitHub Actions
 *      repository secret, etc.) rather than a per-order problem.
 *
 * Called from `GET /api/cron/process-orders` (see that route) rather than
 * as its own separate cron job/endpoint — reusing the highest-frequency
 * existing invocation avoids adding a fourth schedule/endpoint/secret for
 * what is fundamentally a health check on the other three jobs' own
 * output, not a new business capability.
 */
export async function checkQueueDepth(): Promise<QueueDepthCheckResult> {
  await connectDB();

  const staleCutoff = new Date(Date.now() - STALE_PROCESSING_MINUTES * 60 * 1000);

  const [staleProcessingCount, pendingBacklogCount] = await Promise.all([
    prisma.order.count({ where: { status: "PROCESSING", updatedAt: { lt: staleCutoff } } }),
    prisma.order.count({ where: { status: "PENDING" } }),
  ]);

  const alert = staleProcessingCount > 0 || pendingBacklogCount > PENDING_BACKLOG_ALERT_THRESHOLD;

  if (alert) {
    logger.error(
      { staleProcessingCount, pendingBacklogCount },
      "[jobs/queue-depth] Order-processing queue depth exceeded a healthy threshold — see docs/INCIDENT_RESPONSE.md §6.2"
    );
  }

  return {
    staleProcessingCount,
    pendingBacklogCount,
    staleProcessingThresholdMinutes: STALE_PROCESSING_MINUTES,
    pendingBacklogThreshold: PENDING_BACKLOG_ALERT_THRESHOLD,
    alert,
  };
}
