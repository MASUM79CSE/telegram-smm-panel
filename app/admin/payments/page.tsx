import { connectDB } from "@/lib/db";
import { Payment } from "@/models/Payment";
import { User } from "@/models/User";
import { PaymentsTable } from "@/components/admin/payments-table";
import { AdminFilterBar } from "@/components/admin/admin-filter-bar";
import { AdminPagination } from "@/components/admin/admin-pagination";
import { parseListQuery, escapeRegExp } from "@/lib/admin-query";

const PAYMENT_STATUS_OPTIONS = ["PENDING", "COMPLETED", "FAILED", "CANCELED", "REJECTED"];

export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
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
    const matchingUsers = await User.find({ $or: [{ name: re }, { email: re }] })
      .select("_id")
      .lean();
    filter.$or = [{ transactionRef: re }, { userId: { $in: matchingUsers.map((u) => u._id) } }];
  }

  const [payments, total] = await Promise.all([
    Payment.find(filter)
      .populate("userId", "name email")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Payment.countDocuments(filter),
  ]);

  const rows = payments.map((p) => {
    // See the identical comment in app/admin/orders/page.tsx — populated
    // sub-documents aren't plain-serializable, so only pluck the fields
    // the table actually renders.
    const user = p.userId as unknown as { name?: string; email?: string } | null;
    return {
      _id: p._id.toString(),
      amount: p.amount.toString(),
      method: p.method,
      transactionRef: p.transactionRef,
      status: p.status,
      createdAt: p.createdAt.toISOString(),
      userId: user ? { name: user.name, email: user.email } : null,
    };
  });

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
