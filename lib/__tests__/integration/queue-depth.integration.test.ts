import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { Types } from "mongoose";
import { Decimal128 } from "mongodb";
import { startTestDb, stopTestDb, clearTestDb } from "./setup";

/**
 * `checkQueueDepth` (like every function in lib/services/jobs.ts) calls
 * `connectDB()` itself, which reads `env.MONGODB_URI` (validated at import
 * time by lib/env.ts) and manages its own cached connection — the wrong
 * shape for this suite, which connects directly to the in-memory replica
 * set via `mongoose.connect()` in ./setup.ts instead (see that file's doc
 * comment for the full rationale, already established by the other
 * integration suites in this directory). Mocked to a no-op here so
 * `checkQueueDepth`'s queries run against the already-open test
 * connection rather than attempting a second, real-env-var-dependent one.
 */
vi.mock("@/lib/db", () => ({
  connectDB: vi.fn().mockResolvedValue(undefined),
}));

import {
  checkQueueDepth,
  STALE_PROCESSING_MINUTES,
  PENDING_BACKLOG_ALERT_THRESHOLD,
} from "@/lib/services/jobs";
import { Order, type OrderStatus } from "@/models/Order";

/**
 * DB-backed integration coverage for `lib/services/jobs.ts#checkQueueDepth`
 * — closes the "order-processing queue depth" alerting gap flagged as
 * honestly open in `docs/PRODUCTION_READINESS.md` §6 (now implemented,
 * wired into `GET /api/cron/process-orders`, see that route).
 *
 * Uses a real MongoDB replica set (see ./setup.ts) rather than mocks
 * specifically to exercise the actual `Order.countDocuments` queries
 * (status + `updatedAt` comparisons) against real documents/indexes,
 * matching how `lib/__tests__/integration/orders.integration.test.ts`
 * already validates the transactional order-placement path for the same
 * reason.
 */
describe("lib/services/jobs — checkQueueDepth (integration)", () => {
  beforeAll(async () => {
    await startTestDb();
  }, 60_000);

  afterAll(async () => {
    await stopTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();
  });

  async function createOrder(overrides: { status: OrderStatus; updatedAtMinutesAgo?: number }) {
    const order = await Order.create({
      userId: new Types.ObjectId(),
      serviceId: new Types.ObjectId(),
      target: "https://example.com/profile",
      quantity: 100,
      charge: Decimal128.fromString("1.00"),
      status: overrides.status,
    });

    if (overrides.updatedAtMinutesAgo !== undefined) {
      // Mongoose's `timestamps: true` overwrites `updatedAt` on `.create()`
      // and on any `.save()`/`.updateOne()` call unless explicitly told not
      // to — `timestamps: false` on this one update is required to
      // backdate it for the test, exactly as production code would need to
      // avoid doing accidentally.
      const backdated = new Date(Date.now() - overrides.updatedAtMinutesAgo * 60 * 1000);
      await Order.updateOne({ _id: order._id }, { $set: { updatedAt: backdated } }, { timestamps: false });
    }

    return order;
  }

  it("reports zero counts and no alert when the queue is empty", async () => {
    const result = await checkQueueDepth();
    expect(result).toEqual({
      staleProcessingCount: 0,
      pendingBacklogCount: 0,
      staleProcessingThresholdMinutes: STALE_PROCESSING_MINUTES,
      pendingBacklogThreshold: PENDING_BACKLOG_ALERT_THRESHOLD,
      alert: false,
    });
  });

  it("does not alert on a PROCESSING order that is still fresh", async () => {
    await createOrder({ status: "PROCESSING", updatedAtMinutesAgo: 1 });

    const result = await checkQueueDepth();
    expect(result.staleProcessingCount).toBe(0);
    expect(result.alert).toBe(false);
  });

  it("alerts on a PROCESSING order stuck past the stale threshold", async () => {
    await createOrder({ status: "PROCESSING", updatedAtMinutesAgo: STALE_PROCESSING_MINUTES + 5 });

    const result = await checkQueueDepth();
    expect(result.staleProcessingCount).toBe(1);
    expect(result.alert).toBe(true);
  });

  it("does not count IN_PROGRESS/COMPLETED orders as stale PROCESSING regardless of age", async () => {
    await createOrder({ status: "IN_PROGRESS", updatedAtMinutesAgo: STALE_PROCESSING_MINUTES + 30 });
    await createOrder({ status: "COMPLETED", updatedAtMinutesAgo: STALE_PROCESSING_MINUTES + 30 });

    const result = await checkQueueDepth();
    expect(result.staleProcessingCount).toBe(0);
    expect(result.alert).toBe(false);
  });

  it("does not alert on a PENDING backlog at or below the threshold", async () => {
    for (let i = 0; i < PENDING_BACKLOG_ALERT_THRESHOLD; i++) {
      await createOrder({ status: "PENDING" });
    }

    const result = await checkQueueDepth();
    expect(result.pendingBacklogCount).toBe(PENDING_BACKLOG_ALERT_THRESHOLD);
    expect(result.alert).toBe(false);
  });

  it("alerts once the PENDING backlog exceeds the threshold", async () => {
    for (let i = 0; i < PENDING_BACKLOG_ALERT_THRESHOLD + 1; i++) {
      await createOrder({ status: "PENDING" });
    }

    const result = await checkQueueDepth();
    expect(result.pendingBacklogCount).toBe(PENDING_BACKLOG_ALERT_THRESHOLD + 1);
    expect(result.alert).toBe(true);
  });
});
