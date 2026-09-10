import { auth } from "@/auth";
import { connectDB } from "@/lib/db";
import { User } from "@/models/User";
import { UsersTable } from "@/components/admin/users-table";
import { AdminFilterBar } from "@/components/admin/admin-filter-bar";
import { AdminPagination } from "@/components/admin/admin-pagination";
import { parseListQuery, escapeRegExp } from "@/lib/admin-query";

const USER_STATUS_OPTIONS = ["ACTIVE", "SUSPENDED", "BANNED"];

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await auth();
  await connectDB();

  const resolvedSearchParams = await searchParams;
  const urlSearchParams = new URLSearchParams(
    Object.entries(resolvedSearchParams).filter(([, v]) => v !== undefined) as [string, string][]
  );
  const { page, limit, status, search, dateRange } = parseListQuery(urlSearchParams);

  const filter: Record<string, unknown> = {};
  if (status && status.length > 0) filter.status = { $in: status };
  if (dateRange) filter.createdAt = dateRange;
  if (search) {
    const re = { $regex: escapeRegExp(search), $options: "i" };
    filter.$or = [{ name: re }, { email: re }];
  }

  const [users, total] = await Promise.all([
    User.find(filter)
      .select("-passwordHash -twoFactorSecret")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    User.countDocuments(filter),
  ]);

  const rows = users.map((u) => ({
    _id: u._id.toString(),
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
