"use client";

import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from "recharts";
import type { OrderStatusCount } from "@/lib/services/analytics";

const STATUS_COLORS: Record<string, string> = {
  PENDING: "#64748b",
  PROCESSING: "#f59e0b",
  IN_PROGRESS: "#3b82f6",
  COMPLETED: "#22c55e",
  PARTIAL: "#f97316",
  CANCELED: "#475569",
  FAILED: "#ef4444",
  REFUNDED: "#a855f7",
};

/** Donut chart of order counts by status — reuses the same color language as `StatusBadge`. */
export function OrderStatusDonut({ data }: { data: OrderStatusCount[] }) {
  const total = data.reduce((sum, d) => sum + d.count, 0);

  if (total === 0) {
    return <p className="flex h-[220px] items-center justify-center text-sm text-slate-500">No orders yet.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie
          data={data}
          dataKey="count"
          nameKey="status"
          cx="50%"
          cy="50%"
          innerRadius={50}
          outerRadius={80}
          paddingAngle={2}
        >
          {data.map((entry) => (
            <Cell key={entry.status} fill={STATUS_COLORS[entry.status] || "#94a3b8"} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, fontSize: 12 }}
        />
        <Legend
          verticalAlign="bottom"
          height={36}
          formatter={(value: string) => <span className="text-xs text-slate-400">{value.replace(/_/g, " ")}</span>}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
