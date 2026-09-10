"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

interface ProviderRow {
  _id: string;
  name: string;
  type: string;
  status: string;
  apiUrl: string | null;
}

export function ProvidersManager({ providers }: { providers: ProviderRow[] }) {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", type: "MANUAL", apiUrl: "", apiKey: "", notes: "" });
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/admin/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          type: form.type,
          apiUrl: form.apiUrl || null,
          apiKey: form.apiKey || null,
          notes: form.notes || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const detail = data?.details ? Object.values(data.details).flat().join(" ") : data.error;
        setError(detail || "Failed to create provider");
        return;
      }
      setForm({ name: "", type: "MANUAL", apiUrl: "", apiKey: "", notes: "" });
      router.refresh();
    });
  }

  function remove(id: string) {
    if (!confirm("Delete this provider? Only works if no services reference it.")) return;
    startTransition(async () => {
      const res = await fetch(`/api/admin/providers/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleCreate} className="grid gap-4 rounded-xl border border-slate-800 bg-slate-950 p-6 md:grid-cols-2">
        <h3 className="font-semibold text-white md:col-span-2">New Provider</h3>

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
          <label className="mb-2 block text-sm text-slate-300">Type</label>
          <select
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 p-2.5 text-white"
          >
            <option value="MANUAL">Manual (admin-fulfilled)</option>
            <option value="API">API (upstream provider)</option>
            <option value="INTERNAL">Internal automation</option>
          </select>
        </div>

        {form.type === "API" && (
          <>
            <div>
              <label className="mb-2 block text-sm text-slate-300">API URL</label>
              <input
                value={form.apiUrl}
                onChange={(e) => setForm({ ...form, apiUrl: e.target.value })}
                placeholder="https://provider.com/api/v2"
                className="w-full rounded-lg border border-slate-700 bg-slate-900 p-2.5 text-white"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm text-slate-300">API Key</label>
              <input
                type="password"
                value={form.apiKey}
                onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 p-2.5 text-white"
              />
              <p className="mt-1 text-xs text-slate-500">Encrypted at rest (AES-256-GCM). Never displayed after saving.</p>
            </div>
          </>
        )}

        <div className="md:col-span-2">
          <label className="mb-2 block text-sm text-slate-300">Notes</label>
          <textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            rows={2}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 p-2.5 text-white"
          />
        </div>

        {error && <div className="rounded-lg bg-red-950 p-3 text-sm text-red-400 md:col-span-2">{error}</div>}

        <button
          disabled={isPending}
          className="rounded-lg bg-blue-600 px-6 py-2.5 font-medium text-white hover:bg-blue-500 disabled:opacity-50 md:col-span-2"
        >
          Create Provider
        </button>
      </form>

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-900 text-slate-400">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 bg-slate-950">
            {providers.map((p) => (
              <tr key={p._id}>
                <td className="px-4 py-3 text-white">{p.name}</td>
                <td className="px-4 py-3 text-slate-300">{p.type}</td>
                <td className="px-4 py-3 text-slate-300">{p.status}</td>
                <td className="px-4 py-3">
                  <button onClick={() => remove(p._id)} className="text-red-400 hover:text-red-300">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
