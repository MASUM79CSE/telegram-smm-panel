import { SupportTicket } from "@/models/SupportTicket";

/**
 * Shared support-ticket creation logic used by both the website
 * (`app/api/support/tickets/route.ts`) and the Telegram bot's `/support` conversation.
 */
export async function createTicket(params: {
  userId: string;
  subject: string;
  priority: "LOW" | "MEDIUM" | "HIGH";
  message: string;
}) {
  const { userId, subject, priority, message } = params;

  return SupportTicket.create({
    userId,
    subject,
    priority,
    status: "OPEN",
    messages: [{ senderId: userId, message, isAdmin: false }],
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

  const ticket = await SupportTicket.findById(ticketId);
  if (!ticket) return null;

  if (ticket.status === "CLOSED") return "CLOSED" as const;

  ticket.messages.push({ senderId, message, isAdmin } as never);
  ticket.status = isAdmin ? "ANSWERED" : "OPEN";
  await ticket.save();

  return ticket;
}
