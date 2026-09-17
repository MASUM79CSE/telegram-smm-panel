import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
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

  const { id } = await params;

  const body = await request.json();
  const parsed = ticketMessageSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid message" }, { status: 400 });
  }

  const existingTicket = await prisma.supportTicket.findUnique({ where: { id } });
  if (!existingTicket) {
    return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  }

  const isAdmin = session.user.role === "ADMIN";
  const isOwner = existingTicket.userId === session.user.id;

  if (!isAdmin && !isOwner) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (existingTicket.status === "CLOSED") {
    return NextResponse.json({ error: "This ticket is closed." }, { status: 400 });
  }

  const ticket = await prisma.supportTicket.update({
    where: { id },
    data: {
      status: isAdmin ? "ANSWERED" : "OPEN",
      messages: {
        create: [{ senderId: session.user.id, message: parsed.data.message, isAdmin }],
      },
    },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });

  notifyTicketReply(ticket.userId, id, ticket.subject, isAdmin).catch((err) =>
    log.error({ err }, "Ticket-reply notification error")
  );

  if (isAdmin) {
    createNotification({
      userId: ticket.userId,
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
