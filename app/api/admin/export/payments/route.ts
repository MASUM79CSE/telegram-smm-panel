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

  const where: Prisma.PaymentWhereInput = {};
  if (dateRange) where.createdAt = dateRange;

  const payments = await prisma.payment.findMany({
    where,
    include: { user: { select: { email: true } } },
    orderBy: { createdAt: "desc" },
    take: MAX_EXPORT_ROWS,
  });

  const rows = payments.map((p) => ({
    id: p.id,
    createdAt: p.createdAt.toISOString(),
    userEmail: p.user?.email ?? "",
    amount: p.amount.toString(),
    method: p.method,
    transactionRef: p.transactionRef ?? "",
    status: p.status,
  }));

  const csv = toCsv(rows, [
    { key: "id", label: "Payment ID" },
    { key: "createdAt", label: "Created At" },
    { key: "userEmail", label: "User Email" },
    { key: "amount", label: "Amount" },
    { key: "method", label: "Method" },
    { key: "transactionRef", label: "Reference" },
    { key: "status", label: "Status" },
  ]);

  await recordAudit({
    actorId: session.user.id,
    actorEmail: session.user.email,
    action: "DATA_EXPORTED",
    targetType: "Payment",
    metadata: { rowCount: rows.length, from: searchParams.get("from"), to: searchParams.get("to") },
    request,
  });

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="payments-export-${Date.now()}.csv"`,
    },
  });
}
