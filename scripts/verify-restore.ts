/**
 * Automated restore-drill verification (docs/PRODUCTION_READINESS.md §13 —
 * Backup & Recovery / Disaster Recovery, docs/INCIDENT_RESPONSE.md §7).
 *
 * WHAT THIS DOES NOT DO: it does not create, trigger, or manage an actual
 * MongoDB Atlas Cloud Backup restore — that is an Atlas-console action
 * this codebase cannot perform (no Atlas API credentials are configured
 * or assumed here; see §13's "backup enablement itself is an Atlas-
 * console action this codebase cannot perform" framing). This script
 * picks up AFTER you've already used the Atlas console to restore a
 * snapshot to a new, separate test cluster, per the runbook in
 * `docs/INCIDENT_RESPONSE.md` §7 and `docs/PRODUCTION_READINESS.md` §13.
 *
 * WHAT THIS DOES: replaces the previously-manual, vague "spot-check a few
 * Order/Wallet/Payment documents for consistency" step with a concrete,
 * repeatable, scriptable check comparing the LIVE production database
 * against the RESTORED test-cluster database:
 *   - Connects to both, confirms both are reachable.
 *   - Compares document counts for every collection registered in
 *     `models/index.ts` — a restore that silently dropped/truncated a
 *     collection shows up immediately as a large count mismatch.
 *   - Sums `Wallet.balance` (Decimal128) across all wallets in each
 *     database and compares the totals — the single most important
 *     invariant to protect in a money-handling app; a restore landing on
 *     a torn/inconsistent snapshot is far more likely to show up here
 *     (a total that doesn't match) than in a random single-document
 *     spot-check.
 *   - Reports the restored cluster's most recent `Order`/`Payment`
 *     `createdAt` timestamp and how far behind "now" it is — this is the
 *     real, unavoidable data-loss window inherent to snapshot/PITR
 *     restores (see §13's own callout that "restore to yesterday's
 *     midnight snapshot" can lose real transactions) — surfacing it as a
 *     concrete number rather than leaving it implicit.
 *   - Exits non-zero (and prints a clear FAIL banner) if the restored
 *     database looks meaningfully inconsistent with the live one, so this
 *     can be scripted/CI'd later if a scheduled drill is ever automated;
 *     for now it's intended to be run by hand during a manual restore
 *     drill, per §13's "do the dry-run restore now, not during a real
 *     incident" guidance.
 *
 * USAGE (run against your own two real connection strings — never share
 * production credentials in a screenshot/log when doing this for real):
 *
 *   npx tsx scripts/verify-restore.ts --live "$LIVE_MONGODB_URI" --restored "$RESTORED_MONGODB_URI"
 *
 * Both flags are required and deliberately NOT read from `.env`/
 * `MONGODB_URI` — this script's whole point is comparing TWO different
 * databases at once, which `lib/db.ts#connectDB()`'s single cached global
 * connection isn't designed for, so it manages its own two independent
 * `mongoose.createConnection()` instances instead. This also means this
 * script can safely be run against a live production database without
 * needing `MONGODB_URI` in the environment to point at it, reducing the
 * risk of some other script/route accidentally reusing the wrong
 * connection.
 */
import mongoose from "mongoose";
import { Decimal128 } from "mongodb";
import "../models";

interface Args {
  live: string;
  restored: string;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const live = get("--live");
  const restored = get("--restored");

  if (!live || !restored) {
    console.error(
      "Usage: npx tsx scripts/verify-restore.ts --live <MONGODB_URI> --restored <MONGODB_URI>\n\n" +
        "Both connection strings are required. See this file's header comment for the full\n" +
        "restore-drill procedure this script is meant to be run as part of."
    );
    process.exit(2);
  }

  return { live, restored };
}

// Every model registered via models/index.ts, keyed by its Mongoose model
// name (not the underlying MongoDB collection name) so we can look each
// one up on a specific connection with `connection.model(name)`.
const MODEL_NAMES = [
  "User",
  "Wallet",
  "Transaction",
  "Category",
  "ServiceGroup",
  "Provider",
  "ServiceProvider",
  "Service",
  "Order",
  "Payment",
  "SupportTicket",
  "AuditLog",
  "VerificationToken",
  "Settings",
  "ApiKey",
  "Notification",
];

async function connect(uri: string, label: string): Promise<mongoose.Connection> {
  const conn = mongoose.createConnection(uri, { serverSelectionTimeoutMS: 10_000 });
  await conn.asPromise();
  console.log(`✓ Connected to ${label} database`);
  return conn;
}

