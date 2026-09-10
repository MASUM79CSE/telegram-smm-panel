import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { connectDB } from "@/lib/db";
import { Payment } from "@/models/Payment";
import { parseDateRange } from "@/lib/admin-query";
import { toCsv } from "@/lib/csv";
import { recordAudit } from "@/lib/audit";

const MAX_EXPORT_ROWS = 10000;

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await connectDB();

  const { searchParams } = new URL(request.url);
  const dateRange = parseDateRange(searchParams.get("from"), searchParams.get("to"));

  const filter: Record<string, unknown> = {};
  if (dateRange) filter.createdAt = dateRange;

  const payments = await Payment.find(filter)
    .populate("userId", "email")
    .sort({ createdAt: -1 })
    .limit(MAX_EXPORT_ROWS)
    .lean();

  const rows = payments.map((p) => ({
    id: p._id.toString(),
    createdAt: p.createdAt.toISOString(),
    userEmail: (p.userId as unknown as { email?: string } | null)?.email ?? "",
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
