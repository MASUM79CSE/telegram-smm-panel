import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { TicketReplyForm } from "@/components/support/ticket-reply-form";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { CloseTicketButton } from "@/components/admin/close-ticket-button";

export default async function AdminTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const ticket = await prisma.supportTicket.findUnique({
    where: { id },
    include: {
      user: { select: { name: true, email: true } },
      messages: {
        orderBy: { createdAt: "asc" },
        include: { sender: { select: { name: true, role: true } } },
      },
    },
  });

  if (!ticket) notFound();

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">{ticket.subject}</h1>
          <div className="mt-2 flex items-center gap-3 text-sm text-slate-400">
            <span>{ticket.user?.email}</span>
            <StatusBadge status={ticket.status} />
            <span>{ticket.priority} priority</span>
          </div>
        </div>
        {ticket.status !== "CLOSED" && <CloseTicketButton ticketId={ticket.id} />}
      </div>

      <div className="space-y-4">
        {ticket.messages.map((message) => (
          <div
            key={message.id}
            className={`rounded-xl border p-5 ${
              message.isAdmin ? "border-red-900 bg-red-950/20" : "border-slate-800 bg-slate-950"
            }`}
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-medium text-white">
                {message.isAdmin ? "Support Team" : message.sender?.name || "User"}
              </p>
              <p className="text-xs text-slate-500">{new Date(message.createdAt).toLocaleString()}</p>
            </div>
            <p className="whitespace-pre-wrap text-sm leading-6 text-slate-300">{message.message}</p>
          </div>
        ))}
      </div>

      {ticket.status !== "CLOSED" && (
        <div className="mt-6">
          <TicketReplyForm ticketId={ticket.id} adminPath />
        </div>
      )}
    </div>
  );
}
