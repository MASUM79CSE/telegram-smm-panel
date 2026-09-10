"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { ServiceProvidersPanel } from "@/components/admin/service-providers-panel";

interface CategoryOption {
  _id: string;
  name: string;
}
interface ProviderOption {
  _id: string;
  name: string;
  type: string;
}
interface ServiceRow {
  _id: string;
  name: string;
  rate: string;
  minQuantity: number;
  maxQuantity: number;
  active: boolean;
  refillDays: number | null;
  categoryId: { _id: string; name: string } | null;
  providerId: { _id: string; name: string } | null;
}

export function ServicesManager({
  services,
  categories,
  providers,
}: {
  services: ServiceRow[];
  categories: CategoryOption[];
  providers: ProviderOption[];
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    categoryId: categories[0]?._id ?? "",
    providerId: "",
    name: "",
    rate: "",
    minQuantity: "100",
    maxQuantity: "10000",
  });
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/admin/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryId: form.categoryId,
          providerId: form.providerId || null,
          name: form.name,
          rate: parseFloat(form.rate),
          minQuantity: parseInt(form.minQuantity, 10),
          maxQuantity: parseInt(form.maxQuantity, 10),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const detail = data?.details ? Object.values(data.details).flat().join(" ") : data.error;
        setError(detail || "Failed to create service");
        return;
      }
      setForm({ ...form, name: "", rate: "" });
      router.refresh();
    });
  }

  function toggleActive(id: string, active: boolean) {
    startTransition(async () => {
      await fetch(`/api/admin/services/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      });
      router.refresh();
    });
  }

  function updateRefillDays(id: string, raw: string) {
    const refillDays = raw.trim() === "" ? null : parseInt(raw, 10);
    if (refillDays !== null && (!Number.isFinite(refillDays) || refillDays < 0)) return;
    startTransition(async () => {
      await fetch(`/api/admin/services/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refillDays }),
      });
      router.refresh();
    });
  }

  function remove(id: string) {
    if (!confirm("Deactivate this service?")) return;
    startTransition(async () => {
      await fetch(`/api/admin/services/${id}`, { method: "DELETE" });
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleCreate} className="grid gap-4 rounded-xl border border-slate-800 bg-slate-950 p-6 md:grid-cols-3">
        <h3 className="font-semibold text-white md:col-span-3">New Service</h3>

        <div>
          <label className="mb-2 block text-sm text-slate-300">Category</label>
          <select
            value={form.categoryId}
            onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 p-2.5 text-white"
          >
            {categories.map((c) => (
              <option key={c._id} value={c._id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-2 block text-sm text-slate-300">Provider (optional, legacy single-provider)</label>
          <select
            value={form.providerId}
            onChange={(e) => setForm({ ...form, providerId: e.target.value })}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 p-2.5 text-white"
          >
            <option value="">— Manual / none —</option>
            {providers.map((p) => (
              <option key={p._id} value={p._id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-2 block text-sm text-slate-300">Name</label>
          <input
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 p-2.5 text-white"
          />
        </div>

        <div>
          <label className="mb-2 block text-sm text-slate-300">Rate per 1000</label>
          <input
            required
            type="number"
            step="0.0001"
            value={form.rate}
            onChange={(e) => setForm({ ...form, rate: e.target.value })}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 p-2.5 text-white"
          />
        </div>

        <div>
          <label className="mb-2 block text-sm text-slate-300">Min Quantity</label>
          <input
            required
            type="number"
            value={form.minQuantity}
            onChange={(e) => setForm({ ...form, minQuantity: e.target.value })}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 p-2.5 text-white"
          />
        </div>

        <div>
          <label className="mb-2 block text-sm text-slate-300">Max Quantity</label>
          <input
            required
            type="number"
            value={form.maxQuantity}
            onChange={(e) => setForm({ ...form, maxQuantity: e.target.value })}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 p-2.5 text-white"
          />
        </div>

        {error && <div className="rounded-lg bg-red-950 p-3 text-sm text-red-400 md:col-span-3">{error}</div>}

        <button
          disabled={isPending}
          className="rounded-lg bg-blue-600 px-6 py-2.5 font-medium text-white hover:bg-blue-500 disabled:opacity-50 md:col-span-3"
        >
          Create Service
        </button>
      </form>

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-900 text-slate-400">
            <tr>
              <th className="px-4 py-3"></th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Legacy Provider</th>
              <th className="px-4 py-3">Rate</th>
              <th className="px-4 py-3">Refill (days)</th>
              <th className="px-4 py-3">Active</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 bg-slate-950">
            {services.map((s) => (
              <Fragment key={s._id}>
                <tr>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setExpandedId(expandedId === s._id ? null : s._id)}
                      className="text-slate-400 hover:text-white"
                      aria-label="Toggle providers"
                    >
                      {expandedId === s._id ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-white">{s.name}</td>
                  <td className="px-4 py-3 text-slate-300">{s.categoryId?.name ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-300">{s.providerId?.name ?? "Manual"}</td>
                  <td className="px-4 py-3 text-slate-300">{s.rate}</td>
                  <td className="px-4 py-3">
                    <input
                      type="number"
                      min={0}
                      placeholder="Off"
                      defaultValue={s.refillDays ?? ""}
                      onBlur={(e) => updateRefillDays(s._id, e.target.value)}
                      className="w-20 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <input type="checkbox" checked={s.active} onChange={(e) => toggleActive(s._id, e.target.checked)} />
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => remove(s._id)} className="text-red-400 hover:text-red-300">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
                {expandedId === s._id && (
                  <tr>
                    <td colSpan={8} className="bg-slate-900/30 px-4 py-4">
                      <ServiceProvidersPanel serviceId={s._id} providers={providers} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
