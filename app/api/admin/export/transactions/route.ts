import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { parseDateRange } from "@/lib/admin-query";
import { toCsv } from "@/lib/csv";
import { recordAudit } from "@/lib/audit";
import type { Prisma } from "@/lib/generated/prisma";

const MAX_EXPORT_ROWS = 10000;

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const dateRange = parseDateRange(searchParams.get("from"), searchParams.get("to"));

  const where: Prisma.TransactionWhereInput = {};
  if (dateRange) where.createdAt = dateRange;

  const transactions = await prisma.transaction.findMany({
    where,
    include: { user: { select: { email: true } } },
    orderBy: { createdAt: "desc" },
    take: MAX_EXPORT_ROWS,
  });

  const rows = transactions.map((t) => ({
    id: t.id,
    createdAt: t.createdAt.toISOString(),
    userEmail: t.user?.email ?? "",
    type: t.type,
    status: t.status,
    amount: t.amount.toString(),
    balanceAfter: t.balanceAfter.toString(),
    description: t.description ?? "",
  }));

  const csv = toCsv(rows, [
    { key: "id", label: "Transaction ID" },
    { key: "createdAt", label: "Created At" },
    { key: "userEmail", label: "User Email" },
    { key: "type", label: "Type" },
    { key: "status", label: "Status" },
    { key: "amount", label: "Amount" },
    { key: "balanceAfter", label: "Balance After" },
    { key: "description", label: "Description" },
  ]);

  await recordAudit({
    actorId: session.user.id,
    actorEmail: session.user.email,
    action: "DATA_EXPORTED",
    targetType: "Transaction",
    metadata: { rowCount: rows.length, from: searchParams.get("from"), to: searchParams.get("to") },
    request,
  });

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="transactions-export-${Date.now()}.csv"`,
    },
  });
}
