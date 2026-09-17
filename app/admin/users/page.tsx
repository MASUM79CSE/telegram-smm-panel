import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { UsersTable } from "@/components/admin/users-table";
import { AdminFilterBar } from "@/components/admin/admin-filter-bar";
import { AdminPagination } from "@/components/admin/admin-pagination";
import { parseListQuery } from "@/lib/admin-query";
import type { Prisma, UserStatus } from "@/lib/generated/prisma";

const USER_STATUS_OPTIONS = ["ACTIVE", "SUSPENDED", "BANNED"];

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await auth();

  const resolvedSearchParams = await searchParams;
  const urlSearchParams = new URLSearchParams(
    Object.entries(resolvedSearchParams).filter(([, v]) => v !== undefined) as [string, string][]
  );
  const { page, limit, status, search, dateRange } = parseListQuery(urlSearchParams);

  const where: Prisma.UserWhereInput = {};
  if (status && status.length > 0) where.status = { in: status as UserStatus[] };
  if (dateRange) where.createdAt = dateRange;
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
    ];
  }

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      omit: { passwordHash: true, twoFactorSecret: true },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.user.count({ where }),
  ]);

  const rows = users.map((u) => ({
    _id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    status: u.status,
    createdAt: u.createdAt.toISOString(),
  }));

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Users</h1>
        <p className="mt-1 text-slate-400">Manage user accounts, roles, and status.</p>
      </div>

      <AdminFilterBar searchPlaceholder="Search by name or email…" statusOptions={USER_STATUS_OPTIONS} />

      <UsersTable users={rows} currentUserId={session?.user?.id} />

      <AdminPagination page={page} totalPages={totalPages} total={total} />
    </div>
  );
}
