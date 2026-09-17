import { prisma } from "@/lib/db";
import { OrdersTable } from "@/components/admin/orders-table";
import { AdminFilterBar } from "@/components/admin/admin-filter-bar";
import { AdminPagination } from "@/components/admin/admin-pagination";
import { parseListQuery } from "@/lib/admin-query";
import type { Prisma, OrderStatus } from "@/lib/generated/prisma";

const ORDER_STATUS_OPTIONS = [
  "PENDING",
  "PROCESSING",
  "IN_PROGRESS",
  "COMPLETED",
  "PARTIAL",
  "CANCELED",
  "FAILED",
  "REFUNDED",
];

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const resolvedSearchParams = await searchParams;
  const urlSearchParams = new URLSearchParams(
    Object.entries(resolvedSearchParams).filter(([, v]) => v !== undefined) as [string, string][]
  );
  const { page, limit, status, search, dateRange } = parseListQuery(urlSearchParams);

  const where: Prisma.OrderWhereInput = {};
  if (status && status.length > 0) where.status = { in: status as OrderStatus[] };
  if (dateRange) where.createdAt = dateRange;

  if (search) {
    where.OR = [
      { target: { contains: search, mode: "insensitive" } },
      {
        user: {
          is: {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { email: { contains: search, mode: "insensitive" } },
            ],
          },
        },
      },
    ];
  }

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: {
        user: { select: { name: true, email: true } },
        service: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.order.count({ where }),
  ]);

  const rows = orders.map((o) => ({
    _id: o.id,
    target: o.target,
    quantity: o.quantity,
    charge: o.charge.toString(),
    status: o.status,
    refillStatus: o.refillStatus,
    createdAt: o.createdAt.toISOString(),
    userId: o.user ? { name: o.user.name, email: o.user.email } : null,
    serviceId: o.service ? { name: o.service.name } : null,
  }));

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Orders</h1>
        <p className="mt-1 text-slate-400">Manage and fulfill customer orders.</p>
      </div>

      <AdminFilterBar searchPlaceholder="Search by target, user name/email…" statusOptions={ORDER_STATUS_OPTIONS} />

      <OrdersTable orders={rows} />

      <AdminPagination page={page} totalPages={totalPages} total={total} />
    </div>
  );
}
