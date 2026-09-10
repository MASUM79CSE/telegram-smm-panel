import { connectDB } from "@/lib/db";
import { SupportTicket } from "@/models/SupportTicket";
import { User } from "@/models/User";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { AdminFilterBar } from "@/components/admin/admin-filter-bar";
import { AdminPagination } from "@/components/admin/admin-pagination";
import { parseListQuery, escapeRegExp } from "@/lib/admin-query";
import Link from "next/link";

const TICKET_STATUS_OPTIONS = ["OPEN", "ANSWERED", "CLOSED"];

export default async function AdminSupportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await connectDB();

  const resolvedSearchParams = await searchParams;
  const urlSearchParams = new URLSearchParams(
    Object.entries(resolvedSearchParams).filter(([, v]) => v !== undefined) as [string, string][]
  );
  const { page, limit, status, search, dateRange } = parseListQuery(urlSearchParams, 20, 100);

  const filter: Record<string, unknown> = {};
  if (status && status.length > 0) filter.status = { $in: status };
  if (dateRange) filter.createdAt = dateRange;

  if (search) {
    const re = { $regex: escapeRegExp(search), $options: "i" };
    const matchingUsers = await User.find({ $or: [{ name: re }, { email: re }] })
      .select("_id")
      .lean();
    filter.$or = [{ subject: re }, { userId: { $in: matchingUsers.map((u) => u._id) } }];
  }

  const [tickets, total] = await Promise.all([
    SupportTicket.find(filter)
      .select("-messages")
      .populate("userId", "name email")
      .sort({ updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    SupportTicket.countDocuments(filter),
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
            key={t._id.toString()}
            href={`/admin/support/${t._id}`}
            className="block rounded-xl border border-slate-800 bg-slate-950 p-5 hover:border-slate-700"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-white">{t.subject}</p>
                <p className="text-xs text-slate-500">{(t.userId as unknown as { email?: string })?.email}</p>
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
