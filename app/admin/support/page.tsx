import { prisma } from "@/lib/db";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { AdminFilterBar } from "@/components/admin/admin-filter-bar";
import { AdminPagination } from "@/components/admin/admin-pagination";
import { parseListQuery } from "@/lib/admin-query";
import Link from "next/link";
import type { Prisma, TicketStatus } from "@/lib/generated/prisma";

const TICKET_STATUS_OPTIONS = ["OPEN", "ANSWERED", "CLOSED"];

export default async function AdminSupportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const resolvedSearchParams = await searchParams;
  const urlSearchParams = new URLSearchParams(
    Object.entries(resolvedSearchParams).filter(([, v]) => v !== undefined) as [string, string][]
  );
  const { page, limit, status, search, dateRange } = parseListQuery(urlSearchParams, 20, 100);

  const where: Prisma.SupportTicketWhereInput = {};
  if (status && status.length > 0) where.status = { in: status as TicketStatus[] };
  if (dateRange) where.createdAt = dateRange;

  if (search) {
    where.OR = [
      { subject: { contains: search, mode: "insensitive" } },
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

  const [tickets, total] = await Promise.all([
    prisma.supportTicket.findMany({
      where,
      include: { user: { select: { name: true, email: true } } },
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.supportTicket.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Support Tickets</h1>
        <p className="mt-1 text-slate-400">Respond to customer inquiries.</p>
      </div>

      <AdminFilterBar searchPlaceholder="Search by subject, user name/email…" statusOptions={TICKET_STATUS_OPTIONS} />

      <div className="space-y-3">
        {tickets.length === 0 && (
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-6 text-center text-slate-500">
            No matching tickets.
          </div>
        )}
        {tickets.map((t) => (
          <Link
            key={t.id}
            href={`/admin/support/${t.id}`}
            className="block rounded-xl border border-slate-800 bg-slate-950 p-5 hover:border-slate-700"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-white">{t.subject}</p>
                <p className="text-xs text-slate-500">{t.user?.email}</p>
              </div>
              <StatusBadge status={t.status} />
            </div>
          </Link>
        ))}
      </div>

      <AdminPagination page={page} totalPages={totalPages} total={total} />
    </div>
  );
}
