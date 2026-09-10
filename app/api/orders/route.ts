import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { connectDB } from "@/lib/db";
import { Order } from "@/models/Order";
import { orderSchema } from "@/lib/validation";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { placeOrder } from "@/lib/services/orders";
import { AppError } from "@/lib/errors";
import { notifyOrderPlaced } from "@/lib/telegram/notify";
import { notifyAllAdmins } from "@/lib/services/notifications";
import { requestLogger } from "@/lib/logger";

export async function GET(request: Request) {
  const log = requestLogger(request);
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectDB();

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));

    const [orders, total] = await Promise.all([
      Order.find({ userId: session.user.id })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("serviceId", "name")
        .lean(),
      Order.countDocuments({ userId: session.user.id }),
    ]);

    return NextResponse.json({ orders, total, page, limit });
  } catch (error) {
    log.error({ err: error }, "Orders fetch error");
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
    const { success } = await rateLimit("orderCreate", `${session.user.id}:${ip}`);
    if (!success) {
      return NextResponse.json({ error: "Too many orders placed. Please slow down." }, { status: 429 });
    }

    await connectDB();

    const body = await request.json();
    const parsed = orderSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid order data", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { serviceId, target, quantity } = parsed.data;

    const order = await placeOrder({
      userId: session.user.id,
      userStatus: session.user.status,
      serviceId,
      target,
      quantity,
    });

    notifyOrderPlaced(order).catch((err) => log.error({ err }, "Order notification error"));
    notifyAllAdmins({
      type: "NEW_ORDER",
      title: "New order placed",
      body: `A new order for ${order.quantity} units was placed.`,
      href: "/admin/orders",
    }).catch((err) => log.error({ err }, "Admin order notification error"));

    return NextResponse.json({ message: "Order placed successfully", order }, { status: 201 });
  } catch (error) {
    if (error instanceof AppError) {
      const statusByCode: Record<string, number> = {
        ACCOUNT_NOT_ACTIVE: 403,
        SERVICE_NOT_FOUND: 404,
        INVALID_QUANTITY: 400,
        WALLET_NOT_FOUND: 404,
        INSUFFICIENT_BALANCE: 400,
        CONCURRENT_MODIFICATION: 409,
      };
      return NextResponse.json({ error: error.message }, { status: statusByCode[error.code] ?? 400 });
    }

    log.error({ err: error }, "Order creation error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
