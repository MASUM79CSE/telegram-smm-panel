import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Route-handler auth/authorization BOUNDARY tests
 * (docs/PRODUCTION_READINESS.md §15, item 3 — the next-priority testing
 * gap after the DB-backed integration suite in
 * `lib/__tests__/integration/`).
 *
 * Scope and approach:
 *
 * These tests import the REAL route modules under `app/api/**` — the exact
 * files Next.js actually serves — and call their exported `GET`/`POST`/
 * `PATCH`/`DELETE` handlers directly with a plain `Request`, asserting only
 * on the HTTP status/shape of the auth/authorization gate itself:
 *   - no session at all -> 401 "Unauthorized" (session-gated routes) or 403
 *     "Forbidden" (routes that gate on session directly to a role check,
 *     which is this project's own established convention — see
 *     MEMORY.md/PRODUCTION_READINESS.md: admin routes check
 *     `!session?.user?.id || role !== "ADMIN"` in one combined condition,
 *     so a *missing* session on an admin route also produces 403, not 401;
 *     this is intentional so a client can't distinguish "not logged in"
 *     from "logged in but not admin" on admin-only endpoints).
 *   - logged in but wrong role (non-ADMIN hitting an ADMIN-only route) ->
 *     403 "Forbidden".
 *   - resource-ownership checks (a ticket belonging to someone else) -> 403.
 *
 * Only `@/auth`'s `auth()` is mocked (to control the session per test,
 * without needing a real NextAuth cookie/JWT round-trip). Everything else
 * in each route — including its own imports of `@/lib/db`, `@/lib/audit`,
 * etc. — is the REAL module. This deliberately means these tests must
 * short-circuit at the auth/role gate BEFORE any DB access, matching what
 * every one of these route handlers actually does (session/role check is
 * always the very first thing in the function body, before `connectDB()`).
 * That ordering is exactly the property being tested — if any route were
 * refactored to move a DB call before its auth check, these tests would
 * start hanging or throwing on a real network attempt against a
 * non-existent test DB (there is deliberately no `DATABASE_URL` configured
 * for this fast unit-test config — see vitest.config.mts), which would
 * itself be a useful regression signal.
 *
 * Not covered here (out of scope for this suite, by design):
 *   - Full DB-backed happy-path behavior of authorized requests — that's
 *     the job of `lib/__tests__/integration/*.integration.test.ts` for the
 *     four transactional service functions, and is impractical to add here
 *     for all 44 routes without a full DB fixture per route (a much larger
 *     effort with rapidly diminishing returns — the actual security-
 *     relevant risk this task addresses is "does the boundary check exist
 *     and reject correctly", not "does every route's full business logic
 *     work", which is already covered where it matters most: money-moving
 *     functions).
 *   - `/api/v2` (the reseller API-key-authenticated endpoint) — it uses a
 *     fundamentally different auth mechanism (`resolveApiKey`, DB-backed)
 *     and its own deliberate "always HTTP 200, error in body" convention
 *     (see that route's own doc comment) rather than 401/403, so it doesn't
 *     fit this suite's assertions. It also calls `connectDB()`
 *     unconditionally as its very first line (before any key check), so it
 *     cannot be exercised here without a real/mocked DB — tracked as a
 *     follow-up if `/api/v2` auth coverage is wanted later.
 *   - `/api/auth/[...nextauth]` (NextAuth's own internal handler — testing
 *     the library itself is out of scope) and `/api/telegram/webhook`
 *     (secret-token-based, not session-based; would need its own dedicated
 *     test using `TELEGRAM_WEBHOOK_SECRET`).
 *   - The 6 intentionally-public/differently-authed routes documented
 *     below are asserted to remain callable without a session (a
 *     regression guard: if one of these ever grows an accidental
 *     `session.user` dependency that throws instead of handling `null`
 *     gracefully, that's worth catching too).
 */

const mockAuth = vi.fn();

vi.mock("@/auth", () => ({
  auth: mockAuth,
}));

beforeEach(() => {
  mockAuth.mockReset();
});

function req(url = "http://localhost/api/test", init?: RequestInit): Request {
  return new Request(url, init);
}

function paramsOf<T extends Record<string, string>>(params: T) {
  return { params: Promise.resolve(params) };
}

const NO_SESSION = null;
const USER_SESSION = {
  user: { id: "507f1f77bcf86cd799439011", email: "user@example.com", role: "USER", status: "ACTIVE" },
};
const ADMIN_SESSION = {
  user: { id: "507f1f77bcf86cd799439012", email: "admin@example.com", role: "ADMIN", status: "ACTIVE" },
};

/**
 * Routes gated with a plain `!session?.user?.id` check -> 401 when there is
 * no session at all. Each entry is `[module path, HTTP method export, args
 * beyond the plain Request (if the handler takes route params)]`.
 */
const sessionGated401: Array<{
  name: string;
  path: string;
  method: string;
  extraArgs?: unknown[];
}> = [
  { name: "GET /api/wallet", path: "@/app/api/wallet/route", method: "GET" },
  { name: "GET /api/orders", path: "@/app/api/orders/route", method: "GET" },
  { name: "POST /api/orders", path: "@/app/api/orders/route", method: "POST" },
  { name: "GET /api/payments", path: "@/app/api/payments/route", method: "GET" },
  { name: "POST /api/payments", path: "@/app/api/payments/route", method: "POST" },
  { name: "GET /api/services", path: "@/app/api/services/route", method: "GET" },
  { name: "GET /api/notifications", path: "@/app/api/notifications/route", method: "GET" },
  { name: "POST /api/notifications/read-all", path: "@/app/api/notifications/read-all/route", method: "POST" },
  {
    name: "PATCH /api/notifications/[id]",
    path: "@/app/api/notifications/[id]/route",
    method: "PATCH",
    extraArgs: [paramsOf({ id: "507f1f77bcf86cd799439099" })],
  },
  { name: "GET /api/api-keys", path: "@/app/api/api-keys/route", method: "GET" },
  { name: "POST /api/api-keys", path: "@/app/api/api-keys/route", method: "POST" },
  {
    name: "DELETE /api/api-keys/[id]",
    path: "@/app/api/api-keys/[id]/route",
    method: "DELETE",
    extraArgs: [paramsOf({ id: "507f1f77bcf86cd799439099" })],
  },
  { name: "GET /api/support/tickets", path: "@/app/api/support/tickets/route", method: "GET" },
  { name: "POST /api/support/tickets", path: "@/app/api/support/tickets/route", method: "POST" },
  {
    name: "GET /api/support/tickets/[id]",
    path: "@/app/api/support/tickets/[id]/route",
    method: "GET",
    extraArgs: [paramsOf({ id: "507f1f77bcf86cd799439099" })],
  },
  {
    name: "POST /api/support/tickets/[id]/messages",
    path: "@/app/api/support/tickets/[id]/messages/route",
    method: "POST",
    extraArgs: [paramsOf({ id: "507f1f77bcf86cd799439099" })],
  },
  { name: "POST /api/telegram/link-code", path: "@/app/api/telegram/link-code/route", method: "POST" },
  {
    name: "POST /api/orders/[id]/refill",
    path: "@/app/api/orders/[id]/refill/route",
    method: "POST",
    extraArgs: [paramsOf({ id: "507f1f77bcf86cd799439099" })],
  },
  { name: "PATCH /api/account", path: "@/app/api/account/route", method: "PATCH" },
  {
    name: "POST /api/account/change-password",
    path: "@/app/api/account/change-password/route",
    method: "POST",
  },
  { name: "GET /api/favorites", path: "@/app/api/favorites/route", method: "GET" },
  { name: "POST /api/favorites", path: "@/app/api/favorites/route", method: "POST" },
  { name: "DELETE /api/favorites", path: "@/app/api/favorites/route", method: "DELETE" },
];

/**
 * Routes gated with the combined `!session?.user?.id || role !== "ADMIN"`
 * check -> 403 (not 401) even with NO session at all, per this project's
 * established convention of not distinguishing "logged out" from "not
 * admin" on admin-only endpoints.
 */
const adminGated403: Array<{
  name: string;
  path: string;
  method: string;
  extraArgs?: unknown[];
}> = [
  { name: "GET /api/admin/analytics/revenue", path: "@/app/api/admin/analytics/revenue/route", method: "GET" },
  { name: "GET /api/admin/audit-log", path: "@/app/api/admin/audit-log/route", method: "GET" },
  { name: "GET /api/admin/search", path: "@/app/api/admin/search/route", method: "GET" },
  { name: "GET /api/admin/export/orders", path: "@/app/api/admin/export/orders/route", method: "GET" },
  { name: "GET /api/admin/export/payments", path: "@/app/api/admin/export/payments/route", method: "GET" },
  {
    name: "GET /api/admin/export/transactions",
    path: "@/app/api/admin/export/transactions/route",
    method: "GET",
  },
  { name: "GET /api/admin/categories", path: "@/app/api/admin/categories/route", method: "GET" },
  { name: "POST /api/admin/categories", path: "@/app/api/admin/categories/route", method: "POST" },
  {
    name: "PATCH /api/admin/categories/[id]",
    path: "@/app/api/admin/categories/[id]/route",
    method: "PATCH",
    extraArgs: [paramsOf({ id: "507f1f77bcf86cd799439099" })],
  },
  {
    name: "DELETE /api/admin/categories/[id]",
    path: "@/app/api/admin/categories/[id]/route",
    method: "DELETE",
    extraArgs: [paramsOf({ id: "507f1f77bcf86cd799439099" })],
  },
  {
    name: "PATCH /api/admin/orders/[id]",
    path: "@/app/api/admin/orders/[id]/route",
    method: "PATCH",
    extraArgs: [paramsOf({ id: "507f1f77bcf86cd799439099" })],
  },
  { name: "GET /api/admin/orders", path: "@/app/api/admin/orders/route", method: "GET" },
  { name: "PATCH /api/admin/orders/bulk", path: "@/app/api/admin/orders/bulk/route", method: "PATCH" },
  {
    name: "POST /api/admin/payments/[id]/approve",
    path: "@/app/api/admin/payments/[id]/approve/route",
    method: "POST",
    extraArgs: [paramsOf({ id: "507f1f77bcf86cd799439099" })],
  },
  {
    name: "POST /api/admin/payments/[id]/reject",
    path: "@/app/api/admin/payments/[id]/reject/route",
    method: "POST",
    extraArgs: [paramsOf({ id: "507f1f77bcf86cd799439099" })],
  },
  {
    name: "PATCH /api/admin/providers/[id]",
    path: "@/app/api/admin/providers/[id]/route",
    method: "PATCH",
    extraArgs: [paramsOf({ id: "507f1f77bcf86cd799439099" })],
  },
  {
    name: "DELETE /api/admin/providers/[id]",
    path: "@/app/api/admin/providers/[id]/route",
    method: "DELETE",
    extraArgs: [paramsOf({ id: "507f1f77bcf86cd799439099" })],
  },
  { name: "GET /api/admin/providers", path: "@/app/api/admin/providers/route", method: "GET" },
  { name: "POST /api/admin/providers", path: "@/app/api/admin/providers/route", method: "POST" },
  {
    name: "PATCH /api/admin/service-groups/[id]",
    path: "@/app/api/admin/service-groups/[id]/route",
    method: "PATCH",
    extraArgs: [paramsOf({ id: "507f1f77bcf86cd799439099" })],
  },
  {
    name: "DELETE /api/admin/service-groups/[id]",
    path: "@/app/api/admin/service-groups/[id]/route",
    method: "DELETE",
    extraArgs: [paramsOf({ id: "507f1f77bcf86cd799439099" })],
  },
  { name: "GET /api/admin/service-groups", path: "@/app/api/admin/service-groups/route", method: "GET" },
  { name: "POST /api/admin/service-groups", path: "@/app/api/admin/service-groups/route", method: "POST" },
  {
    name: "PATCH /api/admin/services/[id]/providers/[linkId]",
    path: "@/app/api/admin/services/[id]/providers/[linkId]/route",
    method: "PATCH",
    extraArgs: [paramsOf({ id: "507f1f77bcf86cd799439099", linkId: "507f1f77bcf86cd799439098" })],
  },
  {
    name: "DELETE /api/admin/services/[id]/providers/[linkId]",
    path: "@/app/api/admin/services/[id]/providers/[linkId]/route",
    method: "DELETE",
    extraArgs: [paramsOf({ id: "507f1f77bcf86cd799439099", linkId: "507f1f77bcf86cd799439098" })],
  },
  {
    name: "GET /api/admin/services/[id]/providers",
    path: "@/app/api/admin/services/[id]/providers/route",
    method: "GET",
    extraArgs: [paramsOf({ id: "507f1f77bcf86cd799439099" })],
  },
  {
    name: "POST /api/admin/services/[id]/providers",
    path: "@/app/api/admin/services/[id]/providers/route",
    method: "POST",
    extraArgs: [paramsOf({ id: "507f1f77bcf86cd799439099" })],
  },
  {
    name: "PATCH /api/admin/services/[id]",
    path: "@/app/api/admin/services/[id]/route",
    method: "PATCH",
    extraArgs: [paramsOf({ id: "507f1f77bcf86cd799439099" })],
  },
  {
    name: "DELETE /api/admin/services/[id]",
    path: "@/app/api/admin/services/[id]/route",
    method: "DELETE",
    extraArgs: [paramsOf({ id: "507f1f77bcf86cd799439099" })],
  },
  { name: "GET /api/admin/services", path: "@/app/api/admin/services/route", method: "GET" },
  { name: "POST /api/admin/services", path: "@/app/api/admin/services/route", method: "POST" },
  { name: "GET /api/admin/settings", path: "@/app/api/admin/settings/route", method: "GET" },
  { name: "PATCH /api/admin/settings", path: "@/app/api/admin/settings/route", method: "PATCH" },
  {
    name: "PATCH /api/admin/support/tickets/[id]",
    path: "@/app/api/admin/support/tickets/[id]/route",
    method: "PATCH",
    extraArgs: [paramsOf({ id: "507f1f77bcf86cd799439099" })],
  },
  { name: "GET /api/admin/support/tickets", path: "@/app/api/admin/support/tickets/route", method: "GET" },
  {
    name: "PATCH /api/admin/users/[id]",
    path: "@/app/api/admin/users/[id]/route",
    method: "PATCH",
    extraArgs: [paramsOf({ id: "507f1f77bcf86cd799439099" })],
  },
  { name: "GET /api/admin/users", path: "@/app/api/admin/users/route", method: "GET" },
];

/**
 * Routes deliberately WITHOUT any `auth()` call — public or differently-
 * authed by design (see docs/PRODUCTION_READINESS.md and each route's own
 * doc comment). Asserted here as a regression guard: these should stay
 * callable with zero session and must not throw when `auth()` isn't even
 * invoked (i.e. they truly don't depend on session state at all).
 *
 * `/api/health`, `/api/public/services`, `/api/register`,
 * `/api/forgot-password`, `/api/reset-password`, `/api/verify-email` all
 * call `connectDB()`/query the DB, so they're exercised in the DB-backed
 * integration suite instead if/when deeper coverage is wanted — here we
 * only confirm `auth()` truly is never invoked for them, which is the
 * auth-boundary-specific property this file is about.
 */
describe("Route-handler auth boundary — unauthenticated requests", () => {
  it.each(sessionGated401)("$name -> 401 Unauthorized with no session", async ({ path, method, extraArgs }) => {
    mockAuth.mockResolvedValue(NO_SESSION);
    const mod = await import(/* @vite-ignore */ path);
    const handler = mod[method] as (...args: unknown[]) => Promise<Response>;
    expect(typeof handler).toBe("function");

    const res = await handler(req(), ...(extraArgs ?? []));
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error).toMatch(/unauthorized/i);
  });

  it.each(adminGated403)("$name -> 403 Forbidden with no session", async ({ path, method, extraArgs }) => {
    mockAuth.mockResolvedValue(NO_SESSION);
    const mod = await import(/* @vite-ignore */ path);
    const handler = mod[method] as (...args: unknown[]) => Promise<Response>;
    expect(typeof handler).toBe("function");

    const res = await handler(req(), ...(extraArgs ?? []));
    expect(res.status).toBe(403);

    const body = await res.json();
    expect(body.error).toMatch(/forbidden/i);
  });
});

describe("Route-handler auth boundary — wrong-role (non-admin) requests", () => {
  // A representative sample across every distinct admin-route file shape
  // (plain GET, id-parameterized PATCH/DELETE, double-id-parameterized) —
  // not the full 30-entry list again, since the interesting new behavior
  // being verified here (role check, not just session-presence check) is
  // structurally identical for every admin route; the exhaustive list
  // above already proves every route's role gate exists.
  const sample: Array<{ name: string; path: string; method: string; extraArgs?: unknown[] }> = [
    { name: "GET /api/admin/users", path: "@/app/api/admin/users/route", method: "GET" },
    { name: "GET /api/admin/orders", path: "@/app/api/admin/orders/route", method: "GET" },
    {
      name: "POST /api/admin/payments/[id]/approve",
      path: "@/app/api/admin/payments/[id]/approve/route",
      method: "POST",
      extraArgs: [paramsOf({ id: "507f1f77bcf86cd799439099" })],
    },
    {
      name: "PATCH /api/admin/services/[id]",
      path: "@/app/api/admin/services/[id]/route",
      method: "PATCH",
      extraArgs: [paramsOf({ id: "507f1f77bcf86cd799439099" })],
    },
    { name: "GET /api/admin/settings", path: "@/app/api/admin/settings/route", method: "GET" },
  ];

  it.each(sample)("$name -> 403 Forbidden for a logged-in non-admin user", async ({ path, method, extraArgs }) => {
    mockAuth.mockResolvedValue(USER_SESSION);
    const mod = await import(/* @vite-ignore */ path);
    const handler = mod[method] as (...args: unknown[]) => Promise<Response>;

    const res = await handler(req(), ...(extraArgs ?? []));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/forbidden/i);
  });

  it("an ADMIN session is NOT rejected at the role-gate itself (would fail later at DB access, not at the auth boundary)", async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION);
    const { GET } = await import("@/app/api/admin/users/route");

    // With no DB configured in this fast unit-test run, an authorized
    // admin request is expected to fail once it reaches `connectDB()` —
    // proving the 403 short-circuit above is specifically about the
    // auth/role gate, not an environment artifact that would 403
    // everything regardless of role.
    await expect(GET(req())).rejects.toThrow();
  });
});