async function countAll(conn: mongoose.Connection): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const name of MODEL_NAMES) {
    // Registered globally by "@/models" against mongoose's default
    // connection; re-register the same schema against each independent
    // connection this script opens (mongoose supports this — a schema
    // object can back models on multiple connections at once).
    const globalModel = mongoose.models[name];
    if (!globalModel) {
      throw new Error(`Model "${name}" is not registered — check models/index.ts`);
    }
    const model = conn.models[name] ?? conn.model(name, globalModel.schema);
    counts[name] = await model.countDocuments({});
  }
  return counts;
}

async function sumWalletBalances(conn: mongoose.Connection): Promise<number> {
  const globalModel = mongoose.models.Wallet;
  const Wallet = conn.models.Wallet ?? conn.model("Wallet", globalModel.schema);
  const wallets = await Wallet.find().select("balance").lean();
  let total = 0n;
  const SCALE = 4;
  const SCALE_FACTOR = 10 ** SCALE;
  for (const w of wallets) {
    const balance = w.balance as Decimal128 | undefined;
    const num = balance ? parseFloat(balance.toString()) : 0;
    total += BigInt(Math.round(num * SCALE_FACTOR));
  }
  return Number(total) / SCALE_FACTOR;
}

async function mostRecentCreatedAt(conn: mongoose.Connection, modelName: string): Promise<Date | null> {
  const globalModel = mongoose.models[modelName];
  const Model = conn.models[modelName] ?? conn.model(modelName, globalModel.schema);
  const doc = await Model.findOne().sort({ createdAt: -1 }).select("createdAt").lean();
  return (doc as { createdAt?: Date } | null)?.createdAt ?? null;
}

async function main() {
  const { live, restored } = parseArgs(process.argv.slice(2));

  console.log("=== Restore drill verification (docs/PRODUCTION_READINESS.md §13) ===\n");

  const liveConn = await connect(live, "LIVE");
  const restoredConn = await connect(restored, "RESTORED");

  let failed = false;

  try {
    console.log("\n--- Document counts ---");
    const liveCounts = await countAll(liveConn);
    const restoredCounts = await countAll(restoredConn);

    for (const name of MODEL_NAMES) {
      const l = liveCounts[name];
      const r = restoredCounts[name];
      // Exact equality isn't expected/required here — the restore snapshot
      // is necessarily from some point BEFORE "now" on the live database,
      // so the restored count should be <= live, and any newer writes on
      // live since the snapshot explain the gap. What's actually wrong is
      // the restored count being suspiciously large relative to live
      // (impossible under a real point-in-time snapshot) or zero when live
      // is non-zero (a strong signal the collection didn't restore).
      const suspicious = r > l || (l > 0 && r === 0);
      const marker = suspicious ? "❌" : "✓";
      if (suspicious) failed = true;
      console.log(`${marker} ${name}: live=${l} restored=${r}`);
    }

    console.log("\n--- Wallet balance total (money-invariant check) ---");
    const liveTotal = await sumWalletBalances(liveConn);
    const restoredTotal = await sumWalletBalances(restoredConn);
    console.log(`  live:     ${liveTotal.toFixed(4)}`);
    console.log(`  restored: ${restoredTotal.toFixed(4)}`);
    if (restoredTotal > liveTotal) {
      console.log(
        "❌ Restored wallet-balance total EXCEEDS the live total — impossible under a real point-in-time " +
          "restore of an earlier snapshot; this indicates the restored data is corrupted/inconsistent, not " +
          "just older. Do not consider this restore verified."
      );
      failed = true;
    } else {
      console.log("✓ Restored total is <= live total, consistent with restoring an earlier point in time.");
    }

    console.log("\n--- Data-loss window (informational, not pass/fail) ---");
    for (const name of ["Order", "Payment"]) {
      const restoredLatest = await mostRecentCreatedAt(restoredConn, name);
      const liveLatest = await mostRecentCreatedAt(liveConn, name);
      if (!restoredLatest) {
        console.log(`  ${name}: restored database has no documents — cannot compute a window.`);
        continue;
      }
      const gapMs = (liveLatest?.getTime() ?? Date.now()) - restoredLatest.getTime();
      const gapMinutes = Math.round(gapMs / 60_000);
      console.log(
        `  ${name}: restored snapshot's most recent record is ${gapMinutes} minute(s) behind ` +
          `${liveLatest ? "live's most recent record" : "now"} — this many minutes of ${name} data ` +
          "would be lost if you cut over to this restore right now."
      );
    }

    console.log("\n=== " + (failed ? "❌ FAIL — see above, do not treat this restore as verified" : "✓ PASS") + " ===");
  } finally {
    await liveConn.close();
    await restoredConn.close();
  }

  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error("Restore verification script crashed:", err);
  process.exit(1);
});
