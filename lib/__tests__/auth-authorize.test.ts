import { describe, it, expect, vi, beforeEach } from "vitest";
import { hash } from "bcryptjs";

/**
 * Unit tests for `lib/auth/authorize.ts#authorizeCredentials` — the
 * NextAuth Credentials provider's actual login logic. It lives in its own
 * module (rather than inlined in `auth.ts`) specifically so it can be
 * imported and exercised directly here: `auth.ts` calls `NextAuth(...)`
 * at module scope, which transitively imports `next/server` — that import
 * fails outright under Vitest's plain Node test environment, making
 * `auth.ts` itself unimportable from a fast unit test. See
 * `lib/auth/authorize.ts`'s own doc comment for the full explanation.
 *
 * `@/lib/db` (the Prisma client) and `@/lib/audit` are both mocked — this
 * suite's job is the LOGIN LOGIC itself (rate limiting, malformed input,
 * unknown/wrong credentials, account lockout, inactive-status rejection,
 * successful login + lockout-counter reset), not a real DB round-trip;
 * that's already covered by the DB-backed integration suite's own
 * philosophy for the four money-moving service functions, and directly
 * exercised for real (via a live browser + real Postgres database)
 * against this exact code path by `e2e/auth.e2e.ts`.
 *
 * `@/lib/rate-limit` is mocked too, EXCEPT in the dedicated rate-limiting
 * test group below, which deliberately uses the REAL module (with a real,
 * ephemeral in-memory counter — no Upstash/Redis needed, see
 * lib/rate-limit.ts's own documented fallback) to prove the actual
 * IP-based `rateLimit("login", ip)` call added to `authorizeCredentials`
 * really rejects a 6th attempt within the same window. This is the
 * specific gap this test suite exists to close: `lib/rate-limit.ts`
 * defined a `login` config entry from early in this project's history,
 * but grep across the whole codebase (before this fix) confirmed it was
 * never actually called anywhere — login attempts had NO IP-based rate
 * limit, only the separate per-account lockout this file also tests.
 */

const mockFindUnique = vi.fn();
const mockUserUpdate = vi.fn();
const mockRecordAudit = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: mockFindUnique,
      update: mockUserUpdate,
    },
  },
}));

vi.mock("@/lib/audit", () => ({
  recordAudit: mockRecordAudit,
}));

function req(): Request {
  // A fixed IP per test file import isn't safe across tests within the
  // SAME describe block (the in-memory rate limiter is a module-level
  // singleton, so reusing the same IP across independent tests would leak
  // state between them) — each test that needs isolation from the rate
  // limiter provides its own unique IP via `reqFromIp`.
  return new Request("http://localhost/api/auth/callback/credentials", {
    headers: { "x-forwarded-for": "203.0.113.1" },
  });
}

function reqFromIp(ip: string): Request {
  return new Request("http://localhost/api/auth/callback/credentials", {
    headers: { "x-forwarded-for": ip },
  });
}

// Monotonically incrementing octet (rather than `Math.random()`) to
// guarantee no two tests in this file — or across a `--repeat`/CI retry —
// ever collide on the same synthetic IP and pollute each other's rate-limit
// counters, which live in a module-level in-memory Map for the lifetime of
// this test file's process.
let nextTestIpOctet = 1;
function uniqueTestIp(): string {
  nextTestIpOctet += 1;
  return `198.51.100.${nextTestIpOctet}`;
}

function makeUserDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: "507f1f77bcf86cd799439011",
    email: "user@example.com",
    name: "Test User",
    role: "USER",
    status: "ACTIVE",
    passwordHash: null as string | null,
    failedLoginAttempts: 0,
    lockedUntil: null as Date | null,
    lastLoginAt: null as Date | null,
    ...overrides,
  };
}

beforeEach(() => {
  mockFindUnique.mockReset();
  mockUserUpdate.mockReset().mockResolvedValue(undefined);
  mockRecordAudit.mockReset().mockResolvedValue(undefined);
});

describe("auth.ts#authorizeCredentials — malformed/missing input", () => {
  it("rejects when email is missing", async () => {
    vi.resetModules();
    vi.doMock("@/lib/rate-limit", () => ({
      rateLimit: vi.fn().mockResolvedValue({ success: true, remaining: 1, reset: 0 }),
      getClientIp: () => "203.0.113.1",
    }));
    const { authorizeCredentials } = await import("@/lib/auth/authorize");

    const result = await authorizeCredentials({ password: "whatever" }, req());
    expect(result).toBeNull();
    expect(mockFindUnique).not.toHaveBeenCalled();
    vi.doUnmock("@/lib/rate-limit");
  });

  it("rejects a malformed email address without ever querying the DB", async () => {
    vi.resetModules();
    vi.doMock("@/lib/rate-limit", () => ({
      rateLimit: vi.fn().mockResolvedValue({ success: true, remaining: 1, reset: 0 }),
      getClientIp: () => "203.0.113.1",
    }));
    const { authorizeCredentials } = await import("@/lib/auth/authorize");

    const result = await authorizeCredentials({ email: "not-an-email", password: "x" }, req());
    expect(result).toBeNull();
    expect(mockFindUnique).not.toHaveBeenCalled();
    vi.doUnmock("@/lib/rate-limit");
  });
});

