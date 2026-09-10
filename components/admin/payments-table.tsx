"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Check, X } from "lucide-react";

interface PaymentRow {
  _id: string;
  amount: string;
  method: string;
  transactionRef: string | null;
  status: string;
  createdAt: string;
  userId: { name?: string; email?: string } | null;
}

export function PaymentsTable({ payments }: { payments: PaymentRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  // Only PENDING payments are eligible for (bulk-)approve — mirrors the
  // per-row action bar, which already only shows Approve/Reject for
  // PENDING rows.
  const pendingPayments = payments.filter((p) => p.status === "PENDING");
  const allPendingSelected = pendingPayments.length > 0 && pendingPayments.every((p) => selected.has(p._id));

  function toggleAll() {
    setSelected(allPendingSelected ? new Set() : new Set(pendingPayments.map((p) => p._id)));
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function approve(id: string) {
    if (!confirm("Approve this payment and credit the user's wallet?")) return;
    setBusyId(id);
    startTransition(async () => {
      const res = await fetch(`/api/admin/payments/${id}/approve`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) alert(data.error);
      setBusyId(null);
      router.refresh();
    });
  }

  function reject(id: string) {
    const reason = prompt("Reason for rejection (optional):") ?? undefined;
    setBusyId(id);
    startTransition(async () => {
      const res = await fetch(`/api/admin/payments/${id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const data = await res.json();
      if (!res.ok) alert(data.error);
      setBusyId(null);
      router.refresh();
    });
  }

  /**
   * Bulk approve loops the EXISTING single-payment approve endpoint
   * (`POST /api/admin/payments/[id]/approve`) per selected id — this is
   * the money-adjacent path, so it deliberately does NOT introduce any new
   * bulk-transaction server code. Each call still runs the existing
   * `approveDeposit()` atomic transaction (wallet credit + ledger entry +
   * optimistic-concurrency claim) independently, exactly as a single-row
   * approve does today, and each still records its own PAYMENT_APPROVED
   * audit row. See docs/DASHBOARD_UPGRADE_PLAN.md §2.3 and
   * lib/services/admin-bulk.ts's doc comment for the full rationale.
   */
  function applyBulkApprove() {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!confirm(`Approve ${ids.length} payment(s) and credit each user's wallet?`)) return;

    setBulkBusy(true);
    startTransition(async () => {
      const results = await Promise.allSettled(
        ids.map((id) => fetch(`/api/admin/payments/${id}/approve`, { method: "POST" }).then((res) => ({ id, ok: res.ok })))
      );
      const failed = results.filter((r) => r.status === "rejected" || !r.value.ok);
      if (failed.length) {
        alert(`${ids.length - failed.length} succeeded, ${failed.length} failed.`);
      }
      setBulkBusy(false);
      setSelected(new Set());
      router.refresh();
    });
  }

  const selectedCount = selected.size;

  return (
    <div className="space-y-3">
      {selectedCount > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-sm">
          <span className="text-slate-300">{selectedCount} selected</span>
          <button
            type="button"
            disabled={bulkBusy}
            onClick={applyBulkApprove}
            className="rounded bg-green-700 px-3 py-1 text-xs font-medium text-white hover:bg-green-600 disabled:opacity-50"
          >
            Approve selected
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
                  checked={allPendingSelected}
                  onChange={toggleAll}
                  aria-label="Select all pending payments on this page"
                />
              </th>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Amount</th>
              <th className="px-4 py-3">Method</th>
              <th className="px-4 py-3">Reference</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 bg-slate-950">
            {payments.map((p) => (
              <tr key={p._id}>
                <td className="px-4 py-3">
                  {p.status === "PENDING" && (
                    <input
                      type="checkbox"
                      checked={selected.has(p._id)}
                      onChange={() => toggleOne(p._id)}
                      aria-label={`Select payment ${p._id}`}
                    />
                  )}
                </td>
                <td className="px-4 py-3 text-slate-300">{p.userId?.email ?? "—"}</td>
                <td className="px-4 py-3 text-slate-300">{p.amount}</td>
                <td className="px-4 py-3 text-slate-300">{p.method}</td>
                <td className="px-4 py-3 text-slate-300">{p.transactionRef ?? "—"}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={p.status} />
                </td>
                <td className="px-4 py-3">
                  {p.status === "PENDING" && (
                    <div className="flex gap-2">
                      <button
                        disabled={isPending && busyId === p._id}
                        onClick={() => approve(p._id)}
                        className="rounded bg-green-700 p-1.5 text-white hover:bg-green-600"
                        title="Approve"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                      <button
                        disabled={isPending && busyId === p._id}
                        onClick={() => reject(p._id)}
                        className="rounded bg-red-800 p-1.5 text-white hover:bg-red-700"
                        title="Reject"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
