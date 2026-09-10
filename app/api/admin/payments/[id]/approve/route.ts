import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { connectDB } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { recordAudit } from "@/lib/audit";
import { notifyUserDepositReviewed } from "@/lib/telegram/notify";
import { createNotification } from "@/lib/services/notifications";
import { approveDeposit } from "@/lib/services/admin-payments";
import { AppError } from "@/lib/errors";
import { requestLogger } from "@/lib/logger";

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

  let updatedPayment;
  try {
    updatedPayment = await approveDeposit(id, session.user.id);
  } catch (error) {
    if (error instanceof AppError) {
      const statusByCode: Record<string, number> = {
        NOT_FOUND: 404,
        ALREADY_PROCESSED: 409,
        WALLET_NOT_FOUND: 404,
        CONCURRENT_MODIFICATION: 409,
      };
      return NextResponse.json({ error: error.message }, { status: statusByCode[error.code] ?? 400 });
    }

    log.error({ err: error }, "Payment approval error");
    return NextResponse.json({ error: "Failed to approve payment" }, { status: 500 });
  }

  await recordAudit({
    actorId: session.user.id,
    actorEmail: session.user.email,
    action: "PAYMENT_APPROVED",
    targetType: "Payment",
    targetId: id,
    request,
  });

  notifyUserDepositReviewed(
    updatedPayment.userId.toString(),
    true,
    formatMoney(updatedPayment.amount, updatedPayment.currency)
  ).catch((err) => log.error({ err }, "Deposit-approved notification error"));

  createNotification({
    userId: updatedPayment.userId.toString(),
    type: "DEPOSIT_APPROVED",
    title: "Deposit approved",
    body: `Your deposit of ${formatMoney(updatedPayment.amount, updatedPayment.currency)} has been approved.`,
    href: "/dashboard/wallet",
  }).catch((err) => log.error({ err }, "Deposit-approved in-app notification error"));

  return NextResponse.json({ message: "Payment approved and wallet credited.", payment: updatedPayment });
}