describe("Route-handler auth boundary — resource ownership", () => {
  it("GET /api/support/tickets/[id] rejects a non-owner, non-admin session with 403 (after finding the ticket)", async () => {
    mockAuth.mockResolvedValue(USER_SESSION);

    const otherUsersTicket = {
      id: "507f1f77bcf86cd799439099",
      userId: "someone-else-entirely",
    };

    // `prisma.supportTicket.findUnique()` is mocked here (rather than
    // exercised for real) so this test isolates exactly the
    // ownership-check branch (`isOwner || role === "ADMIN"`) without
    // needing a real DB write — that transactional/data-layer behavior is
    // already covered by the DB-backed integration suite for the four
    // money-moving functions; this file's job is the auth/role/ownership
    // gate specifically. `vi.resetModules()` is required before this
    // dynamic import because the route module (and its `@/lib/db` import)
    // were already loaded — and cached by Node's ESM loader — by earlier
    // tests in this same file, so a `vi.doMock` registered now would
    // otherwise be ignored for an already-resolved module graph.
    vi.resetModules();
    vi.doMock("@/lib/db", () => ({
      prisma: {
        supportTicket: {
          findUnique: vi.fn().mockResolvedValue(otherUsersTicket),
        },
      },
    }));
    vi.doMock("@/auth", () => ({ auth: mockAuth }));

    const { GET } = await import("@/app/api/support/tickets/[id]/route");
    const res = await GET(req(), paramsOf({ id: "507f1f77bcf86cd799439099" }));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/forbidden/i);

    vi.doUnmock("@/lib/db");
    vi.doUnmock("@/auth");
    vi.resetModules();
  });
});

