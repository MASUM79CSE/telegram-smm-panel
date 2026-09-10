"use client";

import { useState, useTransition } from "react";
import { RevenueChart } from "@/components/shared/revenue-chart";
import type { RevenueSeries } from "@/lib/services/analytics";

const PERIODS = [
  { label: "7D", days: 7 },
  { label: "30D", days: 30 },
  { label: "90D", days: 90 },
];

/**
 * Client wrapper around `RevenueChart` that owns the period selector
 * (7/30/90 days) and re-fetches from `/api/admin/analytics/revenue` on
 * change, seeded with server-fetched initial data so the first paint needs
 * no client-side round trip (docs/DASHBOARD_UPGRADE_PLAN.md §2.1).
 */
export function AdminRevenuePanel({ initialDays, initialData }: { initialDays: number; initialData: RevenueSeries }) {
  const [days, setDays] = useState(initialDays);
  const [data, setData] = useState(initialData);
  const [isPending, startTransition] = useTransition();

  function selectPeriod(newDays: number) {
    if (newDays === days) return;
    setDays(newDays);
    startTransition(async () => {
      const res = await fetch(`/api/admin/analytics/revenue?days=${newDays}`);
      if (res.ok) setData(await res.json());
    });
  }

  const changeLabel =
    data.revenueChangePct === null
      ? null
      : `${data.revenueChangePct >= 0 ? "+" : ""}${data.revenueChangePct.toFixed(1)}% vs. previous period`;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-white">Revenue &amp; Orders</h3>
          <p className="mt-1 text-sm text-slate-400">
            ${data.totalRevenue.toFixed(2)} total · {data.totalOrders} orders
            {changeLabel && (
              <span className={`ml-2 ${data.revenueChangePct! >= 0 ? "text-green-400" : "text-red-400"}`}>
                {changeLabel}
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-1 rounded-lg border border-slate-800 p-1">
          {PERIODS.map((p) => (
            <button
              key={p.days}
              onClick={() => selectPeriod(p.days)}
              disabled={isPending}
              className={`rounded-md px-3 py-1 text-xs font-medium transition disabled:opacity-50 ${
                days === p.days ? "bg-blue-600 text-white" : "text-slate-400 hover:bg-slate-800 hover:text-white"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <RevenueChart revenue={data.revenue} orderCount={data.orderCount} revenueLabel="Revenue" ordersLabel="Orders" />
    </div>
  );
}
