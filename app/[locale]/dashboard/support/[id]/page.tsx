import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { redirect } from "@/i18n/navigation";
import { TicketReplyForm } from "@/components/support/ticket-reply-form";
import { StatusBadge } from "@/components/dashboard/status-badge";

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const locale = await getLocale();
  const t = await getTranslations("TicketDetail");
  const tStatus = await getTranslations("StatusBadge");
  const tPriority = await getTranslations("TicketPriority");
  if (!session?.user?.id) return redirect({ href: "/login", locale });

  const { id } = await params;

  const ticket = await prisma.supportTicket.findUnique({
    where: { id },
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
        include: { sender: { select: { name: true, role: true } } },
      },
    },
  });

  if (!ticket) notFound();

  if (ticket.userId !== session.user.id && session.user.role !== "ADMIN") {
    return redirect({ href: "/dashboard/support", locale });
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">{ticket.subject}</h1>
        <div className="mt-2 flex items-center gap-3 text-sm text-slate-400">
          <span>#{ticket.id.slice(-8)}</span>
          <StatusBadge status={ticket.status} label={tStatus(ticket.status)} />
          <span>{t("priority", { priority: tPriority(ticket.priority) })}</span>
        </div>
      </div>

      <div className="space-y-4">
        {ticket.messages.map((message) => (
          <div
            key={message.id}
            className={`rounded-xl border p-5 ${
              message.isAdmin ? "border-blue-900 bg-blue-950/30" : "border-slate-800 bg-slate-950"
            }`}
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-medium text-white">
                {message.isAdmin ? t("supportTeam") : message.sender?.name || t("defaultUser")}
              </p>
              <p className="text-xs text-slate-500">{new Date(message.createdAt).toLocaleString()}</p>
            </div>
            <p className="whitespace-pre-wrap text-sm leading-6 text-slate-300">{message.message}</p>
          </div>
        ))}
      </div>

      {ticket.status !== "CLOSED" && (
        <div className="mt-6">
          <TicketReplyForm ticketId={ticket.id} />
        </div>
      )}
    </div>
  );
}
