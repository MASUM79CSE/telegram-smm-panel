import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { connectDB } from "@/lib/db";
import { Wallet } from "@/models/Wallet";
import { Transaction } from "@/models/Transaction";
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

    const wallet = await Wallet.findOne({ userId: session.user.id }).lean();

    const [transactions, total] = await Promise.all([
      Transaction.find({ userId: session.user.id })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Transaction.countDocuments({ userId: session.user.id }),
    ]);

    return NextResponse.json({ wallet, transactions, total, page, limit });
  } catch (error) {
    log.error({ err: error }, "Wallet fetch error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
