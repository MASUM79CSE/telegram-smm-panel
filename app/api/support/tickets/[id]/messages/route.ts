import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { connectDB } from "@/lib/db";
import { SupportTicket } from "@/models/SupportTicket";
import { ticketMessageSchema } from "@/lib/validation";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { notifyTicketReply } from "@/lib/telegram/notify";
import { createNotification, notifyAllAdmins } from "@/lib/services/notifications";
import { requestLogger } from "@/lib/logger";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const log = requestLogger(request);
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ip = getClientIp(request);
  const { success } = await rateLimit("ticketReply", `${session.user.id}:${ip}`);
  if (!success) {
    return NextResponse.json({ error: "Too many messages sent. Please slow down." }, { status: 429 });
  }

  await connectDB();
  const { id } = await params;

  const body = await request.json();
  const parsed = ticketMessageSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid message" }, { status: 400 });
  }

  const ticket = await SupportTicket.findById(id);
  if (!ticket) {
    return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  }

  const isAdmin = session.user.role === "ADMIN";
  const isOwner = ticket.userId.toString() === session.user.id;

  if (!isAdmin && !isOwner) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (ticket.status === "CLOSED") {
    return NextResponse.json({ error: "This ticket is closed." }, { status: 400 });
  }

  ticket.messages.push({
    senderId: session.user.id,
    message: parsed.data.message,
    isAdmin,
  } as never);

  ticket.status = isAdmin ? "ANSWERED" : "OPEN";
  await ticket.save();

  notifyTicketReply(ticket.userId.toString(), id, ticket.subject, isAdmin).catch((err) =>
    log.error({ err }, "Ticket-reply notification error")
  );

  if (isAdmin) {
    createNotification({
      userId: ticket.userId.toString(),
      type: "TICKET_REPLIED",
      title: "Support replied to your ticket",
      body: `New reply on "${ticket.subject}"`,
      href: `/dashboard/support/${id}`,
    }).catch((err) => log.error({ err }, "Ticket-reply in-app notification error"));
  } else {
    notifyAllAdmins({
      type: "TICKET_REPLIED",
      title: "Customer replied to a ticket",
      body: `New reply on "${ticket.subject}"`,
      href: `/admin/support/${id}`,
    }).catch((err) => log.error({ err }, "Admin ticket-reply notification error"));
  }

  return NextResponse.json({ message: "Reply sent", ticket }, { status: 201 });
}
