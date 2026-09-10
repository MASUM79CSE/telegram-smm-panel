"use client";

import { useRef, useState, useTransition } from "react";
import { Send, Copy, Check, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { copyToClipboard, selectElementText } from "@/lib/clipboard";

export function TelegramLinkPanel({
  linked,
  telegramUsername,
  botUsername,
}: {
  linked: boolean;
  telegramUsername: string | null;
  botUsername: string | null;
}) {
  const t = useTranslations("TelegramLinkPanel");
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const codeRef = useRef<HTMLElement | null>(null);

  function generateCode() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/telegram/link-code", { method: "POST" });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? t("errorFallback"));
          return;
        }
        setCode(data.code);
      } catch {
        setError(t("errorGeneric"));
      }
    });
  }

  async function copyCommand() {
    if (!code) return;
    const ok = await copyToClipboard(`/link ${code}`);
    if (!ok) {
      setError(t("copyFailed"));
      setCopyFailed(true);
      selectElementText(codeRef.current);
      setTimeout(() => setCopyFailed(false), 2500);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const botLink = botUsername ? `https://t.me/${botUsername}` : null;

  if (linked) {
    return (
      <div className="max-w-xl rounded-lg border border-slate-800 bg-slate-950 p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-600">
            <Send className="h-5 w-5 text-white" />
          </div>
          <div>
            <p className="font-semibold text-white">{t("connectedTitle")}</p>
            <p className="text-sm text-slate-400">
              {t("linkedTo", { handle: telegramUsername ? `@${telegramUsername}` : t("yourAccount") })}
            </p>
          </div>
        </div>
        <p className="mt-4 text-sm text-slate-400">
          {t.rich("connectedInstructions", {
            code: (chunks) => <code className="rounded bg-slate-900 px-1.5 py-0.5">{chunks}</code>,
          })}
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-xl rounded-lg border border-slate-800 bg-slate-950 p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600">
          <Send className="h-5 w-5 text-white" />
        </div>
        <div>
          <p className="font-semibold text-white">{t("connectTitle")}</p>
          <p className="text-sm text-slate-400">{t("notLinked")}</p>
        </div>
      </div>

      <ol className="mt-5 list-inside list-decimal space-y-2 text-sm text-slate-300">
        <li>
          {botLink ? t("step1WithLink") : t("step1WithoutLink")}{" "}
          {botLink && (
            <a href={botLink} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">
              {botLink}
            </a>
          )}
        </li>
        <li>{t("step2")}</li>
        <li>
          {t.rich("step3", {
            code: (chunks) => <code className="rounded bg-slate-900 px-1.5 py-0.5">{chunks}</code>,
          })}
        </li>
      </ol>

      {error && (
        <div className="mt-4 rounded-lg border border-red-900 bg-red-950 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {code ? (
        <div className="mt-5">
          <p className="mb-2 text-xs uppercase tracking-wide text-slate-500">{t("sendThisToBot")}</p>
          <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-4 py-3">
            <code ref={codeRef} className="flex-1 font-mono text-lg text-white select-all">
              /link {code}
            </code>
            <button
              onClick={copyCommand}
              className={`rounded-md p-2 transition-colors ${
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
          <p className="mt-2 text-xs text-slate-500">{t("codeExpiry")}</p>
          <button
            onClick={generateCode}
            disabled={isPending}
            className="mt-3 text-sm text-blue-400 hover:underline disabled:opacity-50"
          >
            {t("generateNewCode")}
          </button>
        </div>
      ) : (
        <button
          onClick={generateCode}
          disabled={isPending}
          className="mt-5 w-full rounded-lg bg-blue-600 px-4 py-2.5 font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
        >
          {isPending ? t("generating") : t("generateCode")}
        </button>
      )}
    </div>
  );
}
