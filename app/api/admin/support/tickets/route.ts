import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import type { Prisma, TicketStatus } from "@/lib/generated/prisma";
import { parseListQuery } from "@/lib/admin-query";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const { page, limit, status, search, dateRange } = parseListQuery(searchParams, 20, 100);

  const where: Prisma.SupportTicketWhereInput = {};
  if (status && status.length > 0) where.status = { in: status as TicketStatus[] };
  if (dateRange) where.createdAt = dateRange;

  if (search) {
    const matchingUsers = await prisma.user.findMany({
      where: {
        OR: [{ name: { contains: search, mode: "insensitive" } }, { email: { contains: search, mode: "insensitive" } }],
      },
      select: { id: true },
    });
    where.OR = [
      { subject: { contains: search, mode: "insensitive" } },
      { userId: { in: matchingUsers.map((u) => u.id) } },
    ];
  }

  const [tickets, total] = await Promise.all([
    prisma.supportTicket.findMany({
      where,
      include: { user: { select: { name: true, email: true } } },
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.supportTicket.count({ where }),
  ]);

  return NextResponse.json({ tickets, total, page, limit });
}
