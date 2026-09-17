import { prisma } from "@/lib/db";
import {
  getRevenueSeries,
  getOrderStatusBreakdown,
  getTopServices,
} from "@/lib/services/analytics";
import { Users, ShoppingCart, CreditCard, Headphones } from "lucide-react";
import { AdminRevenuePanel } from "@/components/admin/revenue-panel";
import { OrderStatusDonut } from "@/components/shared/order-status-donut";
import { TopServicesTable } from "@/components/admin/top-services-table";
import { RecentActivityFeed, type ActivityRow } from "@/components/admin/recent-activity-feed";
import Link from "next/link";

export default async function AdminDashboardPage() {
  const [totalUsers, totalOrders, pendingPayments, openTickets, revenueSeries, statusBreakdown, topServices, recentAudit] =
    await Promise.all([
      prisma.user.count(),
      prisma.order.count(),
      prisma.payment.count({ where: { status: "PENDING" } }),
      prisma.supportTicket.count({ where: { status: { in: ["OPEN", "ANSWERED"] } } }),
      getRevenueSeries(30),
      getOrderStatusBreakdown(),
      getTopServices(5, 30),
      prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
    ]);

  const activityRows: ActivityRow[] = recentAudit.map((a) => ({
    _id: a.id,
    actorEmail: a.actorEmail,
    action: a.action,
    targetType: a.targetType,
    targetId: a.targetId,
    createdAt: a.createdAt.toISOString(),
  }));

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Admin Overview</h1>
        <p className="mt-1 text-slate-400">Platform statistics at a glance.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard icon={Users} label="Total Users" value={String(totalUsers)} color="bg-blue-600" />
        <StatCard icon={ShoppingCart} label="Total Orders" value={String(totalOrders)} color="bg-green-600" />
        <StatCard icon={CreditCard} label="Pending Payments" value={String(pendingPayments)} color="bg-amber-600" />
        <StatCard icon={Headphones} label="Open Tickets" value={String(openTickets)} color="bg-red-600" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <AdminRevenuePanel initialDays={30} initialData={revenueSeries} />
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
          <h3 className="mb-2 font-semibold text-white">Orders by Status</h3>
          <OrderStatusDonut data={statusBreakdown} />
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
          <h3 className="mb-4 font-semibold text-white">Top Services (last 30 days)</h3>
          <TopServicesTable services={topServices} />
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-semibold text-white">Recent Activity</h3>
            <Link href="/admin/audit-log" className="text-xs text-blue-400 hover:underline">
              View all
            </Link>
          </div>
          <RecentActivityFeed entries={activityRows} />
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
      <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${color}`}>
        <Icon className="h-5 w-5 text-white" />
      </div>
      <p className="mt-4 text-sm text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-white">{value}</p>
    </div>
  );
}
