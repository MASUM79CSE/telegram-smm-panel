import { getLocale, getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { connectDB } from "@/lib/db";
import { Wallet } from "@/models/Wallet";
import { Order } from "@/models/Order";
import { getDisplayMoney, getDisplayMoneyBatch } from "@/lib/services/display-money";
import { getUserSpendingSeries } from "@/lib/services/analytics";
import { DualCurrency } from "@/components/shared/dual-currency";
import { SpendingChart } from "@/components/shared/spending-chart";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Link } from "@/i18n/navigation";
import { Wallet as WalletIcon, ShoppingCart, Package, Plus } from "lucide-react";

export default async function DashboardPage() {
  const session = await auth();
  const locale = await getLocale();
  await connectDB();
  const t = await getTranslations("Dashboard.home");
  const tStatus = await getTranslations("StatusBadge");

  const [wallet, totalOrders, pendingOrders, recentOrders, spending] = await Promise.all([
    Wallet.findOne({ userId: session!.user.id }).lean(),
    Order.countDocuments({ userId: session!.user.id }),
    Order.countDocuments({ userId: session!.user.id, status: { $in: ["PENDING", "PROCESSING", "IN_PROGRESS"] } }),
    Order.find({ userId: session!.user.id })
      .populate("serviceId", "name")
      .sort({ createdAt: -1 })
      .limit(5)
      .lean(),
    getUserSpendingSeries(session!.user.id, 30),
  ]);

  const balanceDisplay = await getDisplayMoney(wallet?.balance ?? 0, locale);
  const recentCharges = await getDisplayMoneyBatch(
    recentOrders.map((o) => o.charge),
    locale
  );
  const currencySymbol = locale === "bn" ? "৳" : "$";

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">{t("welcome", { name: session?.user.name ?? "" })}</h1>
        <p className="mt-1 text-slate-400">{t("subtitle")}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          icon={WalletIcon}
          label={t("walletBalance")}
          value={<DualCurrency money={balanceDisplay} size="lg" />}
          color="bg-green-600"
        />
        <StatCard icon={ShoppingCart} label={t("totalOrders")} value={String(totalOrders)} color="bg-blue-600" />
        <StatCard icon={Package} label={t("activeOrders")} value={String(pendingOrders)} color="bg-amber-600" />
      </div>

      <div className="mt-8 flex gap-4">
        <Link
          href="/dashboard/services"
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-3 font-medium text-white hover:bg-blue-500"
        >
          <Plus className="h-4 w-4" />
          {t("placeNewOrder")}
        </Link>
        <Link
          href="/dashboard/wallet"
          className="flex items-center gap-2 rounded-lg border border-slate-700 px-5 py-3 font-medium text-slate-200 hover:bg-slate-900"
        >
          {t("addFunds")}
        </Link>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
          <h3 className="mb-1 font-semibold text-white">{t("spendingInsights")}</h3>
          <p className="mb-4 text-sm text-slate-500">
            {currencySymbol}
            {spending.totalSpending.toFixed(2)} {t("last30Days")}
          </p>
          <SpendingChart data={spending.spending} currencySymbol={currencySymbol} />
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-semibold text-white">{t("recentOrders")}</h3>
            <Link href="/dashboard/orders" className="text-xs text-blue-400 hover:underline">
              {t("viewAll")}
            </Link>
          </div>
          {recentOrders.length === 0 ? (
            <p className="text-sm text-slate-500">{t("noRecentOrders")}</p>
          ) : (
            <ul className="space-y-3">
              {recentOrders.map((order, i) => {
                const service = order.serviceId as unknown as { name?: string } | null;
                const charge = recentCharges[i];
                return (
                  <li key={order._id.toString()} className="flex items-center justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <p className="truncate text-slate-200">{service?.name ?? t("unknownService")}</p>
                      <p className="text-xs text-slate-500">{new Date(order.createdAt).toLocaleDateString()}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="text-slate-400">{charge.primary}</span>
                      <StatusBadge status={order.status} label={tStatus(order.status)} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
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
  value: React.ReactNode;
  color: string;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
      <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${color}`}>
        <Icon className="h-5 w-5 text-white" />
      </div>
      <p className="mt-4 text-sm text-slate-400">{label}</p>
      <div className="mt-1 text-white">{value}</div>
    </div>
  );
}
