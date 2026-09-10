import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { connectDB } from "@/lib/db";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { requestRefill } from "@/lib/services/refill";
import { recordAudit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { requestLogger } from "@/lib/logger";

/**
 * Customer self-service refill request (docs/IMPLEMENTATION_PLAN.md Phase
 * 3.1). Session-authenticated, scoped to the caller's own order (enforced
 * inside `requestRefill` via `{_id, userId}`, not trusted from the URL
 * alone).
 */
const errorStatusMap: Record<string, number> = {
  NOT_FOUND: 404,
  REFILL_NOT_SUPPORTED: 400,
  ORDER_NOT_COMPLETED: 400,
  REFILL_ALREADY_REQUESTED: 409,
  REFILL_WINDOW_EXPIRED: 400,
  REFILL_PROVIDER_ERROR: 502,
};

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ip = getClientIp(request);
  const { success } = await rateLimit("orderRefill", `${session.user.id}:${ip}`);
  if (!success) {
    return NextResponse.json({ error: "Too many refill requests. Please slow down." }, { status: 429 });
  }

  await connectDB();
  const { id } = await params;

  const log = requestLogger(request);
  try {
    const order = await requestRefill(id, session.user.id);

    await recordAudit({
      actorId: session.user.id,
      actorEmail: session.user.email,
      action: "ORDER_REFILL_REQUESTED",
      targetType: "Order",
      targetId: id,
      request,
    });

    return NextResponse.json({ message: "Refill requested.", order });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.message }, { status: errorStatusMap[error.code] ?? 400 });
    }

    log.error({ err: error }, "Order refill error");
    return NextResponse.json({ error: "Failed to request refill" }, { status: 500 });
  }
}
