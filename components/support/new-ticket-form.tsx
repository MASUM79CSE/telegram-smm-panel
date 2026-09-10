"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";

export function NewTicketForm() {
  const router = useRouter();
  const t = useTranslations("NewTicketForm");
  const tPriority = useTranslations("TicketPriority");
  const [subject, setSubject] = useState("");
  const [priority, setPriority] = useState("MEDIUM");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const res = await fetch("/api/support/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, priority, message }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || t("errorFallback"));
        return;
      }

      router.push(`/dashboard/support/${data.ticket._id}`);
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 rounded-xl border border-slate-800 bg-slate-950 p-6">
      <div>
        <label className="mb-2 block text-sm text-slate-300">{t("subjectLabel")}</label>
        <input
          required
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder={t("subjectPlaceholder")}
          className="w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-white outline-none focus:border-blue-500"
        />
      </div>

      <div>
        <label className="mb-2 block text-sm text-slate-300">{t("priorityLabel")}</label>
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          className="w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-white"
        >
          <option value="LOW">{tPriority("LOW")}</option>
          <option value="MEDIUM">{tPriority("MEDIUM")}</option>
          <option value="HIGH">{tPriority("HIGH")}</option>
        </select>
      </div>

      <div>
        <label className="mb-2 block text-sm text-slate-300">{t("messageLabel")}</label>
        <textarea
          required
          rows={8}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={t("messagePlaceholder")}
          className="w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-white outline-none focus:border-blue-500"
        />
      </div>

      {error && <div className="rounded-lg bg-red-950 p-3 text-sm text-red-400">{error}</div>}

      <button
        disabled={isPending}
        className="w-full rounded-lg bg-blue-600 py-3 font-medium text-white hover:bg-blue-500 disabled:opacity-50"
      >
        {isPending ? t("submitting") : t("submit")}
      </button>
    </form>
  );
}
