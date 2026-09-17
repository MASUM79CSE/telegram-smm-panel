/**
 * Background job: physically deletes expired `VerificationToken` rows
 * (docs/DATABASE.md §7).
 *
 * MongoDB's version of this schema had a native TTL index on `expiresAt`
 * that did this automatically, in the background, with no application
 * code involved. Postgres has no equivalent — this script (and the
 * matching `GET /api/cron/cleanup-expired-tokens` route, for deployments
 * like Vercel that can't run a long-lived process) is what replaces it.
 *
 * A short grace period is kept past actual expiry before deletion (see
 * `EXPIRED_TOKEN_RETENTION_DAYS` in `lib/services/jobs.ts`) so a recently
 * expired token can still be inspected if a user reports an issue with
 * it, rather than disappearing the instant it expires.
 *
 * The actual deletion logic lives in
 * `lib/services/jobs.ts#runCleanupExpiredTokensJob` — extracted so the
 * exact same logic is also reachable via the HTTP cron route. This file
 * is just the CLI wrapper, following the same shape as
 * `compute-delivery-estimates.ts` / `process-orders.ts` /
 * `poll-order-status.ts`.
 *
 * Usage: npm run cleanup-expired-tokens          (single pass)
 *        npm run cleanup-expired-tokens -- --loop (repeats daily)
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();
import { runCleanupExpiredTokensJob } from "../lib/services/jobs";

async function runOnce() {
  const { candidateCount } = await runCleanupExpiredTokensJob();
  console.log(`[${new Date().toISOString()}] Deleted ${candidateCount} expired verification token(s).`);
}

async function main() {
  const loop = process.argv.includes("--loop");

  if (!loop) {
    await runOnce();
    process.exit(0);
  }

  console.log("Expired-token cleanup running in loop mode (daily). Press Ctrl+C to stop.");
  for (;;) {
    await runOnce().catch((err) => console.error("Token cleanup cycle error:", err));
    await new Promise((r) => setTimeout(r, 24 * 60 * 60 * 1000));
  }
}

main().catch((err) => {
  console.error("Expired-token cleanup failed:", err);
  process.exit(1);
});
