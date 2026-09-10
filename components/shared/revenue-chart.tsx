"use client";

import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import type { DaySeriesPoint } from "@/lib/services/analytics";

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

interface RevenueChartProps {
  revenue: DaySeriesPoint[];
  orderCount: DaySeriesPoint[];
  currencySymbol?: string;
  revenueLabel: string;
  ordersLabel: string;
}

/**
 * Dual-axis revenue (area) + order-count (line) chart, shared by the admin
 * analytics overview and reusable wherever else a revenue trend is needed.
 * Pure presentational client component — data is fetched server-side and
 * passed in as plain serializable arrays (docs/DASHBOARD_UPGRADE_PLAN.md §1).
 */
export function RevenueChart({ revenue, orderCount, currencySymbol = "$", revenueLabel, ordersLabel }: RevenueChartProps) {
  const data = revenue.map((r, i) => ({
    date: r.date,
    revenue: r.value,
    orders: orderCount[i]?.value ?? 0,
  }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.35} />
            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={formatDateLabel}
          stroke="#64748b"
          fontSize={12}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          yAxisId="revenue"
          stroke="#64748b"
          fontSize={12}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `${currencySymbol}${v}`}
        />
        <YAxis yAxisId="orders" orientation="right" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
        <Tooltip
          contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, fontSize: 12 }}
          labelFormatter={(label) => formatDateLabel(String(label))}
          formatter={(value, name) => [
            name === revenueLabel ? `${currencySymbol}${Number(value).toFixed(2)}` : value,
            name,
          ]}
        />
        <Area
          yAxisId="revenue"
          type="monotone"
          dataKey="revenue"
          name={revenueLabel}
          stroke="#3b82f6"
          fill="url(#revenueFill)"
          strokeWidth={2}
        />
        <Line
          yAxisId="orders"
          type="monotone"
          dataKey="orders"
          name={ordersLabel}
          stroke="#22c55e"
          strokeWidth={2}
          dot={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
