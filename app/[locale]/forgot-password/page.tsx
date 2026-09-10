"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { AuthShell } from "@/components/auth/auth-shell";

export default function ForgotPasswordPage() {
  const t = useTranslations("Auth.forgotPassword");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await fetch("/api/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      setMessage(data.message || data.error);
    });
  }

  return (
    <AuthShell>
      <h1 className="text-center text-2xl font-bold text-white">{t("title")}</h1>
      <p className="mt-1 text-center text-sm text-slate-400">{t("subtitle")}</p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-5">
        <div>
          <label className="mb-2 block text-sm text-slate-300">{t("email")}</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-white outline-none focus:border-blue-500"
            placeholder="you@example.com"
          />
        </div>

        {message && <div className="rounded-lg bg-slate-800 p-3 text-sm text-slate-300">{message}</div>}

        <button
          disabled={isPending}
          className="w-full rounded-lg bg-blue-600 py-3 font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {isPending ? t("submitting") : t("submit")}
        </button>

        <p className="text-center text-sm text-slate-400">
          <Link href="/login" className="font-medium text-blue-400 hover:text-blue-300">
            {t("backToLogin")}
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
