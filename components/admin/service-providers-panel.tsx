"use client";

import { useEffect, useState, useTransition } from "react";
import { Trash2 } from "lucide-react";

interface ProviderOption {
  _id: string;
  name: string;
  type: string;
}

interface ProviderLink {
  _id: string;
  providerServiceId: string;
  providerRate: string;
  priority: number;
  active: boolean;
  providerId: { _id: string; name: string; type: string; status: string } | null;
}

/**
 * Per-service provider-priority management (docs/IMPLEMENTATION_PLAN.md
 * Phase 2.1) — expandable panel under a service row in
 * `components/admin/services-manager.tsx`. Lets an admin link multiple
 * `Provider`s to one `Service` with a fallback priority order, instead of
 * the single legacy `Service.providerId` field.
 */
export function ServiceProvidersPanel({
  serviceId,
  providers,
}: {
  serviceId: string;
  providers: ProviderOption[];
}) {
  const [links, setLinks] = useState<ProviderLink[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState({
    providerId: providers[0]?._id ?? "",
    providerServiceId: "",
    providerRate: "",
    priority: "0",
  });

  function load() {
    fetch(`/api/admin/services/${serviceId}/providers`)
      .then((res) => res.json())
      .then((data) => setLinks(data.links ?? []))
      .catch(() => setError("Failed to load provider links"));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceId]);

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/admin/services/${serviceId}/providers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId: form.providerId,
          providerServiceId: form.providerServiceId,
          providerRate: parseFloat(form.providerRate),
          priority: parseInt(form.priority, 10),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const detail = data?.details ? Object.values(data.details).flat().join(" ") : data.error;
        setError(detail || "Failed to link provider");
        return;
      }
      setForm({ ...form, providerServiceId: "", providerRate: "" });
      load();
    });
  }

  function updatePriority(linkId: string, priority: number) {
    startTransition(async () => {
      await fetch(`/api/admin/services/${serviceId}/providers/${linkId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority }),
      });
      load();
    });
  }

  function toggleActive(linkId: string, active: boolean) {
    startTransition(async () => {
      await fetch(`/api/admin/services/${serviceId}/providers/${linkId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      });
      load();
    });
  }

  function remove(linkId: string) {
    if (!confirm("Remove this provider link?")) return;
    startTransition(async () => {
      await fetch(`/api/admin/services/${serviceId}/providers/${linkId}`, { method: "DELETE" });
      load();
    });
  }

  return (
    <div className="space-y-4 rounded-lg border border-slate-800 bg-slate-900/50 p-4">
      <p className="text-xs text-slate-400">
        Providers are tried in priority order (lowest first). If one fails during dispatch, the
        next is tried automatically within the same attempt.
      </p>

      {error && <div className="rounded-lg bg-red-950 p-2 text-xs text-red-400">{error}</div>}

      {links === null ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : links.length === 0 ? (
        <p className="text-sm text-slate-500">
          No providers linked yet — this service falls back to its legacy single-provider field
          (if any) or requires manual fulfillment.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950 text-slate-500">
              <tr>
                <th className="px-3 py-2">Priority</th>
                <th className="px-3 py-2">Provider</th>
                <th className="px-3 py-2">Provider Service ID</th>
                <th className="px-3 py-2">Provider Rate</th>
                <th className="px-3 py-2">Active</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {links.map((link) => (
                <tr key={link._id}>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      value={link.priority}
                      onChange={(e) => updatePriority(link._id, parseInt(e.target.value, 10) || 0)}
                      className="w-16 rounded border border-slate-700 bg-slate-900 p-1 text-white"
                    />
                  </td>
                  <td className="px-3 py-2 text-slate-200">
                    {link.providerId?.name ?? "(deleted provider)"}{" "}
                    <span className="text-slate-500">({link.providerId?.type})</span>
                  </td>
                  <td className="px-3 py-2 text-slate-300">{link.providerServiceId}</td>
                  <td className="px-3 py-2 text-slate-300">{link.providerRate}</td>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={link.active}
                      onChange={(e) => toggleActive(link._id, e.target.checked)}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <button onClick={() => remove(link._id)} className="text-red-400 hover:text-red-300">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form onSubmit={handleAdd} className="grid gap-3 sm:grid-cols-4">
        <select
          value={form.providerId}
          onChange={(e) => setForm({ ...form, providerId: e.target.value })}
          className="rounded-lg border border-slate-700 bg-slate-900 p-2 text-xs text-white"
        >
          {providers.map((p) => (
            <option key={p._id} value={p._id}>
              {p.name} ({p.type})
            </option>
          ))}
        </select>
        <input
          required
          placeholder="Provider's service ID"
          value={form.providerServiceId}
          onChange={(e) => setForm({ ...form, providerServiceId: e.target.value })}
          className="rounded-lg border border-slate-700 bg-slate-900 p-2 text-xs text-white"
        />
        <input
          required
          type="number"
          step="0.0001"
          placeholder="Provider rate /1000"
          value={form.providerRate}
          onChange={(e) => setForm({ ...form, providerRate: e.target.value })}
          className="rounded-lg border border-slate-700 bg-slate-900 p-2 text-xs text-white"
        />
        <button
          disabled={isPending || providers.length === 0}
          className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          Link provider
        </button>
      </form>
      {providers.length === 0 && (
        <p className="text-xs text-amber-400">Create a Provider first (Admin → Providers) before linking one here.</p>
      )}
    </div>
  );
}
