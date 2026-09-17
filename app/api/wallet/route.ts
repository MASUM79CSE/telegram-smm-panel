import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
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

    const wallet = await prisma.wallet.findUnique({ where: { userId: session.user.id } });

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where: { userId: session.user.id },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.transaction.count({ where: { userId: session.user.id } }),
    ]);

    return NextResponse.json({ wallet, transactions, total, page, limit });
  } catch (error) {
    log.error({ err: error }, "Wallet fetch error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
