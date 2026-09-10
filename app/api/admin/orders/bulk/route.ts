import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/auth";
import { connectDB } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { bulkChangeOrderStatus } from "@/lib/services/admin-bulk";
import { AppError } from "@/lib/errors";
import { requestLogger } from "@/lib/logger";

/**
 * Bulk order-status update (docs/DASHBOARD_UPGRADE_PLAN.md §2.3).
 *
 * Deliberately restricted to the two statuses that carry no money-movement
 * or ledger-anchoring side effects — see lib/services/admin-bulk.ts's doc
 * comment. The `status` enum below is the first of two independent
 * enforcement layers (schema + service-layer `isBulkSafeOrderStatus`); a
 * request for "REFUNDED"/"COMPLETED"/any other status is rejected here
 * with 400 before `bulkChangeOrderStatus` is even called.
 */
const bulkSchema = z.object({
  orderIds: z.array(z.string().min(1)).min(1).max(100),
  status: z.enum(["CANCELED", "FAILED"]),
  note: z.string().max(500).optional(),
});

const errorStatusMap: Record<string, number> = {
  NO_ORDER_IDS: 400,
  TOO_MANY_IDS: 400,
  STATUS_NOT_BULK_SAFE: 400,
};

export async function PATCH(request: Request) {
  const log = requestLogger(request);
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await connectDB();

  const body = await request.json().catch(() => null);
  const parsed = bulkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid data" }, { status: 400 });
  }

  const { orderIds, status, note } = parsed.data;

  let result;
  try {
    result = await bulkChangeOrderStatus(orderIds, status, note ?? null);
  } catch (error) {
    if (error instanceof AppError) {
      const httpStatus = errorStatusMap[error.code] ?? 409;
      return NextResponse.json({ error: error.message }, { status: httpStatus });
    }
    log.error({ err: error }, "Bulk order status change error");
    return NextResponse.json({ error: "Failed to update orders" }, { status: 500 });
  }

  await recordAudit({
    actorId: session.user.id,
    actorEmail: session.user.email,
    action: "ORDER_BULK_STATUS_CHANGE",
    targetType: "Order",
    metadata: { orderIds, status, note: note ?? null, succeeded: result.succeeded, failed: result.failed },
    request,
  });

  return NextResponse.json({
    message: `${result.succeeded.length} order(s) updated${result.failed.length ? `, ${result.failed.length} failed` : ""}.`,
    succeeded: result.succeeded,
    failed: result.failed,
  });
}
