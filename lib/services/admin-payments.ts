import { prisma } from "@/lib/db";
import { addMoney, toDecimal128 } from "@/lib/money";
import { AppError } from "@/lib/errors";
import type { Payment } from "@/lib/generated/prisma";

/**
 * Shared deposit-approval logic used by both the admin website
 * (`app/api/admin/payments/[id]/approve/route.ts`) and the Telegram bot's
 * admin inline "Approve" button, so the money-crediting transaction exists
 * exactly once.
 *
 * Postgres/Prisma migration note: reproduces the same two-stage atomic-claim
 * pattern as the original MongoDB version (see git history) —
 * `updateMany({ where: { id, status: "PENDING" }, ... })` is the direct
 * translation of the original `Payment.updateOne({ _id, status: "PENDING" },
 * ...)` conditional claim: only one concurrent request can ever flip a
 * PENDING payment to COMPLETED, because a second simultaneous call's
 * `updateMany` will match zero rows (the first call's transaction has
 * already committed the status change by the time it runs, or — inside the
 * same transaction on Postgres with default READ COMMITTED isolation — will
 * block until the first transaction commits, then see zero matching rows).
 * The whole thing runs inside `prisma.$transaction` exactly as it did inside
 * `mongoSession.withTransaction()` before, so a failure at any step (e.g.
 * wallet not found, concurrent wallet-version conflict) rolls back the
 * claim too — never a state where a payment is marked COMPLETED but the
 * wallet was never actually credited.
 */
export async function approveDeposit(paymentId: string, reviewerId: string): Promise<Payment> {
  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new AppError("NOT_FOUND", "Payment not found.");

    const reviewedAt = new Date();

    // Atomic claim: only one concurrent request can transition PENDING -> COMPLETED.
    const claim = await tx.payment.updateMany({
      where: { id: paymentId, status: "PENDING" },
      data: { status: "COMPLETED", reviewedBy: reviewerId, reviewedAt },
    });

    if (claim.count !== 1) {
      throw new AppError("ALREADY_PROCESSED", "This payment has already been processed.");
    }

    const wallet = await tx.wallet.findUnique({ where: { userId: payment.userId } });
    if (!wallet) throw new AppError("WALLET_NOT_FOUND", "User wallet not found.");

    const amount = toDecimal128(payment.amount.toString());
    const balanceBefore = wallet.balance;
    const balanceAfter = addMoney(wallet.balance, amount);

    const walletUpdate = await tx.wallet.updateMany({
      where: { id: wallet.id, version: wallet.version },
      data: { balance: balanceAfter, version: { increment: 1 } },
    });

    if (walletUpdate.count !== 1) {
      throw new AppError("CONCURRENT_MODIFICATION", "Please try again — a concurrent update occurred.");
    }

    await tx.transaction.create({
      data: {
        userId: payment.userId,
        walletId: wallet.id,
        type: "DEPOSIT",
        status: "COMPLETED",
        amount,
        balanceBefore,
        balanceAfter,
        description: `Deposit approved: ${payment.transactionRef ?? payment.id}`,
        relatedPaymentId: payment.id,
        idempotencyKey: `payment-approval:${payment.id}`,
      },
    });

    // Unlike the original Mongoose version, no stale-in-memory-document
    // pitfall exists here to guard against: `payment` above was read
    // before the claim ran, so return the values we know were just
    // persisted directly rather than a second round-trip read.
    return { ...payment, status: "COMPLETED" as const, reviewedBy: reviewerId, reviewedAt };
  });
}

export async function rejectDeposit(paymentId: string, reviewerId: string, reason?: string | null): Promise<Payment> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) throw new AppError("NOT_FOUND", "Payment not found.");

  const reviewedAt = new Date();

  const result = await prisma.payment.updateMany({
    where: { id: paymentId, status: "PENDING" },
    data: {
      status: "REJECTED",
      reviewedBy: reviewerId,
      reviewedAt,
      rejectionReason: reason ?? null,
    },
  });

  if (result.count === 0) {
    throw new AppError("ALREADY_PROCESSED", "This payment has already been processed.");
  }

  return {
    ...payment,
    status: "REJECTED" as const,
    reviewedBy: reviewerId,
    reviewedAt,
    rejectionReason: reason ?? null,
  };
}