describe("auth.ts#authorizeCredentials — credential verification", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("@/lib/rate-limit", () => ({
      rateLimit: vi.fn().mockResolvedValue({ success: true, remaining: 1, reset: 0 }),
      getClientIp: () => "203.0.113.1",
    }));
  });

  it("rejects an email with no matching account (and never leaks that distinction to the caller)", async () => {
    mockFindUnique.mockResolvedValue(null);
    const { authorizeCredentials } = await import("@/lib/auth/authorize");

    const result = await authorizeCredentials({ email: "nobody@example.com", password: "whatever" }, req());
    expect(result).toBeNull();
  });

  it("rejects a correct email with the wrong password, and increments failedLoginAttempts", async () => {
    const passwordHash = await hash("CorrectHorseBattery1!", 12);
    const user = makeUserDoc({ passwordHash });
    mockFindUnique.mockResolvedValue(user);
    const { authorizeCredentials } = await import("@/lib/auth/authorize");

    const result = await authorizeCredentials({ email: "user@example.com", password: "WrongPassword1!" }, req());

    expect(result).toBeNull();
    expect(mockUserUpdate).toHaveBeenCalledTimes(1);
    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: user.id },
        data: expect.objectContaining({ failedLoginAttempts: 1, lockedUntil: null }),
      })
    );
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "LOGIN_FAILED", actorEmail: "user@example.com" })
    );
  });

  it("locks the account after 5 cumulative failed attempts", async () => {
    const passwordHash = await hash("CorrectHorseBattery1!", 12);
    const user = makeUserDoc({ passwordHash, failedLoginAttempts: 4 });
    mockFindUnique.mockResolvedValue(user);
    const { authorizeCredentials } = await import("@/lib/auth/authorize");

    await authorizeCredentials({ email: "user@example.com", password: "WrongPassword1!" }, req());

    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: user.id },
        data: expect.objectContaining({ failedLoginAttempts: 5, lockedUntil: expect.any(Date) }),
      })
    );
    const call = mockUserUpdate.mock.calls[0][0];
    expect(call.data.lockedUntil.getTime()).toBeGreaterThan(Date.now());
  });

  it("rejects a login attempt while the account is still locked, even with the correct password", async () => {
    const passwordHash = await hash("CorrectHorseBattery1!", 12);
    const user = makeUserDoc({ passwordHash, lockedUntil: new Date(Date.now() + 60_000) });
    mockFindUnique.mockResolvedValue(user);
    const { authorizeCredentials } = await import("@/lib/auth/authorize");

    const result = await authorizeCredentials(
      { email: "user@example.com", password: "CorrectHorseBattery1!" },
      req()
    );

    expect(result).toBeNull();
    // The lockout check short-circuits before ever calling compare()/update()
    // for this branch — confirmed by asserting update() was never reached.
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("rejects a correct password for a non-ACTIVE (suspended/banned) account", async () => {
    const passwordHash = await hash("CorrectHorseBattery1!", 12);
    const user = makeUserDoc({ passwordHash, status: "SUSPENDED" });
    mockFindUnique.mockResolvedValue(user);
    const { authorizeCredentials } = await import("@/lib/auth/authorize");

    const result = await authorizeCredentials(
      { email: "user@example.com", password: "CorrectHorseBattery1!" },
      req()
    );

    expect(result).toBeNull();
  });

  it("accepts the correct password for an ACTIVE account, resets lockout counters, and records LOGIN_SUCCESS", async () => {
    const passwordHash = await hash("CorrectHorseBattery1!", 12);
    const user = makeUserDoc({ passwordHash, failedLoginAttempts: 3 });
    mockFindUnique.mockResolvedValue(user);
    const { authorizeCredentials } = await import("@/lib/auth/authorize");

    const result = await authorizeCredentials(
      { email: "user@example.com", password: "CorrectHorseBattery1!" },
      req()
    );

    expect(result).toEqual({
      id: "507f1f77bcf86cd799439011",
      email: "user@example.com",
      name: "Test User",
      role: "USER",
      status: "ACTIVE",
    });
    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: user.id },
        data: expect.objectContaining({ failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: expect.any(Date) }),
      })
    );
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "LOGIN_SUCCESS", actorEmail: "user@example.com" })
    );
  });

  it("queries the database via Prisma before returning a result", async () => {
    mockFindUnique.mockResolvedValue(null);
    const { authorizeCredentials } = await import("@/lib/auth/authorize");

    await authorizeCredentials({ email: "nobody@example.com", password: "whatever" }, req());
    expect(mockFindUnique).toHaveBeenCalledTimes(1);
    expect(mockFindUnique).toHaveBeenCalledWith({ where: { email: "nobody@example.com" } });
  });
});

