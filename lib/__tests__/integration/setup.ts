import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";


/**
 * Shared DB-backed integration test harness (docs/PRODUCTION_READINESS.md's
 * top-priority gap: "no DB-backed integration or e2e coverage" for the
 * transactional money-moving service functions).
 *
 * Uses `mongodb-memory-server` as a real **replica set** (not standalone)
 * — required because `placeOrder`/`approveDeposit`/`refundOrder`/
 * `issuePartialRefund` all use `mongoose.startSession().withTransaction()`,
 * and MongoDB only supports multi-document transactions on a replica set
 * (exactly like the real MongoDB Atlas deployment target — even its free
 * M0 tier is always a replica set, per `scripts/start-dev-db.ts`'s own
 * comment and `README.md` §"Local development database").
 *
 * Deliberately NOT using `lib/db.ts#connectDB()` here: that helper reads
 * `env.MONGODB_URI` (validated at import time via `lib/env.ts`) and caches
 * a single global connection across hot-reloads/serverless invocations —
 * both are the wrong shape for a test suite that needs a fresh, isolated,
 * ephemeral database per run. Service functions under test
 * (`lib/services/*.ts`) never call `connectDB()` themselves — only route
 * handlers do — so calling `mongoose.connect()` directly against the
 * in-memory replica set here is sufficient and keeps this suite fully
 * decoupled from real env vars/secrets.
 */
let replSet: MongoMemoryReplSet | undefined;

export async function startTestDb(): Promise<void> {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  const uri = replSet.getUri();
  await mongoose.connect(uri, { dbName: "test" });
}

export async function stopTestDb(): Promise<void> {
  await mongoose.disconnect();
  await replSet?.stop();
}

/** Drops all collections between tests so each test starts from a clean slate without paying the cost of a fresh replica set per test. */
export async function clearTestDb(): Promise<void> {
  const collections = mongoose.connection.collections;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
}
