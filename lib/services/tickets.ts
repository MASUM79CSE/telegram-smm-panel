import { prisma } from "@/lib/db";

/**
 * Shared support-ticket creation logic used by both the website
 * (`app/api/support/tickets/route.ts`) and the Telegram bot's `/support`
 * conversation.
 *
 * `SupportTicket.messages` was an embedded subdocument array in Mongoose;
 * it is now a real related `TicketMessage` table (see
 * prisma/schema.prisma's own comment on that model for why) — both
 * functions below always `include: { messages: ... }` on their return
 * value so callers get the same "ticket with its messages" shape as
 * before, just via a join instead of an embedded array.
 */
export async function createTicket(params: {
  userId: string;
  subject: string;
  priority: "LOW" | "MEDIUM" | "HIGH";
  message: string;
}) {
  const { userId, subject, priority, message } = params;

  return prisma.supportTicket.create({
    data: {
      userId,
      subject,
      priority,
      status: "OPEN",
      messages: {
        create: [{ senderId: userId, message, isAdmin: false }],
      },
    },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
}

/** Shared reply logic — appends a message and flips status the same way regardless of surface. */
export async function replyToTicket(params: {
  ticketId: string;
  senderId: string;
  message: string;
  isAdmin: boolean;
}) {
  const { ticketId, senderId, message, isAdmin } = params;

  const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
  if (!ticket) return null;

  if (ticket.status === "CLOSED") return "CLOSED" as const;

  return prisma.supportTicket.update({
    where: { id: ticketId },
    data: {
      status: isAdmin ? "ANSWERED" : "OPEN",
      messages: {
        create: [{ senderId, message, isAdmin }],
      },
    },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
}
