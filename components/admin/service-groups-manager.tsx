"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

interface ServiceGroupRow {
  _id: string;
  name: string;
  icon: string | null;
  active: boolean;
}

export function ServiceGroupsManager({ groups }: { groups: ServiceGroupRow[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/admin/service-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, icon: icon || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create service group");
        return;
      }
      setName("");
      setIcon("");
      router.refresh();
    });
  }

  function toggleActive(id: string, active: boolean) {
    startTransition(async () => {
      await fetch(`/api/admin/service-groups/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      });
      router.refresh();
    });
  }

  function remove(id: string) {
    if (!confirm("Delete this group? This only works if no categories belong to it.")) return;
    startTransition(async () => {
      const res = await fetch(`/api/admin/service-groups/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <form onSubmit={handleCreate} className="space-y-4 rounded-xl border border-slate-800 bg-slate-950 p-6 lg:col-span-1">
        <h3 className="font-semibold text-white">New Service Group</h3>
        <div>
          <label className="mb-2 block text-sm text-slate-300">Name</label>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. 🚀 Telegram Boost"
            className="w-full rounded-lg border border-slate-700 bg-slate-900 p-2.5 text-white outline-none focus:border-blue-500"
          />
        </div>
        <div>
          <label className="mb-2 block text-sm text-slate-300">Icon (emoji, optional)</label>
          <input
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            placeholder="🚀"
            maxLength={20}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 p-2.5 text-white outline-none focus:border-blue-500"
          />
        </div>
        {error && <div className="rounded-lg bg-red-950 p-3 text-sm text-red-400">{error}</div>}
        <button
          disabled={isPending}
          className="w-full rounded-lg bg-blue-600 py-2.5 font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          Create
        </button>
      </form>

      <div className="lg:col-span-2">
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-900 text-slate-400">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Active</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 bg-slate-950">
              {groups.map((g) => (
                <tr key={g._id}>
                  <td className="px-4 py-3 text-white">
                    {g.icon ? `${g.icon} ` : ""}
                    {g.name}
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={g.active}
                      onChange={(e) => toggleActive(g._id, e.target.checked)}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => remove(g._id)} className="text-red-400 hover:text-red-300">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {groups.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-slate-500">
                    No service groups yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
