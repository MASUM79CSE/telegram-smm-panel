"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { User, Lock, ShieldCheck, Send, Check } from "lucide-react";

/**
 * Self-service profile + security settings (docs/DASHBOARD_UPGRADE_PLAN.md
 * §3.3). Two independent forms (name, password) so a failed/pending state
 * in one never blocks or gets confused with the other, plus a read-only
 * account-info panel surfacing data that already exists on `User`
 * (`lastLoginAt`/`lastLoginIp`, Telegram link status) but was previously
 * invisible anywhere in the UI.
 */
export function AccountSettingsPanel({
  name: initialName,
  email,
  lastLoginAt,
  lastLoginIp,
  telegramLinked,
}: {
  name: string;
  email: string;
  lastLoginAt: string | null;
  lastLoginIp: string | null;
  telegramLinked: boolean;
}) {
  const t = useTranslations("Dashboard.settings");
  const router = useRouter();

  return (
    <div className="space-y-6">
      <ProfileForm initialName={initialName} email={email} t={t} router={router} />
      <PasswordForm t={t} />

      <div className="rounded-xl border border-slate-800 bg-slate-950 p-6">
        <div className="mb-4 flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-slate-400" />
          <h2 className="font-semibold text-white">{t("accountInfo")}</h2>
        </div>
        <dl className="space-y-3 text-sm">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <dt className="text-slate-400">{t("lastLogin")}</dt>
            <dd className="text-slate-200">
              {lastLoginAt ? new Date(lastLoginAt).toLocaleString() : t("never")}
              {lastLoginIp && <span className="ml-2 text-xs text-slate-500">({lastLoginIp})</span>}
            </dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="flex items-center gap-2 text-slate-400">
              <Send className="h-4 w-4" />
              {t("telegramStatus")}
            </dt>
            <dd>
              {telegramLinked ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-green-950 px-2.5 py-1 text-xs font-medium text-green-400">
                  <Check className="h-3 w-3" />
                  {t("telegramLinked")}
                </span>
              ) : (
                <Link href="/dashboard/telegram" className="text-xs text-blue-400 hover:underline">
                  {t("telegramNotLinked")}
                </Link>
              )}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

function ProfileForm({
  initialName,
  email,
  t,
  router,
}: {
  initialName: string;
  email: string;
  t: ReturnType<typeof useTranslations<"Dashboard.settings">>;
  router: ReturnType<typeof useRouter>;
}) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);

    startTransition(async () => {
      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();

      if (!res.ok) {
        const detail = data?.details ? Object.values(data.details).flat().join(" ") : data.error;
        setError(detail || t("profileErrorFallback"));
        return;
      }

      setMessage(t("profileSaved"));
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-slate-800 bg-slate-950 p-6">
      <div className="mb-4 flex items-center gap-2">
        <User className="h-5 w-5 text-slate-400" />
        <h2 className="font-semibold text-white">{t("profileSection")}</h2>
      </div>

      <div className="space-y-4">
        <div>
          <label className="mb-2 block text-sm text-slate-300">{t("fullName")}</label>
          <input
            required
            minLength={2}
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-white outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label className="mb-2 block text-sm text-slate-300">{t("email")}</label>
          <input
            disabled
            value={email}
            className="w-full cursor-not-allowed rounded-lg border border-slate-800 bg-slate-900/50 p-3 text-slate-500"
          />
          <p className="mt-2 text-xs text-slate-500">{t("emailImmutableHint")}</p>
        </div>
      </div>

      {error && <div className="mt-4 rounded-lg bg-red-950 p-3 text-sm text-red-400">{error}</div>}
      {message && <div className="mt-4 rounded-lg bg-green-950 p-3 text-sm text-green-400">{message}</div>}

      <button
        disabled={isPending || name.trim().length < 2}
        className="mt-4 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
      >
        {isPending ? t("saving") : t("saveChanges")}
      </button>
    </form>
  );
}

function PasswordForm({ t }: { t: ReturnType<typeof useTranslations<"Dashboard.settings">> }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);

    startTransition(async () => {
      const res = await fetch("/api/account/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();

      if (!res.ok) {
        const detail = data?.details ? Object.values(data.details).flat().join(" ") : data.error;
        setError(detail || t("passwordErrorFallback"));
        return;
      }

      setMessage(t("passwordChanged"));
      setCurrentPassword("");
      setNewPassword("");
    });
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-slate-800 bg-slate-950 p-6">
      <div className="mb-4 flex items-center gap-2">
        <Lock className="h-5 w-5 text-slate-400" />
        <h2 className="font-semibold text-white">{t("passwordSection")}</h2>
      </div>

      <div className="space-y-4">
        <div>
          <label className="mb-2 block text-sm text-slate-300">{t("currentPassword")}</label>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-white outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label className="mb-2 block text-sm text-slate-300">{t("newPassword")}</label>
          <input
            type="password"
            required
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-white outline-none focus:border-blue-500"
          />
          <p className="mt-2 text-xs text-slate-500">{t("passwordHint")}</p>
        </div>
      </div>

      {error && <div className="mt-4 rounded-lg bg-red-950 p-3 text-sm text-red-400">{error}</div>}
      {message && <div className="mt-4 rounded-lg bg-green-950 p-3 text-sm text-green-400">{message}</div>}

      <button
        disabled={isPending || !currentPassword || !newPassword}
        className="mt-4 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
      >
        {isPending ? t("saving") : t("changePassword")}
      </button>
    </form>
  );
}
