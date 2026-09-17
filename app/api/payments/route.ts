import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { paymentSchema } from "@/lib/validation";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { submitDeposit } from "@/lib/services/payments";
import { AppError } from "@/lib/errors";
import { notifyAdminNewDeposit } from "@/lib/telegram/notify";
import { notifyAllAdmins } from "@/lib/services/notifications";
import { requestLogger } from "@/lib/logger";

export async function GET(request: Request) {
  const log = requestLogger(request);
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));

    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where: { userId: session.user.id },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.payment.count({ where: { userId: session.user.id } }),
    ]);

    return NextResponse.json({ payments, total, page, limit });
  } catch (error) {
    log.error({ err: error }, "Payments fetch error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const log = requestLogger(request);
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const ip = getClientIp(request);
    const { success } = await rateLimit("paymentSubmit", `${session.user.id}:${ip}`);
    if (!success) {
      return NextResponse.json({ error: "Too many payment submissions. Please try again later." }, { status: 429 });
    }

    const body = await request.json();
    const parsed = paymentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payment information", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { amount, method, transactionRef } = parsed.data;

    const payment = await submitDeposit({ userId: session.user.id, amount, method, transactionRef });

    notifyAdminNewDeposit(payment).catch((err) => log.error({ err }, "Deposit notification error"));
    notifyAllAdmins({
      type: "NEW_DEPOSIT",
      title: "New deposit request",
      body: `A deposit of ${amount} via ${method} is awaiting review.`,
      href: "/admin/payments",
    }).catch((err) => log.error({ err }, "Admin deposit notification error"));

    return NextResponse.json(
      { message: "Payment request submitted. It will be reviewed shortly.", payment },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof AppError) {
      const status = error.code === "DUPLICATE_REFERENCE" ? 409 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }

    log.error({ err: error }, "Payment submission error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
