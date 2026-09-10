"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Check, X, Trash2, KeyRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { copyToClipboard, selectElementText } from "@/lib/clipboard";

interface ApiKeySummary {
  _id: string;
  label: string | null;
  keyPrefix: string;
  lastUsedAt: string | null;
  active: boolean;
  createdAt: string;
}

export function ApiKeysPanel({ initialKeys }: { initialKeys: ApiKeySummary[] }) {
  const router = useRouter();
  const t = useTranslations("ApiKeysPanel");
  const [keys, setKeys] = useState(initialKeys);
  const [label, setLabel] = useState("");
  const [newRawKey, setNewRawKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const rawKeyRef = useRef<HTMLElement | null>(null);

  function createKey(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const res = await fetch("/api/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim() || null }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? t("errorFallback"));
        return;
      }

      setNewRawKey(data.key);
      setLabel("");
      setKeys((prev) => [
        { ...data.apiKey, lastUsedAt: null, active: true },
        ...prev,
      ]);
      router.refresh();
    });
  }

  function revokeKey(id: string) {
    if (!confirm(t("revokeConfirm"))) return;

    startTransition(async () => {
      const res = await fetch(`/api/api-keys/${id}`, { method: "DELETE" });
      if (res.ok) {
        setKeys((prev) => prev.map((k) => (k._id === id ? { ...k, active: false } : k)));
        router.refresh();
      }
    });
  }

  async function copyKey() {
    if (!newRawKey) return;
    const ok = await copyToClipboard(newRawKey);
    if (!ok) {
      setError(t("copyFailed"));
      setCopyFailed(true);
      selectElementText(rawKeyRef.current);
      setTimeout(() => setCopyFailed(false), 2500);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-6">
      <form
        onSubmit={createKey}
        className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-950 p-6 sm:flex-row sm:items-end"
      >
        <div className="flex-1">
          <label className="mb-2 block text-sm text-slate-300">{t("labelOptional")}</label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t("labelPlaceholder")}
            maxLength={100}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-white outline-none focus:border-blue-500"
          />
        </div>
        <button
          disabled={isPending}
          className="flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-3 font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
        >
          <KeyRound className="h-4 w-4" />
          {isPending ? t("generating") : t("generate")}
        </button>
      </form>

      {error && (
        <div className="rounded-lg border border-red-900 bg-red-950 px-4 py-2 text-sm text-red-300">{error}</div>
      )}

      {newRawKey && (
        <div className="rounded-xl border border-yellow-800 bg-yellow-950/40 p-6">
          <p className="mb-2 font-semibold text-yellow-200">{t("copyNewKeyWarning")}</p>
          <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-4 py-3">
            <code ref={rawKeyRef} className="flex-1 overflow-x-auto font-mono text-sm text-white select-all">
              {newRawKey}
            </code>
            <button
              onClick={copyKey}
              className={`shrink-0 rounded-md p-2 transition-colors ${
                copyFailed
                  ? "bg-red-950 text-red-300 hover:bg-red-900"
                  : "bg-slate-800 text-slate-300 hover:bg-slate-700"
              }`}
              title="Copy"
            >
              {copied ? (
                <Check className="h-4 w-4 text-green-400" />
              ) : copyFailed ? (
                <X className="h-4 w-4" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-900 text-slate-400">
            <tr>
              <th className="px-4 py-3 font-medium">{t("colLabel")}</th>
              <th className="px-4 py-3 font-medium">{t("colKey")}</th>
              <th className="px-4 py-3 font-medium">{t("colStatus")}</th>
              <th className="px-4 py-3 font-medium">{t("colLastUsed")}</th>
              <th className="px-4 py-3 font-medium">{t("colCreated")}</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {keys.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                  {t.rich("empty", {
                    code: (chunks) => <code className="rounded bg-slate-900 px-1.5 py-0.5">{chunks}</code>,
                  })}
                </td>
              </tr>
            )}
            {keys.map((k) => (
              <tr key={k._id} className="text-slate-300">
                <td className="px-4 py-3">{k.label || <span className="text-slate-600">—</span>}</td>
                <td className="px-4 py-3 font-mono text-slate-500">{k.keyPrefix}…</td>
                <td className="px-4 py-3">
                  {k.active ? (
                    <span className="rounded-full bg-green-950 px-2 py-0.5 text-xs text-green-400">
                      {t("statusActive")}
                    </span>
                  ) : (
                    <span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs text-slate-500">
                      {t("statusRevoked")}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-500">
                  {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : t("never")}
                </td>
                <td className="px-4 py-3 text-slate-500">{new Date(k.createdAt).toLocaleDateString()}</td>
                <td className="px-4 py-3 text-right">
                  {k.active && (
                    <button
                      onClick={() => revokeKey(k._id)}
                      disabled={isPending}
                      className="text-red-400 hover:text-red-300 disabled:opacity-50"
                      title="Revoke"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
