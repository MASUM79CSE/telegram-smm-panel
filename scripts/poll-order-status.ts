/**
 * Background worker: polls upstream API providers for the current delivery
 * status of already-`IN_PROGRESS` orders (docs/IMPLEMENTATION_PLAN.md Phase
 * 3.2) — the prerequisite that `lib/fulfillment.ts`'s original dispatch-only
 * design was missing (see that phase's plan entry: `scripts/process-orders.ts`
 * only ever dispatched new PENDING/PROCESSING orders, it never checked back
 * in on an order already handed off to a provider). Without this script,
 * orders can sit `IN_PROGRESS` forever even after the provider has actually
 * completed or partially failed them.
 *
 * Deliberately a SEPARATE script from `process-orders.ts` rather than
 * folded into it, even though both are "background worker on a schedule"
 * — dispatch and status-polling have different natural cadences (a new
 * order should dispatch within seconds; polling an in-progress order's
 * status is useful much less frequently, e.g. every few minutes) and
 * different failure blast radii (a bug in one should not be able to stall
 * the other). Same "separate OS process, run continuously or via
 * cron/scheduler" deployment pattern as `process-orders.ts` — see that
 * script's own doc comment / docs/ARCHITECTURE.md §6 for the general
 * background-processing design.
 *
 * The actual polling logic lives in
 * `lib/services/jobs.ts#runPollOrderStatusJob` (docs/PRODUCTION_READINESS.md
 * §14) — extracted so the exact same logic is also reachable via
 * `GET /api/cron/poll-order-status` for deployments (e.g. Vercel) that
 * can't run this script as a long-lived process at all. This file is now
 * just the CLI wrapper: same usage, same output, same behavior as before
 * this extraction.
 *
 * Usage: npm run poll-order-status          (single pass)
 *        npm run poll-order-status -- --loop (repeats every 120s)
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();
import { runPollOrderStatusJob } from "../lib/services/jobs";

async function runOnce() {
  const { candidateCount } = await runPollOrderStatusJob();

  if (candidateCount === 0) {
    console.log(`[${new Date().toISOString()}] No orders due for a status check.`);
    return;
  }

  console.log(`[${new Date().toISOString()}] Checking status for ${candidateCount} order(s)...`);
}

async function main() {
  const loop = process.argv.includes("--loop");

  if (!loop) {
    await runOnce();
    process.exit(0);
  }

  console.log("Order status poller running in loop mode (every 120s). Press Ctrl+C to stop.");
  for (;;) {
    await runOnce().catch((err) => console.error("Poller cycle error:", err));
    await new Promise((r) => setTimeout(r, 120_000));
  }
}

main().catch((err) => {
  console.error("Poller failed:", err);
  process.exit(1);
});
