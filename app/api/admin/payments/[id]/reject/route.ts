import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/auth";
import { connectDB } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { notifyUserDepositReviewed } from "@/lib/telegram/notify";
import { createNotification } from "@/lib/services/notifications";
import { formatMoney } from "@/lib/money";
import { rejectDeposit } from "@/lib/services/admin-payments";
import { AppError } from "@/lib/errors";
import { requestLogger } from "@/lib/logger";

const schema = z.object({ reason: z.string().trim().max(500).optional() });

export async function POST(
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
  const body = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  const reason = parsed.success ? parsed.data.reason ?? null : null;

  let payment;
  try {
    payment = await rejectDeposit(id, session.user.id, reason);
  } catch (error) {
    if (error instanceof AppError) {
      const status = error.code === "NOT_FOUND" ? 404 : 409;
      return NextResponse.json({ error: error.message }, { status });
    }
    log.error({ err: error }, "Payment rejection error");
    return NextResponse.json({ error: "Failed to reject payment" }, { status: 500 });
  }

  await recordAudit({
    actorId: session.user.id,
    actorEmail: session.user.email,
    action: "PAYMENT_REJECTED",
    targetType: "Payment",
    targetId: id,
    request,
  });

  notifyUserDepositReviewed(
    payment.userId.toString(),
    false,
    formatMoney(payment.amount, payment.currency),
    reason
  ).catch((err) => log.error({ err }, "Deposit-rejected notification error"));

  createNotification({
    userId: payment.userId.toString(),
    type: "DEPOSIT_REJECTED",
    title: "Deposit rejected",
    body: reason
      ? `Your deposit of ${formatMoney(payment.amount, payment.currency)} was rejected: ${reason}`
      : `Your deposit of ${formatMoney(payment.amount, payment.currency)} was rejected.`,
    href: "/dashboard/wallet",
  }).catch((err) => log.error({ err }, "Deposit-rejected in-app notification error"));

  return NextResponse.json({ message: "Payment rejected." });
}