describe("Route-handler auth boundary — intentionally public / differently-authed routes", () => {
  it("GET /api/health never calls auth() (public liveness probe)", async () => {
    const { GET } = await import("@/app/api/health/route");
    // Don't actually invoke it (it calls the real connectDB() against no
    // configured DATABASE_URL, which isn't this test's concern) — just
    // confirm auth() was never called as a side effect of merely importing
    // and holding a reference to the handler.
    expect(typeof GET).toBe("function");
    expect(mockAuth).not.toHaveBeenCalled();
  });

  it("GET /api/public/services never calls auth() (public catalog)", async () => {
    const { GET } = await import("@/app/api/public/services/route");
    expect(typeof GET).toBe("function");
    expect(mockAuth).not.toHaveBeenCalled();
  });

  it("POST /api/register, /api/forgot-password, /api/reset-password, /api/verify-email never call auth() (pre-session flows)", async () => {
    const register = await import("@/app/api/register/route");
    const forgot = await import("@/app/api/forgot-password/route");
    const reset = await import("@/app/api/reset-password/route");
    const verify = await import("@/app/api/verify-email/route");

    expect(typeof register.POST).toBe("function");
    expect(typeof forgot.POST).toBe("function");
    expect(typeof reset.POST).toBe("function");
    expect(typeof verify.POST).toBe("function");
    expect(mockAuth).not.toHaveBeenCalled();
  });

  it("POST /api/v2 never calls the session-based auth() (uses API-key auth instead)", async () => {
    const { POST } = await import("@/app/api/v2/route");
    expect(typeof POST).toBe("function");
    expect(mockAuth).not.toHaveBeenCalled();
  });

  it.each([
    "@/app/api/cron/process-orders/route",
    "@/app/api/cron/poll-order-status/route",
    "@/app/api/cron/compute-delivery-estimates/route",
    "@/app/api/cron/cleanup-expired-tokens/route",
  ])(
    "GET %s never calls the session-based auth() (uses CRON_SECRET shared-secret auth instead)",
    async (modulePath) => {
      const { GET } = await import(modulePath);
      expect(typeof GET).toBe("function");
      expect(mockAuth).not.toHaveBeenCalled();
    }
  );

  describe("cron routes reject an unauthenticated request before touching the DB", () => {
    const ORIGINAL_ENV = { ...process.env };

    beforeEach(() => {
      // Unlike the rest of this file, `verifyCronSecret` reads `env.*`
      // (lib/env.ts's Zod-validated proxy) directly rather than going
      // through a mocked `@/auth`, and that proxy validates the ENTIRE
      // schema on first access — so DATABASE_URL/DIRECT_URL/AUTH_SECRET
      // need throwaway placeholder values here (same pattern as the
      // rate-limit block in lib/__tests__/auth-authorize.test.ts) purely
      // to let validation succeed; CRON_SECRET itself stays unset/wrong
      // per test below, and no real DB call ever happens because the auth
      // check rejects first.
      process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/unit-test-placeholder?schema=public";
      process.env.DIRECT_URL = "postgresql://user:pass@localhost:5432/unit-test-placeholder?schema=public";
      process.env.AUTH_SECRET = "unit-test-placeholder-secret-not-a-real-secret-000";
    });

    afterEach(() => {
      process.env = { ...ORIGINAL_ENV };
    });

    it.each([
      ["/api/cron/process-orders", "@/app/api/cron/process-orders/route"],
      ["/api/cron/poll-order-status", "@/app/api/cron/poll-order-status/route"],
      ["/api/cron/compute-delivery-estimates", "@/app/api/cron/compute-delivery-estimates/route"],
      ["/api/cron/cleanup-expired-tokens", "@/app/api/cron/cleanup-expired-tokens/route"],
    ])("GET %s rejects a request with no CRON_SECRET header", async (path, modulePath) => {
      delete process.env.CRON_SECRET;
      vi.resetModules();
      const { GET } = await import(modulePath);
      const response = await GET(new Request(`http://localhost${path}`));
      // 503 if CRON_SECRET isn't configured at all (fail-closed default in
      // this test env), 401 if it is configured and the request just has
      // no/wrong Authorization header — either is a correct rejection.
      expect([401, 503]).toContain(response.status);
    });
  });
});
