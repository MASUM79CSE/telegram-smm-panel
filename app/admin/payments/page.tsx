import { prisma } from "@/lib/db";
import { PaymentsTable } from "@/components/admin/payments-table";
import { AdminFilterBar } from "@/components/admin/admin-filter-bar";
import { AdminPagination } from "@/components/admin/admin-pagination";
import { parseListQuery } from "@/lib/admin-query";
import type { Prisma, PaymentStatus } from "@/lib/generated/prisma";

const PAYMENT_STATUS_OPTIONS = ["PENDING", "COMPLETED", "FAILED", "CANCELED", "REJECTED"];

export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const resolvedSearchParams = await searchParams;
  const urlSearchParams = new URLSearchParams(
    Object.entries(resolvedSearchParams).filter(([, v]) => v !== undefined) as [string, string][]
  );
  const { page, limit, status, search, dateRange } = parseListQuery(urlSearchParams);

  const where: Prisma.PaymentWhereInput = {};
  if (status && status.length > 0) where.status = { in: status as PaymentStatus[] };
  if (dateRange) where.createdAt = dateRange;

  if (search) {
    where.OR = [
      { transactionRef: { contains: search, mode: "insensitive" } },
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

  const [payments, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      include: { user: { select: { name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.payment.count({ where }),
  ]);

  const rows = payments.map((p) => ({
    _id: p.id,
    amount: p.amount.toString(),
    method: p.method,
    transactionRef: p.transactionRef,
    status: p.status,
    createdAt: p.createdAt.toISOString(),
    userId: p.user ? { name: p.user.name, email: p.user.email } : null,
  }));

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Payments</h1>
        <p className="mt-1 text-slate-400">Review and approve deposit requests.</p>
      </div>

      <AdminFilterBar searchPlaceholder="Search by reference, user name/email…" statusOptions={PAYMENT_STATUS_OPTIONS} />

      <PaymentsTable payments={rows} />

      <AdminPagination page={page} totalPages={totalPages} total={total} />
    </div>
  );
}
