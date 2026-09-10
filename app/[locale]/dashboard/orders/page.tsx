import { getLocale, getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { connectDB } from "@/lib/db";
import { Order } from "@/models/Order";
import { getDisplayMoneyBatch } from "@/lib/services/display-money";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { RefillButton } from "@/components/dashboard/refill-button";
import { OrderTimelineToggle } from "@/components/dashboard/order-timeline";
import { isRefillEligible } from "@/lib/services/refill";
import { Fragment } from "react";

export default async function OrdersPage() {
  const session = await auth();
  const locale = await getLocale();
  await connectDB();
  const t = await getTranslations("Dashboard.orders");
  const tStatus = await getTranslations("StatusBadge");
  const tRefillStatus = await getTranslations("RefillStatus");

  const orders = await Order.find({ userId: session!.user.id })
    .populate("serviceId", "name refillDays")
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  const chargeDisplays = await getDisplayMoneyBatch(
    orders.map((o) => o.charge),
    locale
  );

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">{t("title")}</h1>
        <p className="mt-1 text-slate-400">{t("subtitle")}</p>
      </div>

      {orders.length === 0 ? (
        <p className="text-slate-400">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-900 text-slate-400">
              <tr>
                <th className="px-4 py-3">{t("colService")}</th>
                <th className="px-4 py-3">{t("colTarget")}</th>
                <th className="px-4 py-3">{t("colQuantity")}</th>
                <th className="px-4 py-3">{t("colCharge")}</th>
                <th className="px-4 py-3">{t("colStatus")}</th>
                <th className="px-4 py-3">{t("colDate")}</th>
                <th className="px-4 py-3">{t("colRefill")}</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 bg-slate-950">
              {orders.map((order, i) => {
                const service = order.serviceId as unknown as {
                  name?: string;
                  refillDays?: number | null;
                } | null;

                const refillDays = service?.refillDays ?? null;
                const charge = chargeDisplays[i];
                // Orders created before the refillStatus field existed on the
                // schema have it as undefined in the DB — Mongoose defaults only
                // apply on document creation, not retroactively to old records
                // fetched via .lean(). Treat missing as "NONE" defensively.
                const refillStatus = order.refillStatus ?? "NONE";
                const eligible = isRefillEligible({ ...order, refillStatus }, refillDays);

                return (
                  <Fragment key={order._id.toString()}>
                    <tr>
                      <td className="px-4 py-3 text-white">{service?.name || t("unknownService")}</td>
                      <td className="max-w-[200px] truncate px-4 py-3 text-slate-300">{order.target}</td>
                      <td className="px-4 py-3 text-slate-300">{order.quantity}</td>
                      <td className="px-4 py-3 text-slate-300">
                        {charge.primary}
                        {charge.secondary && <span className="ml-1 text-xs text-slate-500">≈ {charge.secondary}</span>}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={order.status} label={tStatus(order.status)} />
                      </td>
                      <td className="px-4 py-3 text-slate-500">{new Date(order.createdAt).toLocaleDateString()}</td>
                      <td className="px-4 py-3">
                        {refillStatus !== "NONE" ? (
                          <span className="text-xs text-slate-500">{tRefillStatus(refillStatus)}</span>
                        ) : eligible ? (
                          <RefillButton orderId={order._id.toString()} />
                        ) : (
                          <span className="text-xs text-slate-600">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3"></td>
                    </tr>
                    <tr>
                      <td colSpan={8} className="bg-slate-950 px-4 pb-3">
                        <OrderTimelineToggle
                          events={(order.statusHistory ?? []).map((h) => ({
                            status: h.status,
                            statusLabel: tStatus(h.status),
                            note: h.note,
                            at: new Date(h.at).toISOString(),
                          }))}
                          toggleLabel={t("trackOrder")}
                        />
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
