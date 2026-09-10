/**
 * Background job: computes each Service's median order-creation-to-COMPLETED
 * time from its most recent completed orders, and caches the result on
 * `Service.estimatedDeliveryMinutes` (docs/IMPLEMENTATION_PLAN.md Phase 3.3).
 *
 * Deliberately precomputed and cached rather than calculated live per
 * catalog request — the catalog page/API is read far more often than a
 * service's delivery-time distribution meaningfully changes, so computing
 * it live on every request would add real DB load (an aggregation over
 * potentially many orders) for no accuracy benefit; a periodic refresh
 * (e.g. hourly, via the same "separate scheduled OS process" pattern as
 * `process-orders.ts`/`poll-order-status.ts`) keeps it fresh enough.
 *
 * Median (not mean) is used deliberately: delivery times for this kind of
 * fulfillment are typically right-skewed (most orders finish quickly, a
 * few stragglers take much longer due to transient provider issues) — a
 * mean would be dragged upward by those outliers and mislead customers
 * into expecting a much longer wait than typical.
 *
 * The actual computation logic lives in
 * `lib/services/jobs.ts#runComputeDeliveryEstimatesJob`
 * (docs/PRODUCTION_READINESS.md §14) — extracted so the exact same logic is
 * also reachable via `GET /api/cron/compute-delivery-estimates` for
 * deployments (e.g. Vercel) that can't run this script as a long-lived
 * process at all. This file is now just the CLI wrapper: same usage, same
 * output, same behavior as before this extraction.
 *
 * Usage: npm run compute-delivery-estimates          (single pass)
 *        npm run compute-delivery-estimates -- --loop (repeats hourly)
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();
import { runComputeDeliveryEstimatesJob } from "../lib/services/jobs";

async function runOnce() {
  const { candidateCount, succeeded } = await runComputeDeliveryEstimatesJob();
  console.log(`[${new Date().toISOString()}] Computing delivery estimates for ${candidateCount} service(s)...`);
  console.log(`[${new Date().toISOString()}] Updated estimates for ${succeeded} service(s).`);
}

async function main() {
  const loop = process.argv.includes("--loop");

  if (!loop) {
    await runOnce();
    process.exit(0);
  }

  console.log("Delivery-estimate computer running in loop mode (hourly). Press Ctrl+C to stop.");
  for (;;) {
    await runOnce().catch((err) => console.error("Estimate computation cycle error:", err));
    await new Promise((r) => setTimeout(r, 60 * 60 * 1000));
  }
}

main().catch((err) => {
  console.error("Delivery-estimate computer failed:", err);
  process.exit(1);
});
