"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/dashboard/status-badge";

interface UserRow {
  _id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  createdAt: string;
}

const BULK_STATUS_OPTIONS = ["ACTIVE", "SUSPENDED", "BANNED"] as const;

export function UsersTable({ users, currentUserId }: { users: UserRow[]; currentUserId?: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkStatus, setBulkStatus] = useState<(typeof BULK_STATUS_OPTIONS)[number]>("SUSPENDED");

  // Never allow selecting the acting admin's own row for a bulk status
  // change — mirrors the self-modification guard already enforced
  // server-side in app/api/admin/users/[id]/route.ts.
  const selectableUsers = users.filter((u) => u._id !== currentUserId);
  const allOnPageSelected = selectableUsers.length > 0 && selectableUsers.every((u) => selected.has(u._id));

  function toggleAll() {
    setSelected(allOnPageSelected ? new Set() : new Set(selectableUsers.map((u) => u._id)));
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function updateUser(id: string, patch: Record<string, string>) {
    setBusyId(id);
    startTransition(async () => {
      await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      setBusyId(null);
      router.refresh();
    });
  }

  /**
   * Bulk status change loops the EXISTING single-user PATCH endpoint per
   * selected id, one request each — deliberately not a new bulk-mutation
   * server route. This reuses that route's own validation and
   * self-modification guard unchanged, and each call still produces its
   * own USER_STATUS_CHANGE audit row (more traceable than one combined
   * "bulk" entry). See docs/DASHBOARD_UPGRADE_PLAN.md §2.3 and
   * lib/services/admin-bulk.ts's doc comment for the rationale shared with
   * the Payments bulk-approve flow.
   */
  function applyBulkStatus() {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!confirm(`Set ${ids.length} user(s) to ${bulkStatus}?`)) return;

    setBulkBusy(true);
    startTransition(async () => {
      const results = await Promise.allSettled(
        ids.map((id) =>
          fetch(`/api/admin/users/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: bulkStatus }),
          }).then((res) => ({ id, ok: res.ok }))
        )
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
          <select
            disabled={bulkBusy}
            value={bulkStatus}
            onChange={(e) => setBulkStatus(e.target.value as (typeof BULK_STATUS_OPTIONS)[number])}
            aria-label="Bulk status to apply to selected users"
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
                  aria-label="Select all users on this page"
                />
              </th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Joined</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 bg-slate-950">
            {users.map((u) => (
              <tr key={u._id}>
                <td className="px-4 py-3">
                  {u._id !== currentUserId && (
                    <input
                      type="checkbox"
                      checked={selected.has(u._id)}
                      onChange={() => toggleOne(u._id)}
                      aria-label={`Select user ${u._id}`}
                    />
                  )}
                </td>
                <td className="px-4 py-3 text-white">{u.name}</td>
                <td className="px-4 py-3 text-slate-300">{u.email}</td>
                <td className="px-4 py-3 text-slate-300">{u.role}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={u.status} />
                </td>
                <td className="px-4 py-3 text-slate-500">{new Date(u.createdAt).toLocaleDateString()}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <select
                      disabled={isPending && busyId === u._id}
                      value={u.status}
                      onChange={(e) => updateUser(u._id, { status: e.target.value })}
                      className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white"
                    >
                      <option value="ACTIVE">Active</option>
                      <option value="SUSPENDED">Suspended</option>
                      <option value="BANNED">Banned</option>
                    </select>
                    <select
                      disabled={isPending && busyId === u._id}
                      value={u.role}
                      onChange={(e) => updateUser(u._id, { role: e.target.value })}
                      className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white"
                    >
                      <option value="USER">User</option>
                      <option value="ADMIN">Admin</option>
                    </select>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
