import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Unit tests for `lib/security/cron-auth.ts#verifyCronSecret` — the shared
 * auth gate for `GET /api/cron/*` (docs/PRODUCTION_READINESS.md §14: these
 * endpoints exist because Vercel has no long-lived background-worker
 * process, so an external scheduler invokes them instead — see
 * `.github/workflows/cron.yml`).
 *
 * `lib/env.ts` is NOT mocked here — `env.CRON_SECRET` is a real Proxy over
 * `process.env` re-validated by Zod on each access (see `lib/env.ts`'s
 * `getEnv()` caching), so `vi.stubEnv` + resetting the module's internal
 * cache via `vi.resetModules()` between tests is the correct way to flip
 * it, rather than mocking the whole env module and losing coverage of the
 * real schema/caching behavior.
 */

const ORIGINAL_ENV = { ...process.env };

async function importCronAuth() {
  vi.resetModules();
  return import("@/lib/security/cron-auth");
}

function makeRequest(authHeader?: string): Request {
  return new Request("http://localhost/api/cron/process-orders", {
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

describe("lib/security/cron-auth — verifyCronSecret", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    // Required fields lib/env.ts's Zod schema needs regardless of this
    // test's concern, so getEnv() doesn't throw for unrelated reasons.
    process.env.MONGODB_URI ||= "mongodb://localhost:27017/test";
    process.env.AUTH_SECRET ||= "a".repeat(32);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("fails closed (503) when CRON_SECRET is not configured at all", async () => {
    delete process.env.CRON_SECRET;
    const { verifyCronSecret } = await importCronAuth();

    const result = verifyCronSecret(makeRequest("Bearer anything"));

    expect(result).not.toBeNull();
    expect(result!.status).toBe(503);
  });

  it("rejects (401) a request with no Authorization header", async () => {
    process.env.CRON_SECRET = "correct-secret-value-0123456789";
    const { verifyCronSecret } = await importCronAuth();

    const result = verifyCronSecret(makeRequest());

    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });

  it("rejects (401) a request with the wrong secret", async () => {
    process.env.CRON_SECRET = "correct-secret-value-0123456789";
    const { verifyCronSecret } = await importCronAuth();

    const result = verifyCronSecret(makeRequest("Bearer wrong-secret"));

    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });

  it("rejects (401) a secret that is a prefix of the correct one (length-mismatch case)", async () => {
    process.env.CRON_SECRET = "correct-secret-value-0123456789";
    const { verifyCronSecret } = await importCronAuth();

    const result = verifyCronSecret(makeRequest("Bearer correct-secret"));

    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });

  it("rejects (401) a secret that is longer than the correct one", async () => {
    process.env.CRON_SECRET = "correct-secret-value-0123456789";
    const { verifyCronSecret } = await importCronAuth();

    const result = verifyCronSecret(makeRequest("Bearer correct-secret-value-0123456789-and-then-some"));

    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });

  it("accepts (returns null) the correct secret via Bearer header", async () => {
    process.env.CRON_SECRET = "correct-secret-value-0123456789";
    const { verifyCronSecret } = await importCronAuth();

    const result = verifyCronSecret(makeRequest("Bearer correct-secret-value-0123456789"));

    expect(result).toBeNull();
  });

  it("rejects (401) a non-Bearer Authorization scheme even with the right value", async () => {
    process.env.CRON_SECRET = "correct-secret-value-0123456789";
    const { verifyCronSecret } = await importCronAuth();

    const result = verifyCronSecret(makeRequest("Basic correct-secret-value-0123456789"));

    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });
});
