"use client";

import { useState, useTransition } from "react";
import { signIn } from "next-auth/react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter, Link, getPathname } from "@/i18n/navigation";

export function LoginForm() {
  const router = useRouter();
  const t = useTranslations("Auth.login");
  const locale = useLocale();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const res = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (res?.error) {
        setError(t("error"));
        return;
      }

      router.push(getPathname({ href: "/dashboard", locale }));
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
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
        <div className="mb-2 flex items-center justify-between">
          <label className="text-sm text-slate-300">{t("password")}</label>
          <Link href="/forgot-password" className="text-xs text-blue-400 hover:text-blue-300">
            {t("forgotPassword")}
          </Link>
        </div>
        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-white outline-none focus:border-blue-500"
          placeholder="••••••••••"
        />
      </div>

      {error && <div className="rounded-lg bg-red-950 p-3 text-sm text-red-400">{error}</div>}

      <button
        disabled={isPending}
        className="w-full rounded-lg bg-blue-600 py-3 font-medium text-white hover:bg-blue-500 disabled:opacity-50"
      >
        {isPending ? t("submitting") : t("submit")}
      </button>

      <p className="text-center text-sm text-slate-400">
        {t("noAccount")}{" "}
        <Link href="/register" className="font-medium text-blue-400 hover:text-blue-300">
          {t("register")}
        </Link>
      </p>
    </form>
  );
}
