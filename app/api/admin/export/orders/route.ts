import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { parseDateRange } from "@/lib/admin-query";
import { toCsv } from "@/lib/csv";
import { recordAudit } from "@/lib/audit";
import type { Prisma } from "@/lib/generated/prisma";

/**
 * Streams a CSV export of orders within an optional `[from, to]` date
 * range (docs/DASHBOARD_UPGRADE_PLAN.md §2.5). Capped at 10,000 rows to
 * keep this a simple single-response export rather than needing real
 * streaming/chunked transfer — comfortably covers this platform's expected
 * admin reporting volumes; a true streaming export can be a future
 * follow-up if that cap is ever hit in practice.
 */
const MAX_EXPORT_ROWS = 10000;

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const dateRange = parseDateRange(searchParams.get("from"), searchParams.get("to"));

  const where: Prisma.OrderWhereInput = {};
  if (dateRange) where.createdAt = dateRange;

  const orders = await prisma.order.findMany({
    where,
    include: {
      user: { select: { email: true } },
      service: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: MAX_EXPORT_ROWS,
  });

  const rows = orders.map((o) => ({
    id: o.id,
    createdAt: o.createdAt.toISOString(),
    userEmail: o.user?.email ?? "",
    service: o.service?.name ?? "",
    target: o.target,
    quantity: o.quantity,
    charge: o.charge.toString(),
    status: o.status,
    refillStatus: o.refillStatus,
  }));

  const csv = toCsv(rows, [
    { key: "id", label: "Order ID" },
    { key: "createdAt", label: "Created At" },
    { key: "userEmail", label: "User Email" },
    { key: "service", label: "Service" },
    { key: "target", label: "Target" },
    { key: "quantity", label: "Quantity" },
    { key: "charge", label: "Charge" },
    { key: "status", label: "Status" },
    { key: "refillStatus", label: "Refill Status" },
  ]);

  await recordAudit({
    actorId: session.user.id,
    actorEmail: session.user.email,
    action: "DATA_EXPORTED",
    targetType: "Order",
    metadata: { rowCount: rows.length, from: searchParams.get("from"), to: searchParams.get("to") },
    request,
  });

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="orders-export-${Date.now()}.csv"`,
    },
  });
}
