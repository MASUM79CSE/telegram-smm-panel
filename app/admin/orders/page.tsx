import { connectDB } from "@/lib/db";
import { Order } from "@/models/Order";
import { User } from "@/models/User";
import { OrdersTable } from "@/components/admin/orders-table";
import { AdminFilterBar } from "@/components/admin/admin-filter-bar";
import { AdminPagination } from "@/components/admin/admin-pagination";
import { parseListQuery, escapeRegExp } from "@/lib/admin-query";

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
    filter.$or = [{ target: re }, { userId: { $in: matchingUsers.map((u) => u._id) } }];
  }

  const [orders, total] = await Promise.all([
    Order.find(filter)
      .populate("userId", "name email")
      .populate("serviceId", "name")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Order.countDocuments(filter),
  ]);

  const rows = orders.map((o) => {
    // `.lean()` still leaves populated sub-documents as Mongoose-ish
    // objects (their `_id` is a real `ObjectId`, which has a `toJSON`
    // method) — passing those straight into a Client Component prop trips
    // React's "Only plain objects can be passed to Client Components"
    // dev-mode warning. Pluck only the plain, already-serializable fields
    // the table actually renders instead of forwarding the populated doc
    // as-is.
    const user = o.userId as unknown as { name?: string; email?: string } | null;
    const service = o.serviceId as unknown as { name?: string } | null;
    return {
      _id: o._id.toString(),
      target: o.target,
      quantity: o.quantity,
      charge: o.charge.toString(),
      status: o.status,
      refillStatus: o.refillStatus,
      createdAt: o.createdAt.toISOString(),
      userId: user ? { name: user.name, email: user.email } : null,
      serviceId: service ? { name: service.name } : null,
    };
  });

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
