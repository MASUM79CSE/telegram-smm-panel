import { PrismaClient } from "@/lib/generated/prisma";
import { env } from "@/lib/env";

/**
 * Centralized Prisma client, cached across hot-reloads (dev) and
 * serverless invocations (prod) to avoid exhausting Supabase/Postgres
 * connection limits — same rationale as the original Mongoose connection
 * cache in this file (see git history), just for a different driver.
 *
 * IMPORTANT (Supabase specifically): `DATABASE_URL` MUST be the *pooled*
 * "Transaction" connection string (port 6543, `?pgbouncer=true`), not the
 * direct one (port 5432). Serverless functions open a fresh connection per
 * invocation; without PgBouncer pooling in front, a moderate amount of
 * concurrent traffic will exhaust Supabase's direct connection limit almost
 * immediately. `DIRECT_URL` (the non-pooled, direct connection) is used
 * only by `prisma migrate`/`prisma db push` at deploy/build time, which
 * needs a real session for DDL and Prisma's own advisory locks — see
 * `prisma/schema.prisma`'s `datasource` block and docs/DATABASE.md.
 *
 * Lazily constructed (via a `Proxy`, same pattern `lib/env.ts` already uses
 * for its own `env` export) rather than built at module-import time: the
 * original Mongoose `connectDB()` never touched the network — or validated
 * any env var — just by being imported; only an actual call opened a
 * connection. Building a real `PrismaClient` eagerly at import time breaks
 * that same property (confirmed: it forces `lib/env.ts`'s full Zod schema
 * validation the moment ANY file that imports `@/lib/db` is loaded, even
 * one that never ends up querying the database — e.g. an API route that
 * short-circuits on an auth/role check before ever touching `prisma`).
 * Deferring both the client construction AND the `env` read until the
 * first actual property access keeps `import { prisma } from "@/lib/db"`
 * a side-effect-free, always-safe statement, exactly as before.
 */
declare global {
  var __prismaClient: PrismaClient | undefined;
}

function createClient(): PrismaClient {
  return new PrismaClient({
    log: env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

function getClient(): PrismaClient {
  // Cache across hot-reloads in dev; a fresh client per cold start in
  // production serverless invocations is fine/expected (mirrors the
  // original eager-construction behavior — see file header — just
  // evaluated lazily now, on first actual use instead of at import time).
  if (!global.__prismaClient) {
    global.__prismaClient = createClient();
  }
  return global.__prismaClient;
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop: keyof PrismaClient) {
    const client = getClient();
    const value = client[prop];
    // Methods like `$transaction`/`$connect` are real instance methods that
    // rely on their own `this` — returned bare through this Proxy's `get`
    // trap, a call site like `prisma.$transaction(...)` would invoke them
    // with `this` bound to the Proxy's (empty) target instead of the real
    // client, immediately throwing. Model delegates (`prisma.user`, etc.)
    // are plain objects, not functions, so they pass through untouched and
    // keep working exactly as direct property access would.
    return typeof value === "function" ? value.bind(client) : value;
  },
});

/**
 * Historical name kept for a smooth migration — every call site that used
 * to `await connectDB()` before running a Mongoose query still works
 * unchanged. Prisma manages its own connection pool lazily/internally (no
 * explicit "connect" step is actually required before the first query),
 * but this keeps the function as an explicit, awaitable readiness check
 * callers can rely on — e.g. `GET /api/health` calls this to verify the
 * database is actually reachable, not just configured.
 */
export async function connectDB(): Promise<PrismaClient> {
  const client = getClient();
  await client.$connect();
  return client;
}

export default connectDB;
