"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

interface CategoryRow {
  _id: string;
  name: string;
  description: string | null;
  groupId: string | null;
  active: boolean;
}

interface GroupOption {
  _id: string;
  name: string;
}

export function CategoriesManager({
  categories,
  groups,
}: {
  categories: CategoryRow[];
  groups: GroupOption[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [groupId, setGroupId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/admin/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description: description || null, groupId: groupId || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create category");
        return;
      }
      setName("");
      setDescription("");
      setGroupId("");
      router.refresh();
    });
  }

  function toggleActive(id: string, active: boolean) {
    startTransition(async () => {
      await fetch(`/api/admin/categories/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      });
      router.refresh();
    });
  }

  function updateGroup(id: string, newGroupId: string) {
    startTransition(async () => {
      const res = await fetch(`/api/admin/categories/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId: newGroupId || null }),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Failed to update group");
      }
      router.refresh();
    });
  }

  function remove(id: string) {
    if (!confirm("Delete this category? This only works if no services use it.")) return;
    startTransition(async () => {
      const res = await fetch(`/api/admin/categories/${id}`, { method: "DELETE" });
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
        <h3 className="font-semibold text-white">New Category</h3>
        <div>
          <label className="mb-2 block text-sm text-slate-300">Name</label>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 p-2.5 text-white outline-none focus:border-blue-500"
          />
        </div>
        <div>
          <label className="mb-2 block text-sm text-slate-300">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 p-2.5 text-white outline-none focus:border-blue-500"
          />
        </div>
        <div>
          <label className="mb-2 block text-sm text-slate-300">Service Group (optional)</label>
          <select
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 p-2.5 text-white outline-none focus:border-blue-500"
          >
            <option value="">— No group —</option>
            {groups.map((g) => (
              <option key={g._id} value={g._id}>
                {g.name}
              </option>
            ))}
          </select>
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
                <th className="px-4 py-3">Group</th>
                <th className="px-4 py-3">Active</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 bg-slate-950">
              {categories.map((c) => (
                <tr key={c._id}>
                  <td className="px-4 py-3 text-white">{c.name}</td>
                  <td className="px-4 py-3">
                    <select
                      value={c.groupId ?? ""}
                      onChange={(e) => updateGroup(c._id, e.target.value)}
                      className="rounded-lg border border-slate-700 bg-slate-900 p-1.5 text-sm text-white outline-none focus:border-blue-500"
                    >
                      <option value="">— No group —</option>
                      {groups.map((g) => (
                        <option key={g._id} value={g._id}>
                          {g.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={c.active}
                      onChange={(e) => toggleActive(c._id, e.target.checked)}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => remove(c._id)} className="text-red-400 hover:text-red-300">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
