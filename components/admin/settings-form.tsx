"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface SettingsData {
  siteName: string;
  siteDescription: string | null;
  supportEmail: string | null;
  minDeposit: number;
  maxDeposit: number;
  registrationEnabled: boolean;
  maintenanceMode: boolean;
}

export function SettingsForm({ settings }: { settings: SettingsData }) {
  const router = useRouter();
  const [form, setForm] = useState(settings);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function updateField<K extends keyof SettingsData>(key: K, value: SettingsData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);

    startTransition(async () => {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to save settings");
        return;
      }
      setMessage("Settings saved successfully.");
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-6 rounded-xl border border-slate-800 bg-slate-950 p-6">
      <div>
        <label className="mb-2 block text-sm text-slate-300">Site Name</label>
        <input
          value={form.siteName}
          onChange={(e) => updateField("siteName", e.target.value)}
          className="w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-white"
        />
      </div>

      <div>
        <label className="mb-2 block text-sm text-slate-300">Site Description</label>
        <textarea
          rows={3}
          value={form.siteDescription ?? ""}
          onChange={(e) => updateField("siteDescription", e.target.value)}
          className="w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-white"
        />
      </div>

      <div>
        <label className="mb-2 block text-sm text-slate-300">Support Email</label>
        <input
          type="email"
          value={form.supportEmail ?? ""}
          onChange={(e) => updateField("supportEmail", e.target.value)}
          className="w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-white"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-2 block text-sm text-slate-300">Min Deposit</label>
          <input
            type="number"
            value={form.minDeposit}
            onChange={(e) => updateField("minDeposit", parseFloat(e.target.value))}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-white"
          />
        </div>
        <div>
          <label className="mb-2 block text-sm text-slate-300">Max Deposit</label>
          <input
            type="number"
            value={form.maxDeposit}
            onChange={(e) => updateField("maxDeposit", parseFloat(e.target.value))}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-white"
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={form.registrationEnabled}
          onChange={(e) => updateField("registrationEnabled", e.target.checked)}
        />
        <label className="text-sm text-slate-300">Allow new registrations</label>
      </div>

      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={form.maintenanceMode}
          onChange={(e) => updateField("maintenanceMode", e.target.checked)}
        />
        <label className="text-sm text-slate-300">Maintenance mode</label>
      </div>

      {error && <div className="rounded-lg bg-red-950 p-3 text-sm text-red-400">{error}</div>}
      {message && <div className="rounded-lg bg-green-950 p-3 text-sm text-green-400">{message}</div>}

      <button
        disabled={isPending}
        className="rounded-lg bg-red-600 px-6 py-3 font-medium text-white hover:bg-red-500 disabled:opacity-50"
      >
        {isPending ? "Saving..." : "Save Settings"}
      </button>
    </form>
  );
}
