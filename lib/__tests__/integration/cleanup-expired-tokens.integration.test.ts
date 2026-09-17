import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { startTestDb, stopTestDb, clearTestDb, getTestClient } from "./setup";

import { runCleanupExpiredTokensJob } from "@/lib/services/jobs";
import type { PrismaClient } from "@/lib/generated/prisma";

/**
 * DB-backed integration coverage for
 * `lib/services/jobs.ts#runCleanupExpiredTokensJob` — closes the gap
 * flagged in `prisma/schema.prisma`'s own `VerificationToken` comment:
 * MongoDB's native TTL index (`expireAfterSeconds: 0` on `expiresAt`)
 * deleted expired documents automatically; Postgres has no equivalent, so
 * this job (and the matching `GET /api/cron/cleanup-expired-tokens` route)
 * is what actually performs that cleanup now. Before this test/job
 * existed, expired `VerificationToken` rows were never deleted at all —
 * this suite exists specifically to prove the replacement mechanism
 * works, not just that the schema comment describes one.
 *
 * Uses a real local PostgreSQL database (see ./setup.ts), same rationale
 * as `queue-depth.integration.test.ts`: exercises the actual
 * `prisma.verificationToken.deleteMany` query and its `expiresAt`
 * comparison against real rows, not a mock.
 */
describe("lib/services/jobs — runCleanupExpiredTokensJob (integration)", () => {
  let db: PrismaClient;

  beforeAll(async () => {
    db = await startTestDb();
  }, 60_000);

  afterAll(async () => {
    await stopTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();
  });

  async function seedUser() {
    return db.user.create({
      data: {
        name: "Test User",
        email: `user-${Date.now()}-${Math.random()}@example.com`,
        passwordHash: "irrelevant",
        role: "USER",
        status: "ACTIVE",
      },
    });
  }

  async function createToken(userId: string, expiresAtDaysFromNow: number) {
    return db.verificationToken.create({
      data: {
        userId,
        tokenHash: `hash-${Date.now()}-${Math.random()}`,
        purpose: "EMAIL_VERIFY",
        expiresAt: new Date(Date.now() + expiresAtDaysFromNow * 24 * 60 * 60 * 1000),
      },
    });
  }

  it("deletes nothing when there are no tokens at all", async () => {
    const result = await runCleanupExpiredTokensJob();
    expect(result).toEqual({ candidateCount: 0, succeeded: 0, failed: 0 });
  });

  it("does not delete a token that hasn't expired yet", async () => {
    const user = await seedUser();
    await createToken(user.id, 1); // expires 1 day in the future

    const result = await runCleanupExpiredTokensJob();
    expect(result.candidateCount).toBe(0);

    const remaining = await db.verificationToken.count();
    expect(remaining).toBe(1);
  });

  it("does not delete a token that expired recently, within the retention grace window", async () => {
    const user = await seedUser();
    // Expired 1 day ago — well within the retention window, so it must
    // still be inspectable (see EXPIRED_TOKEN_RETENTION_DAYS's own comment).
    await createToken(user.id, -1);

    const result = await runCleanupExpiredTokensJob();
    expect(result.candidateCount).toBe(0);

    const remaining = await db.verificationToken.count();
    expect(remaining).toBe(1);
  });

  it("deletes a token that expired well past the retention window", async () => {
    const user = await seedUser();
    // Expired 30 days ago — past the (7-day) retention window.
    await createToken(user.id, -30);

    const result = await runCleanupExpiredTokensJob();
    expect(result).toEqual({ candidateCount: 1, succeeded: 1, failed: 0 });

    const remaining = await db.verificationToken.count();
    expect(remaining).toBe(0);
  });

  it("only deletes tokens past the retention window, leaving fresher ones (expired or not) intact", async () => {
    const user = await seedUser();
    const stale = await createToken(user.id, -30); // should be deleted
    const recentlyExpired = await createToken(user.id, -1); // should survive (grace window)
    const notYetExpired = await createToken(user.id, 5); // should survive (not expired)

    const result = await runCleanupExpiredTokensJob();
    expect(result).toEqual({ candidateCount: 1, succeeded: 1, failed: 0 });

    const remainingIds = (await db.verificationToken.findMany({ select: { id: true } })).map((t) => t.id);
    expect(remainingIds).not.toContain(stale.id);
    expect(remainingIds).toContain(recentlyExpired.id);
    expect(remainingIds).toContain(notYetExpired.id);
  });

  it("is idempotent — running it twice in a row deletes nothing the second time", async () => {
    const user = await seedUser();
    await createToken(user.id, -30);

    const first = await runCleanupExpiredTokensJob();
    expect(first.candidateCount).toBe(1);

    const second = await runCleanupExpiredTokensJob();
    expect(second).toEqual({ candidateCount: 0, succeeded: 0, failed: 0 });
  });
});
