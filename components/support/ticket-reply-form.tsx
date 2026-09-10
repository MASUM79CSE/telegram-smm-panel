"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

interface ReplyFormStrings {
  errorFallback: string;
  placeholder: string;
  submit: string;
  submitting: string;
}

/** Presentational core, parameterized by already-resolved strings — no hook calls of its own, so it's safe to render from either an i18n-aware or plain-English wrapper below. */
function ReplyFormBase({
  ticketId,
  adminPath,
  strings,
}: {
  ticketId: string;
  adminPath: boolean;
  strings: ReplyFormStrings;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const res = await fetch(`/api/support/tickets/${ticketId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || strings.errorFallback);
        return;
      }

      setMessage("");
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <textarea
        required
        rows={4}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder={strings.placeholder}
        className="w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-white outline-none focus:border-blue-500"
      />

      {error && <div className="rounded-lg bg-red-950 p-3 text-sm text-red-400">{error}</div>}

      <button
        disabled={isPending}
        className={`rounded-lg px-6 py-2 font-medium text-white disabled:opacity-50 ${
          adminPath ? "bg-red-600 hover:bg-red-500" : "bg-blue-600 hover:bg-blue-500"
        }`}
      >
        {isPending ? strings.submitting : strings.submit}
      </button>
    </form>
  );
}

const ADMIN_STRINGS: ReplyFormStrings = {
  errorFallback: "Failed to send message",
  placeholder: "Type your reply...",
  submit: "Send Reply",
  submitting: "Sending...",
};

/**
 * Shared between `/admin/**` (`adminPath=true`, deliberately English-only,
 * outside next-intl's provider — see docs/I18N_PLAN.md §2) and the
 * customer-facing `/[locale]/dashboard/support/[id]` page. Two thin
 * wrappers around the same presentational `ReplyFormBase` so `useTranslations`
 * is only ever called from a component that's actually rendered under
 * `<NextIntlClientProvider>` (`/admin` renders `ADMIN_STRINGS` directly
 * instead, with zero hook call, avoiding a "no intl context found" crash).
 */
export function TicketReplyForm({ ticketId, adminPath = false }: { ticketId: string; adminPath?: boolean }) {
  if (adminPath) {
    return <ReplyFormBase ticketId={ticketId} adminPath strings={ADMIN_STRINGS} />;
  }
  return <TranslatedTicketReplyForm ticketId={ticketId} />;
}

function TranslatedTicketReplyForm({ ticketId }: { ticketId: string }) {
  const t = useTranslations("TicketReplyForm");
  return (
    <ReplyFormBase
      ticketId={ticketId}
      adminPath={false}
      strings={{
        errorFallback: t("errorFallback"),
        placeholder: t("placeholder"),
        submit: t("submit"),
        submitting: t("submitting"),
      }}
    />
  );
}
