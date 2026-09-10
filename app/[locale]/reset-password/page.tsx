"use client";

import { useState, Suspense, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { useRouter, Link, getPathname } from "@/i18n/navigation";
import { AuthShell } from "@/components/auth/auth-shell";

function ResetPasswordContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const t = useTranslations("Auth.resetPassword");
  const locale = useLocale();
  const token = searchParams.get("token") || "";

  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const res = await fetch("/api/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        const detail = data?.details ? Object.values(data.details).flat().join(" ") : data.error;
        setError(detail || t("errorFallback"));
        return;
      }

      setSuccess(true);
      setTimeout(() => router.push(getPathname({ href: "/login", locale })), 2000);
    });
  }

  if (!token) {
    return <p className="text-center text-red-400">{t("missingToken")}</p>;
  }

  if (success) {
    return <p className="text-center text-green-400">{t("success")}</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label className="mb-2 block text-sm text-slate-300">{t("newPassword")}</label>
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-white outline-none focus:border-blue-500"
          placeholder="••••••••••"
        />
        <p className="mt-2 text-xs text-slate-500">{t("passwordHint")}</p>
      </div>

      {error && <div className="rounded-lg bg-red-950 p-3 text-sm text-red-400">{error}</div>}

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
  );
}

export default function ResetPasswordPage() {
  const t = useTranslations("Auth.resetPassword");
  return (
    <AuthShell>
      <h1 className="text-center text-2xl font-bold text-white">{t("title")}</h1>
      <div className="mt-8">
        <Suspense>
          <ResetPasswordContent />
        </Suspense>
      </div>
    </AuthShell>
  );
}
