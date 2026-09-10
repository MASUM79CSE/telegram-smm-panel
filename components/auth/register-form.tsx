"use client";

import { useState, useTransition } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter, Link, getPathname } from "@/i18n/navigation";

export function RegisterForm() {
  const router = useRouter();
  const t = useTranslations("Auth.register");
  const locale = useLocale();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      try {
        const res = await fetch("/api/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, email, password }),
        });

        const data = await res.json();

        if (!res.ok) {
          const detail = data?.details ? Object.values(data.details).flat().join(" ") : data.error;
          setError(detail || t("errorFallback"));
          return;
        }

        setSuccess(true);
        setTimeout(() => router.push(getPathname({ href: "/login", locale })), 2500);
      } catch {
        setError(t("errorGeneric"));
      }
    });
  }

  if (success) {
    return <div className="rounded-lg bg-green-950 p-4 text-sm text-green-400">{t("success")}</div>;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label className="mb-2 block text-sm text-slate-300">{t("fullName")}</label>
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-white outline-none focus:border-blue-500"
          placeholder="John Doe"
        />
      </div>

      <div>
        <label className="mb-2 block text-sm text-slate-300">{t("email")}</label>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-white outline-none focus:border-blue-500"
          placeholder="you@example.com"
        />
      </div>

      <div>
        <label className="mb-2 block text-sm text-slate-300">{t("password")}</label>
        <input
          type="password"
          required
          autoComplete="new-password"
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
        {t("haveAccount")}{" "}
        <Link href="/login" className="font-medium text-blue-400 hover:text-blue-300">
          {t("signIn")}
        </Link>
      </p>
    </form>
  );
}
