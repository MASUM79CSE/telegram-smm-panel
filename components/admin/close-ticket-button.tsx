"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

export function CloseTicketButton({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function close() {
    if (!confirm("Close this ticket?")) return;
    startTransition(async () => {
      await fetch(`/api/admin/support/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "CLOSED" }),
      });
      router.refresh();
    });
  }

  return (
    <button
      disabled={isPending}
      onClick={close}
      className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-900 disabled:opacity-50"
    >
      {isPending ? "Closing..." : "Close Ticket"}
    </button>
  );
}
