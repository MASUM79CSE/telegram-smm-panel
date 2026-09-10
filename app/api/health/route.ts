import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { requestLogger } from "@/lib/logger";

/**
 * Liveness/readiness probe for load balancers, container orchestrators
 * (Docker/Kubernetes), and uptime monitors.
 *
 * - Returns 200 with `"status": "ok"` when the process is up AND the
 *   database connection is healthy (readyState === 1).
 * - Returns 503 when the database is unreachable, so orchestrators can stop
 *   routing traffic to this instance / restart it instead of serving 500s
 *   for every request.
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
    await connectDB();

    const dbState = mongoose.connection.readyState; // 1 === connected
    const dbOk = dbState === 1;

    if (!dbOk) {
      return NextResponse.json(
        { status: "error", checkedAt, db: { connected: false, readyState: dbState } },
        { status: 503 }
      );
    }

    return NextResponse.json({
      status: "ok",
      checkedAt,
      db: { connected: true, readyState: dbState },
      uptimeSeconds: Math.round(process.uptime()),
    });
  } catch (error) {
    log.error({ err: error }, "Health check failed");
    return NextResponse.json(
      { status: "error", checkedAt, error: "Database connection failed" },
      { status: 503 }
    );
  }
}
