import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { ticketSchema } from "@/lib/validation";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { notifyAdminNewTicket } from "@/lib/telegram/notify";
import { notifyAllAdmins } from "@/lib/services/notifications";
import { createTicket } from "@/lib/services/tickets";
import { requestLogger } from "@/lib/logger";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tickets = await prisma.supportTicket.findMany({
    where: { userId: session.user.id },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({ tickets });
}

export async function POST(request: Request) {
  const log = requestLogger(request);
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ip = getClientIp(request);
  const { success } = await rateLimit("ticketCreate", `${session.user.id}:${ip}`);
  if (!success) {
    return NextResponse.json({ error: "Too many tickets created. Please try again later." }, { status: 429 });
  }

  const body = await request.json();
  const parsed = ticketSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const ticket = await createTicket({
    userId: session.user.id,
    subject: parsed.data.subject,
    priority: parsed.data.priority,
    message: parsed.data.message,
  });

  notifyAdminNewTicket(ticket).catch((err) => log.error({ err }, "Ticket notification error"));
  notifyAllAdmins({
    type: "NEW_TICKET",
    title: "New support ticket",
    body: `New ticket: "${ticket.subject}"`,
    href: "/admin/support",
  }).catch((err) => log.error({ err }, "Admin ticket notification error"));

  return NextResponse.json({ message: "Support ticket created", ticket }, { status: 201 });
}
