/**
 * Background worker: dispatches PENDING orders to their provider and retries
 * orders stuck in PROCESSING due to a transient dispatch failure.
 *
 * This fills the "queue/worker system" gap from the original plan — without
 * this, orders would sit in PENDING forever with no automated processing.
 *
 * Run continuously in production, e.g. via:
 *   - a long-running `node` process managed by systemd/pm2/Docker, or
 *   - a scheduled cron/Cloud Scheduler job hitting a protected endpoint.
 *
 * The actual dispatch logic lives in `lib/services/jobs.ts#runProcessOrdersJob`
 * (docs/PRODUCTION_READINESS.md §14) — extracted so the exact same logic is
 * also reachable via `GET /api/cron/process-orders` for deployments (e.g.
 * Vercel) that can't run this script as a long-lived process at all. This
 * file is now just the CLI wrapper: same usage, same output, same behavior
 * as before this extraction.
 *
 * Usage: npm run process-orders          (single pass)
 *        npm run process-orders -- --loop (repeats every 30s)
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();
import { runProcessOrdersJob } from "../lib/services/jobs";

async function runOnce() {
  const { candidateCount } = await runProcessOrdersJob();

  if (candidateCount === 0) {
    console.log(`[${new Date().toISOString()}] No orders to process.`);
    return;
  }

  console.log(`[${new Date().toISOString()}] Processing ${candidateCount} order(s)...`);
}

async function main() {
  const loop = process.argv.includes("--loop");

  if (!loop) {
    await runOnce();
    process.exit(0);
  }

  console.log("Order processor running in loop mode (every 30s). Press Ctrl+C to stop.");
  for (;;) {
    await runOnce().catch((err) => console.error("Worker cycle error:", err));
    await new Promise((r) => setTimeout(r, 30_000));
  }
}

main().catch((err) => {
  console.error("Worker failed:", err);
  process.exit(1);
});
