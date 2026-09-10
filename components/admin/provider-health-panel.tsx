import { AlertTriangle, CheckCircle2, Clock, Activity } from "lucide-react";
import type { ProviderHealth } from "@/lib/services/analytics";

/**
 * Read-only provider health surfacing (docs/DASHBOARD_UPGRADE_PLAN.md §2.6).
 * Purely a display layer over `getProviderHealthSummary()` — no new
 * balance-sync mechanism, no new mutation. Deliberately a Server Component
 * (no "use client") since it renders once per page load with server-fetched
 * data and has no interactivity of its own.
 */
export function ProviderHealthPanel({ health }: { health: ProviderHealth[] }) {
  if (health.length === 0) return null;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
      <div className="mb-4 flex items-center gap-2">
        <Activity className="h-5 w-5 text-slate-400" />
        <h2 className="font-semibold text-white">Provider Health</h2>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {health.map((p) => (
          <div key={p.providerId} className="rounded-lg border border-slate-800 bg-slate-950 p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="font-medium text-white">{p.name}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  p.status === "ACTIVE" ? "bg-green-950 text-green-400" : "bg-slate-800 text-slate-400"
                }`}
              >
                {p.status}
              </span>
            </div>

            <dl className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <dt className="text-slate-500">Type</dt>
                <dd className="text-slate-300">{p.type}</dd>
              </div>

              <div className="flex items-center justify-between">
                <dt className="text-slate-500">Orders (24h)</dt>
                <dd className="text-slate-300">{p.ordersLast24h}</dd>
              </div>

              {p.type !== "MANUAL" && (
                <div className="flex items-center justify-between">
                  <dt className="flex items-center gap-1 text-slate-500">
                    <Clock className="h-3 w-3" />
                    Balance
                  </dt>
                  <dd className="flex items-center gap-1.5 text-slate-300">
                    {p.balance ?? "—"}
                    {p.balanceStale && (
                      <span title="Balance not synced in over 24h" className="text-amber-500">
                        <AlertTriangle className="h-3.5 w-3.5" />
                      </span>
                    )}
                  </dd>
                </div>
              )}

              <div className="flex items-start justify-between gap-2 border-t border-slate-800 pt-2">
                <dt className="shrink-0 text-slate-500">Last error</dt>
                {p.lastError ? (
                  <dd className="text-right text-red-400" title={p.lastError}>
                    <span className="line-clamp-2">{p.lastError}</span>
                    {p.lastErrorAt && (
                      <div className="mt-0.5 text-[10px] text-slate-600">
                        {new Date(p.lastErrorAt).toLocaleString()}
                      </div>
                    )}
                  </dd>
                ) : (
                  <dd className="flex items-center gap-1 text-green-500">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    None
                  </dd>
                )}
              </div>
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
}
