import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requestLogger } from "@/lib/logger";

/**
 * Liveness/readiness probe for load balancers, container orchestrators
 * (Docker/Kubernetes), and uptime monitors.
 *
 * - Returns 200 with `"status": "ok"` when the process is up AND a real
 *   round-trip query against Postgres succeeds.
 * - Returns 503 when the database is unreachable, so orchestrators can stop
 *   routing traffic to this instance / restart it instead of serving 500s
 *   for every request.
 *
 * Postgres/Prisma migration note: the original Mongoose version read
 * `mongoose.connection.readyState` — a cached in-process flag that could be
 * stale/misleading (e.g. still "connected" for a few seconds after the
 * network actually dropped). `prisma.$queryRaw` is used instead so this
 * probe always reflects the database's ACTUAL current reachability, not a
 * locally cached connection-state variable.
 *
 * Intentionally unauthenticated and lightweight (no writes, no heavy
 * queries) — do not add business logic here. Not rate-limited by design;
 * exclude this path at the reverse-proxy/WAF level if abuse is a concern.
 */
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(request: Request) {
  const log = requestLogger(request);
  const checkedAt = new Date().toISOString();

  try {
    await prisma.$queryRaw`SELECT 1`;

    return NextResponse.json({
      status: "ok",
      checkedAt,
      db: { connected: true },
      uptimeSeconds: Math.round(process.uptime()),
    });
  } catch (error) {
    log.error({ err: error }, "Health check failed");
    return NextResponse.json(
      { status: "error", checkedAt, db: { connected: false }, error: "Database connection failed" },
      { status: 503 }
    );
  }
}
