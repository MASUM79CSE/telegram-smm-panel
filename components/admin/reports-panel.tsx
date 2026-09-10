"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Download } from "lucide-react";
import type { FinancialReportSummary } from "@/lib/services/analytics";

const EXPORT_TARGETS = [
  { key: "orders", label: "Orders" },
  { key: "payments", label: "Payments (Deposits)" },
  { key: "transactions", label: "Transactions (Ledger)" },
] as const;

/**
 * Client wrapper for `/admin/reports` (docs/DASHBOARD_UPGRADE_PLAN.md
 * §2.5). Owns the date-range inputs (URL-persisted, same pattern as
 * `AdminFilterBar`) and triggers CSV downloads via a plain `<a>` navigation
 * to the `/api/admin/export/*` routes — no client-side fetch/blob handling
 * needed since the browser can just follow the `Content-Disposition:
 * attachment` response directly.
 */
export function ReportsPanel({ summary, from, to }: { summary: FinancialReportSummary; from: string; to: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [fromInput, setFromInput] = useState(from);
  const [toInput, setToInput] = useState(to);

  function applyRange() {
    const params = new URLSearchParams(searchParams.toString());
    if (fromInput) params.set("from", fromInput);
    if (toInput) params.set("to", toInput);
    startTransition(() => {
      router.push(`?${params.toString()}`);
    });
  }

  function exportUrl(target: string): string {
    const params = new URLSearchParams();
    if (fromInput) params.set("from", fromInput);
    if (toInput) params.set("to", toInput);
    return `/api/admin/export/${target}?${params.toString()}`;
  }

  const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500">From</label>
          <input
            type="date"
            value={fromInput}
            onChange={(e) => setFromInput(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-white outline-none focus:border-blue-500"
          />
          <label className="text-xs text-slate-500">To</label>
          <input
            type="date"
            value={toInput}
            onChange={(e) => setToInput(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-white outline-none focus:border-blue-500"
          />
        </div>
        <button
          type="button"
          onClick={applyRange}
          disabled={isPending}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          Apply range
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
          <p className="text-xs text-slate-500">Revenue</p>
          <p className="mt-1 text-2xl font-bold text-white">{fmt(summary.totalRevenue)}</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
          <p className="text-xs text-slate-500">Orders</p>
          <p className="mt-1 text-2xl font-bold text-white">{summary.totalOrders}</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
          <p className="text-xs text-slate-500">Refunds</p>
          <p className="mt-1 text-2xl font-bold text-white">{fmt(summary.totalRefunds)}</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
          <p className="text-xs text-slate-500">Deposits</p>
          <p className="mt-1 text-2xl font-bold text-white">{fmt(summary.totalDeposits)}</p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
        <h2 className="mb-4 font-semibold text-white">Export CSV</h2>
        <div className="flex flex-wrap gap-3">
          {EXPORT_TARGETS.map((t) => (
            <a
              key={t.key}
              href={exportUrl(t.key)}
              className="flex items-center gap-2 rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
            >
              <Download className="h-4 w-4" />
              {t.label}
            </a>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-900 text-slate-400">
            <tr>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Revenue</th>
              <th className="px-4 py-3">Orders</th>
              <th className="px-4 py-3">Refunds</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 bg-slate-950">
            {summary.rows.map((row) => (
              <tr key={row.date} className="text-slate-300">
                <td className="px-4 py-3 text-slate-500">{row.date}</td>
                <td className="px-4 py-3">{fmt(row.revenue)}</td>
                <td className="px-4 py-3">{row.orderCount}</td>
                <td className="px-4 py-3">{fmt(row.refunds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
