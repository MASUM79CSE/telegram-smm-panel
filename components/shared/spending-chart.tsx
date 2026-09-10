"use client";

import { ResponsiveContainer, AreaChart, Area, XAxis, Tooltip } from "recharts";
import type { DaySeriesPoint } from "@/lib/services/analytics";

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Compact spending-over-time area chart for the customer dashboard home page. */
export function SpendingChart({ data, currencySymbol = "$" }: { data: DaySeriesPoint[]; currencySymbol?: string }) {
  return (
    <ResponsiveContainer width="100%" height={160}>
      <AreaChart data={data} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="spendingFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#22c55e" stopOpacity={0.35} />
            <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="date"
          tickFormatter={formatDateLabel}
          stroke="#64748b"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          minTickGap={30}
        />
        <Tooltip
          contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, fontSize: 12 }}
          labelFormatter={(label) => formatDateLabel(String(label))}
          formatter={(value) => [`${currencySymbol}${Number(value).toFixed(2)}`, ""]}
        />
        <Area type="monotone" dataKey="value" stroke="#22c55e" fill="url(#spendingFill)" strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