describe("auth.ts#authorizeCredentials — IP-based login rate limiting (real lib/rate-limit.ts, not mocked)", () => {
  // Uses the REAL lib/rate-limit.ts module (its documented in-memory
  // fallback, since no UPSTASH_* env vars are configured for this fast
  // unit-test config) — this is the actual regression test for the gap
  // this change closes: `login` was defined in lib/rate-limit.ts's
  // `configs` but never called from anywhere in the codebase before this
  // change, so a client could attempt unlimited logins against unlimited
  // different (nonexistent or real) accounts from one IP with zero rate
  // limiting, independent of the separate per-account lockout tested
  // above (which only triggers on repeated failures against the SAME
  // account).
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("@/lib/rate-limit");
    // lib/rate-limit.ts's getRedis() reads `env.UPSTASH_REDIS_REST_URL`
    // (via lib/env.ts's Zod-validated `env` proxy), which validates the
    // ENTIRE env schema on first access — including DATABASE_URL/
    // DIRECT_URL/AUTH_SECRET, which this fast unit-test config
    // deliberately leaves unset everywhere else in this suite (see
    // vitest.config.mts's own comment) so that any route that reaches
    // past its auth gate to a real DB call fails loudly. Here, unlike the
    // rest of this file, the real (unmocked) lib/rate-limit.ts module IS
    // the thing under test, so it needs the schema to validate
    // successfully in order to reach its actual
    // `!UPSTASH_REDIS_REST_URL` check and fall through to the in-memory
    // limiter — these are throwaway values, never used to contact any
    // real service (UPSTASH_* stays unset, so getRedis() still returns
    // null and the in-memory path is what's actually exercised).
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/unit-test-placeholder?schema=public";
    process.env.DIRECT_URL = "postgresql://user:pass@localhost:5432/unit-test-placeholder?schema=public";
    process.env.AUTH_SECRET = "unit-test-placeholder-secret-not-a-real-secret-000";
  });

  it("allows up to the configured per-IP limit within the window, then rejects the next attempt — even with correct credentials", async () => {
    // Longer timeout than this file's other tests: this test deliberately
    // calls authorizeCredentials() LOGIN_LIMIT+1 times, each doing a real
    // (not mocked) bcrypt compare — bcrypt is intentionally slow (cost
    // factor 12), so 20+ real compares in one test legitimately takes
    // longer than Vitest's 5s default.
    const passwordHash = await hash("CorrectHorseBattery1!", 12);
    mockFindUnique.mockImplementation(() => Promise.resolve(makeUserDoc({ passwordHash })));
    const { authorizeCredentials } = await import("@/lib/auth/authorize");

    const ip = uniqueTestIp();
    const credentials = { email: "user@example.com", password: "CorrectHorseBattery1!" };
    const LOGIN_LIMIT = 20; // must match lib/rate-limit.ts's `configs.login[0]`

    for (let i = 0; i < LOGIN_LIMIT; i++) {
      const result = await authorizeCredentials(credentials, reqFromIp(ip));
      expect(result).not.toBeNull();
    }

    // The next attempt from the SAME ip within the same window must be
    // rejected by the rate limiter itself — the DB lookup mock above would
    // otherwise happily return a valid user every time, proving this
    // rejection specifically comes from `rateLimit("login", ip)`, not from
    // account-level lockout (a fresh mocked user document with
    // `failedLoginAttempts: 0` is returned on every call).
    const oneOver = await authorizeCredentials(credentials, reqFromIp(ip));
    expect(oneOver).toBeNull();
  }, 20_000);

  it(
    "does not rate-limit a different IP even after another IP has exhausted its own limit",
    async () => {
      const passwordHash = await hash("CorrectHorseBattery1!", 12);
      mockFindUnique.mockImplementation(() => Promise.resolve(makeUserDoc({ passwordHash })));
      const { authorizeCredentials } = await import("@/lib/auth/authorize");

      const exhaustedIp = uniqueTestIp();
      const freshIp = uniqueTestIp();
      const credentials = { email: "user@example.com", password: "CorrectHorseBattery1!" };
      const LOGIN_LIMIT = 20; // must match lib/rate-limit.ts's `configs.login[0]`

      for (let i = 0; i < LOGIN_LIMIT + 1; i++) {
        await authorizeCredentials(credentials, reqFromIp(exhaustedIp));
      }

      const resultOnFreshIp = await authorizeCredentials(credentials, reqFromIp(freshIp));
      expect(resultOnFreshIp).not.toBeNull();
    },
    20_000
  );
});
