"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { toCsv } from "@/lib/csv";

interface OrderRow {
  _id: string;
  target: string;
  quantity: number;
  charge: string;
  status: string;
  refillStatus: string;
  createdAt: string;
  userId: { name?: string; email?: string } | null;
  serviceId: { name?: string } | null;
}

const STATUS_OPTIONS = ["PENDING", "PROCESSING", "IN_PROGRESS", "COMPLETED", "PARTIAL", "CANCELED", "FAILED", "REFUNDED"];

/**
 * Statuses selectable for the BULK action bar only. Deliberately a strict
 * subset of STATUS_OPTIONS (used by the existing per-row select, unchanged)
 * — REFUNDED (wallet-crediting transaction) and COMPLETED (anchors the
 * refill-eligibility window) stay single-item, individually-reviewed admin
 * actions. See lib/services/admin-bulk.ts's doc comment and
 * docs/DASHBOARD_UPGRADE_PLAN.md §2.3 for the full rationale. This is also
 * enforced server-side (zod schema + isBulkSafeOrderStatus), so this
 * client-side list is a UX convenience, not the actual security boundary.
 */
const BULK_STATUS_OPTIONS = ["CANCELED", "FAILED"] as const;

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function OrdersTable({ orders }: { orders: OrderRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkStatus, setBulkStatus] = useState<(typeof BULK_STATUS_OPTIONS)[number]>("CANCELED");

  const allOnPageSelected = orders.length > 0 && orders.every((o) => selected.has(o._id));

  function toggleAll() {
    setSelected(allOnPageSelected ? new Set() : new Set(orders.map((o) => o._id)));
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function updateStatus(id: string, status: string) {
    if (status === "REFUNDED" && !confirm("Refund this order? The charge will be credited back to the user's wallet.")) {
      return;
    }
    setBusyId(id);
    startTransition(async () => {
      const res = await fetch(`/api/admin/orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) alert(data.error);
      setBusyId(null);
      router.refresh();
    });
  }

  function resolveRefill(id: string, refillResolution: "COMPLETED" | "REJECTED") {
    const verb = refillResolution === "COMPLETED" ? "mark this refill fulfilled" : "decline this refill";
    if (!confirm(`Are you sure you want to ${verb}? This does not move any money — it only closes the request.`)) {
      return;
    }
    setBusyId(id);
    startTransition(async () => {
      const res = await fetch(`/api/admin/orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refillResolution }),
      });
      const data = await res.json();
      if (!res.ok) alert(data.error);
      setBusyId(null);
      router.refresh();
    });
  }

  function applyBulkStatus() {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (
      !confirm(
        `Set ${ids.length} order(s) to ${bulkStatus}? This does not move any money — REFUNDED/COMPLETED are not available in bulk.`
      )
    ) {
      return;
    }
    setBulkBusy(true);
    startTransition(async () => {
      const res = await fetch("/api/admin/orders/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds: ids, status: bulkStatus }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error);
      } else if (data.failed?.length) {
        alert(`${data.message}\n\nFailed: ${data.failed.map((f: { id: string; error: string }) => `${f.id}: ${f.error}`).join("\n")}`);
      }
      setBulkBusy(false);
      setSelected(new Set());
      router.refresh();
    });
  }

  function exportSelectedCsv() {
    const rows = orders
      .filter((o) => selected.has(o._id))
      .map((o) => ({
        orderId: o._id,
        userEmail: o.userId?.email ?? "",
        service: o.serviceId?.name ?? "",
        target: o.target,
        quantity: o.quantity,
        charge: o.charge,
        status: o.status,
        refillStatus: o.refillStatus,
        createdAt: o.createdAt,
      }));
    const csv = toCsv(rows, [
      { key: "orderId", label: "Order ID" },
      { key: "userEmail", label: "User Email" },
      { key: "service", label: "Service" },
      { key: "target", label: "Target" },
      { key: "quantity", label: "Quantity" },
      { key: "charge", label: "Charge" },
      { key: "status", label: "Status" },
      { key: "refillStatus", label: "Refill Status" },
      { key: "createdAt", label: "Created At" },
    ]);
    downloadCsv(`orders-selected-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  const selectedCount = selected.size;

  return (
    <div className="space-y-3">
      {selectedCount > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-sm">
          <span className="text-slate-300">{selectedCount} selected</span>
          <select
            disabled={bulkBusy}
            value={bulkStatus}
            onChange={(e) => setBulkStatus(e.target.value as (typeof BULK_STATUS_OPTIONS)[number])}
            aria-label="Bulk status to apply to selected orders"
            className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
          >
            {BULK_STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={bulkBusy}
            onClick={applyBulkStatus}
            className="rounded bg-slate-700 px-3 py-1 text-xs font-medium text-white hover:bg-slate-600 disabled:opacity-50"
          >
            Apply status
          </button>
          <button
            type="button"
            onClick={exportSelectedCsv}
            className="rounded border border-slate-600 px-3 py-1 text-xs font-medium text-slate-200 hover:bg-slate-800"
          >
            Export selected CSV
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-xs text-slate-400 hover:text-slate-200"
          >
            Clear selection
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-900 text-slate-400">
            <tr>
              <th className="px-4 py-3">
                <input
                  type="checkbox"
                  checked={allOnPageSelected}
                  onChange={toggleAll}
                  aria-label="Select all orders on this page"
                />
              </th>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Service</th>
              <th className="px-4 py-3">Target</th>
              <th className="px-4 py-3">Qty</th>
              <th className="px-4 py-3">Charge</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Refill</th>
              <th className="px-4 py-3">Update</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 bg-slate-950">
            {orders.map((o) => (
              <tr key={o._id}>
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selected.has(o._id)}
                    onChange={() => toggleOne(o._id)}
                    aria-label={`Select order ${o._id}`}
                  />
                </td>
                <td className="px-4 py-3 text-slate-300">{o.userId?.email ?? "—"}</td>
                <td className="px-4 py-3 text-slate-300">{o.serviceId?.name ?? "—"}</td>
                <td className="max-w-[160px] truncate px-4 py-3 text-slate-300">{o.target}</td>
                <td className="px-4 py-3 text-slate-300">{o.quantity}</td>
                <td className="px-4 py-3 text-slate-300">{o.charge}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={o.status} />
                </td>
                <td className="px-4 py-3">
                  {o.refillStatus === "REQUESTED" ? (
                    <div className="flex flex-col gap-1">
                      <span className="text-xs font-medium text-amber-400">Requested — needs action</span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={isPending && busyId === o._id}
                          onClick={() => resolveRefill(o._id, "COMPLETED")}
                          className="rounded border border-emerald-700 px-2 py-0.5 text-xs text-emerald-400 hover:bg-emerald-900/30 disabled:opacity-50"
                        >
                          Mark fulfilled
                        </button>
                        <button
                          type="button"
                          disabled={isPending && busyId === o._id}
                          onClick={() => resolveRefill(o._id, "REJECTED")}
                          className="rounded border border-red-700 px-2 py-0.5 text-xs text-red-400 hover:bg-red-900/30 disabled:opacity-50"
                        >
                          Decline
                        </button>
                      </div>
                    </div>
                  ) : (
                    <span className="text-xs text-slate-500">{o.refillStatus === "NONE" ? "—" : o.refillStatus}</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <select
                    disabled={isPending && busyId === o._id}
                    value={o.status}
                    onChange={(e) => updateStatus(o._id, e.target.value)}
                    className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white"
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
