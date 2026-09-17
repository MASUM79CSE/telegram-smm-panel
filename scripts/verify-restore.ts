/**
 * Automated restore-drill verification (docs/PRODUCTION_READINESS.md §13 —
 * Backup & Recovery / Disaster Recovery, docs/INCIDENT_RESPONSE.md §7).
 *
 * WHAT THIS DOES NOT DO: it does not create, trigger, or manage an actual
 * Supabase/Postgres point-in-time-recovery or backup restore — that is a
 * Supabase-console (or `pg_restore`) action this codebase cannot perform
 * (no Supabase management-API credentials are configured or assumed here).
 * This script picks up AFTER you've already restored a snapshot/backup to
 * a new, separate test database, per the runbook in
 * `docs/INCIDENT_RESPONSE.md` §7 and `docs/PRODUCTION_READINESS.md` §13.
 *
 * WHAT THIS DOES: replaces the previously-manual, vague "spot-check a few
 * Order/Wallet/Payment rows for consistency" step with a concrete,
 * repeatable, scriptable check comparing the LIVE production database
 * against the RESTORED test database:
 *   - Connects to both, confirms both are reachable.
 *   - Compares row counts for every table in `prisma/schema.prisma` — a
 *     restore that silently dropped/truncated a table shows up immediately
 *     as a large count mismatch.
 *   - Sums `Wallet.balance` (Postgres `Decimal`) across all wallets in each
 *     database and compares the totals — the single most important
 *     invariant to protect in a money-handling app; a restore landing on a
 *     torn/inconsistent snapshot is far more likely to show up here (a
 *     total that doesn't match) than in a random single-row spot-check.
 *   - Reports the restored database's most recent `Order`/`Payment`
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
 *   npx tsx scripts/verify-restore.ts --live "$LIVE_DATABASE_URL" --restored "$RESTORED_DATABASE_URL"
 *
 * Both flags are required and deliberately NOT read from `.env`/
 * `DATABASE_URL` — this script's whole point is comparing TWO different
 * databases at once, which `lib/db.ts`'s single cached global Prisma
 * client isn't designed for, so it manages its own two independent
 * `PrismaClient` instances instead (each pointed at its own connection
 * string via the `datasourceUrl` constructor option). This also means
 * this script can safely be run without needing `DATABASE_URL` in the
 * environment to point at production, reducing the risk of some other
 * script/route accidentally reusing the wrong connection.
 */
import { PrismaClient, type Prisma } from "../lib/generated/prisma";
import { decimalToNumber } from "../lib/money";

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
      "Usage: npx tsx scripts/verify-restore.ts --live <DATABASE_URL> --restored <DATABASE_URL>\n\n" +
        "Both connection strings are required. See this file's header comment for the full\n" +
        "restore-drill procedure this script is meant to be run as part of."
    );
    process.exit(2);
  }

  return { live, restored };
}

// Every table in prisma/schema.prisma, keyed by its Prisma client accessor
// name (camelCase model name) so we can call `client[name].count()`
// generically on either connection.
const MODEL_NAMES = [
  "user",
  "wallet",
  "transaction",
  "category",
  "serviceGroup",
  "provider",
  "serviceProvider",
  "service",
  "favoriteService",
  "order",
  "payment",
  "supportTicket",
  "ticketMessage",
  "auditLog",
  "verificationToken",
  "settings",
  "apiKey",
  "notification",
  "exchangeRateCache",
  "telegramBotSession",
] as const;

type ModelName = (typeof MODEL_NAMES)[number];

// A minimal structural type for the subset of the generated Prisma Client
// this script needs on each model delegate — avoids depending on the
// full generated per-model type surface, which differs per model.
type Delegate = {
  count: (args?: unknown) => Promise<number>;
  findMany: (args?: unknown) => Promise<Array<Record<string, unknown>>>;
  findFirst: (args?: unknown) => Promise<Record<string, unknown> | null>;
};

function delegate(client: PrismaClient, name: ModelName): Delegate {
  return (client as unknown as Record<ModelName, Delegate>)[name];
}

async function connect(url: string, label: string): Promise<PrismaClient> {
  const client = new PrismaClient({ datasourceUrl: url });
  await client.$connect();
  console.log(`✓ Connected to ${label} database`);
  return client;
}

async function countAll(client: PrismaClient): Promise<Record<ModelName, number>> {
  const counts = {} as Record<ModelName, number>;
  for (const name of MODEL_NAMES) {
    counts[name] = await delegate(client, name).count();
  }
  return counts;
}

async function sumWalletBalances(client: PrismaClient): Promise<number> {
  const wallets = await client.wallet.findMany({ select: { balance: true } });
  let total = 0n;
  const SCALE = 4;
  const SCALE_FACTOR = 10 ** SCALE;
  for (const w of wallets) {
    const num = decimalToNumber(w.balance as unknown as Prisma.Decimal);
    total += BigInt(Math.round(num * SCALE_FACTOR));
  }
  return Number(total) / SCALE_FACTOR;
}

async function mostRecentCreatedAt(client: PrismaClient, modelName: "order" | "payment"): Promise<Date | null> {
  const row = await delegate(client, modelName).findFirst({
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return (row?.createdAt as Date | undefined) ?? null;
}

async function main() {
  const { live, restored } = parseArgs(process.argv.slice(2));

  console.log("=== Restore drill verification (docs/PRODUCTION_READINESS.md §13) ===\n");

  const liveClient = await connect(live, "LIVE");
  const restoredClient = await connect(restored, "RESTORED");

  let failed = false;

  try {
    console.log("\n--- Row counts ---");
    const liveCounts = await countAll(liveClient);
    const restoredCounts = await countAll(restoredClient);

    for (const name of MODEL_NAMES) {
      const l = liveCounts[name];
      const r = restoredCounts[name];
      // Exact equality isn't expected/required here — the restore snapshot
      // is necessarily from some point BEFORE "now" on the live database,
      // so the restored count should be <= live, and any newer writes on
      // live since the snapshot explain the gap. What's actually wrong is
      // the restored count being suspiciously large relative to live
      // (impossible under a real point-in-time snapshot) or zero when live
      // is non-zero (a strong signal the table didn't restore).
      const suspicious = r > l || (l > 0 && r === 0);
      const marker = suspicious ? "❌" : "✓";
      if (suspicious) failed = true;
      console.log(`${marker} ${name}: live=${l} restored=${r}`);
    }

    console.log("\n--- Wallet balance total (money-invariant check) ---");
    const liveTotal = await sumWalletBalances(liveClient);
    const restoredTotal = await sumWalletBalances(restoredClient);
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
    for (const name of ["order", "payment"] as const) {
      const restoredLatest = await mostRecentCreatedAt(restoredClient, name);
      const liveLatest = await mostRecentCreatedAt(liveClient, name);
      if (!restoredLatest) {
        console.log(`  ${name}: restored database has no rows — cannot compute a window.`);
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
    await liveClient.$disconnect();
    await restoredClient.$disconnect();
  }

  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error("Restore verification script crashed:", err);
  process.exit(1);
});
