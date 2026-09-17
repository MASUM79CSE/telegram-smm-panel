"use client";

import { useState, useTransition, useEffect, useCallback, Fragment } from "react";
import { getAuditActionMeta, AUDIT_CATEGORY_COLORS } from "@/lib/audit-labels";
import type { AuditAction } from "@/lib/generated/prisma";

interface AuditEntry {
  _id: string;
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: unknown;
  ip: string | null;
  createdAt: string;
}

const ALL_ACTIONS: AuditAction[] = [
  "USER_ROLE_CHANGE",
  "USER_STATUS_CHANGE",
  "PAYMENT_APPROVED",
  "PAYMENT_REJECTED",
  "ORDER_STATUS_CHANGE",
  "ORDER_BULK_STATUS_CHANGE",
  "ORDER_REFUNDED",
  "SERVICE_CREATED",
  "SERVICE_UPDATED",
  "SERVICE_DELETED",
  "CATEGORY_CREATED",
  "CATEGORY_UPDATED",
  "CATEGORY_DELETED",
  "SERVICE_GROUP_CREATED",
  "SERVICE_GROUP_UPDATED",
  "SERVICE_GROUP_DELETED",
  "PROVIDER_CREATED",
  "PROVIDER_UPDATED",
  "PROVIDER_DELETED",
  "SERVICE_PROVIDER_LINK_CREATED",
  "SERVICE_PROVIDER_LINK_UPDATED",
  "SERVICE_PROVIDER_LINK_DELETED",
  "SERVICE_PROVIDER_BACKFILL_RUN",
  "API_KEY_CREATED",
  "API_KEY_REVOKED",
  "ORDER_REFILL_REQUESTED",
  "ORDER_REFILL_RESOLVED",
  "ORDER_PARTIAL_REFUND_ISSUED",
  "SETTINGS_UPDATED",
  "WALLET_ADJUSTMENT",
  "LOGIN_SUCCESS",
  "LOGIN_FAILED",
  "PASSWORD_RESET",
  "TELEGRAM_LINKED",
  "TELEGRAM_UNLINKED",
  "TELEGRAM_BOT_ORDER_PLACED",
  "TELEGRAM_BOT_DEPOSIT_SUBMITTED",
  "TELEGRAM_BOT_ADMIN_ACTION",
  "ACCOUNT_UPDATED",
  "PASSWORD_CHANGED_BY_USER",
  "FAVORITE_SERVICE_ADDED",
  "FAVORITE_SERVICE_REMOVED",
  "DATA_EXPORTED",
];

export function AuditLogViewer({
  initialEntries,
  initialTotal,
  limit,
}: {
  initialEntries: AuditEntry[];
  initialTotal: number;
  limit: number;
}) {
  const [entries, setEntries] = useState(initialEntries);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const [actorEmail, setActorEmail] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const fetchPage = useCallback(
    (nextPage: number, nextAction: string, nextActorEmail: string) => {
      startTransition(async () => {
        const params = new URLSearchParams({ page: String(nextPage), limit: String(limit) });
        if (nextAction) params.set("action", nextAction);
        if (nextActorEmail) params.set("actorEmail", nextActorEmail);

        const res = await fetch(`/api/admin/audit-log?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          setEntries(data.entries);
          setTotal(data.total);
        }
      });
    },
    [limit]
  );

  useEffect(() => {
    const timeout = setTimeout(() => {
      setPage(1);
      fetchPage(1, action, actorEmail);
    }, 300);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, actorEmail]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  function goToPage(p: number) {
    setPage(p);
    fetchPage(p, action, actorEmail);
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-3">
        <input
          type="text"
          value={actorEmail}
          onChange={(e) => setActorEmail(e.target.value)}
          placeholder="Search by actor email…"
          className="w-64 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
        />
        <select
          value={action}
          onChange={(e) => setAction(e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
        >
          <option value="">All actions</option>
          {ALL_ACTIONS.map((a) => (
            <option key={a} value={a}>
              {getAuditActionMeta(a).label}
            </option>
          ))}
        </select>
        {isPending && <span className="self-center text-xs text-slate-500">Loading…</span>}
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-900 text-slate-400">
            <tr>
              <th className="px-4 py-3">Time</th>
              <th className="px-4 py-3">Actor</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Target</th>
              <th className="px-4 py-3">IP</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 bg-slate-950">
            {entries.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                  No matching audit entries.
                </td>
              </tr>
            )}
            {entries.map((e) => {
              const meta = getAuditActionMeta(e.action);
              const expanded = expandedId === e._id;
              return (
                <Fragment key={e._id}>
                  <tr className="text-slate-300">
                    <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                      {new Date(e.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">{e.actorEmail ?? "System"}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${AUDIT_CATEGORY_COLORS[meta.category]}`}>
                        {meta.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {e.targetType ? `${e.targetType}${e.targetId ? ` #${e.targetId.slice(-6)}` : ""}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{e.ip ?? "—"}</td>
                    <td className="px-4 py-3 text-right">
                      {e.metadata !== null && e.metadata !== undefined ? (
                        <button
                          onClick={() => setExpandedId(expanded ? null : e._id)}
                          className="text-xs text-blue-400 hover:underline"
                        >
                          {expanded ? "Hide" : "Details"}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                  {expanded && (
                    <tr>
                      <td colSpan={6} className="bg-slate-900/50 px-4 py-3">
                        <pre className="overflow-x-auto text-xs text-slate-400">
                          {JSON.stringify(e.metadata, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-slate-400">
          <span>
            Page {page} of {totalPages} ({total} entries)
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => goToPage(Math.max(1, page - 1))}
              disabled={page === 1 || isPending}
              className="rounded border border-slate-700 px-3 py-1 disabled:opacity-40"
            >
              Previous
            </button>
            <button
              onClick={() => goToPage(Math.min(totalPages, page + 1))}
              disabled={page === totalPages || isPending}
              className="rounded border border-slate-700 px-3 py-1 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
