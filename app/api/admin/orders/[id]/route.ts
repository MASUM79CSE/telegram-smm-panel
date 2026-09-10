import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/auth";
import { connectDB } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { notifyOrderStatusChanged } from "@/lib/telegram/notify";
import { createNotification } from "@/lib/services/notifications";
import { refundOrder, changeOrderStatus } from "@/lib/services/admin-orders";
import { resolveManualRefill } from "@/lib/services/refill";
import { AppError } from "@/lib/errors";
import { requestLogger } from "@/lib/logger";

const updateSchema = z.object({
  status: z
    .enum(["PENDING", "PROCESSING", "IN_PROGRESS", "COMPLETED", "PARTIAL", "CANCELED", "FAILED", "REFUNDED"])
    .optional(),
  refillResolution: z.enum(["COMPLETED", "REJECTED"]).optional(),
  note: z.string().max(500).optional(),
});

const errorStatusMap: Record<string, number> = {
  NOT_FOUND: 404,
  ALREADY_REFUNDED_OR_NOT_FOUND: 409,
  WALLET_NOT_FOUND: 404,
  CONCURRENT_MODIFICATION: 409,
  REFILL_NOT_PENDING: 409,
};

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const log = requestLogger(request);
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await connectDB();
  const { id } = await params;

  const body = await request.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success || (!parsed.data.status && !parsed.data.refillResolution)) {
    return NextResponse.json({ error: "Invalid data" }, { status: 400 });
  }

  const { status, refillResolution, note } = parsed.data;

  try {
    if (refillResolution) {
      const order = await resolveManualRefill(id, refillResolution, note);

      await recordAudit({
        actorId: session.user.id,
        actorEmail: session.user.email,
        action: "ORDER_REFILL_RESOLVED",
        targetType: "Order",
        targetId: id,
        metadata: { resolution: refillResolution },
        request,
      });

      createNotification({
        userId: order.userId.toString(),
        type: "ORDER_REFILL_RESOLVED",
        title: refillResolution === "COMPLETED" ? "Refill fulfilled" : "Refill declined",
        body:
          refillResolution === "COMPLETED"
            ? "Your refill request has been fulfilled."
            : "Your refill request was declined.",
        href: "/dashboard/orders",
      }).catch((err) => log.error({ err }, "Refill-resolved in-app notification error"));

      return NextResponse.json({ message: "Refill request resolved.", order });
    }

    if (status === "REFUNDED") {
      const order = await refundOrder(id, note);

      await recordAudit({
        actorId: session.user.id,
        actorEmail: session.user.email,
        action: "ORDER_REFUNDED",
        targetType: "Order",
        targetId: id,
        request,
      });

      notifyOrderStatusChanged(order.userId.toString(), id, "REFUNDED", note).catch((err) =>
        log.error({ err }, "Order-refund notification error")
      );
      createNotification({
        userId: order.userId.toString(),
        type: "ORDER_STATUS_CHANGED",
        title: "Order refunded",
        body: `Your order has been refunded and the charge credited back to your wallet.${note ? ` ${note}` : ""}`,
        href: "/dashboard/orders",
      }).catch((err) => log.error({ err }, "Order-refund in-app notification error"));

      return NextResponse.json({ message: "Order refunded and wallet credited.", order });
    }

    if (!status) {
      return NextResponse.json({ error: "Invalid data" }, { status: 400 });
    }

    const order = await changeOrderStatus(id, status, note);

    await recordAudit({
      actorId: session.user.id,
      actorEmail: session.user.email,
      action: "ORDER_STATUS_CHANGE",
      targetType: "Order",
      targetId: id,
      metadata: { newStatus: status },
      request,
    });

    notifyOrderStatusChanged(order.userId.toString(), id, status, note).catch((err) =>
      log.error({ err }, "Order-status notification error")
    );
    createNotification({
      userId: order.userId.toString(),
      type: "ORDER_STATUS_CHANGED",
      title: "Order status updated",
      body: `Your order is now ${status.replace(/_/g, " ").toLowerCase()}.${note ? ` ${note}` : ""}`,
      href: "/dashboard/orders",
    }).catch((err) => log.error({ err }, "Order-status in-app notification error"));

    return NextResponse.json({ message: "Order updated", order });
  } catch (error) {
    if (error instanceof AppError) {
      const httpStatus = errorStatusMap[error.code] ?? 400;
      return NextResponse.json({ error: error.message }, { status: httpStatus });
    }

    log.error({ err: error }, "Order update error");
    return NextResponse.json({ error: "Failed to update order" }, { status: 500 });
  }
}
