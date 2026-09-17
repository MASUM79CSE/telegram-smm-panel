import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { parseListQuery } from "@/lib/admin-query";
import type { Prisma, OrderStatus } from "@/lib/generated/prisma";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const { page, limit, status, search, dateRange } = parseListQuery(searchParams);

  const where: Prisma.OrderWhereInput = {};
  if (status && status.length > 0) where.status = { in: status as OrderStatus[] };
  if (dateRange) where.createdAt = dateRange;

  if (search) {
    where.OR = [
      { target: { contains: search, mode: "insensitive" } },
      {
        user: {
          is: {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { email: { contains: search, mode: "insensitive" } },
            ],
          },
        },
      },
    ];
  }

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: {
        user: { select: { name: true, email: true } },
        service: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.order.count({ where }),
  ]);

  return NextResponse.json({ orders, total, page, limit });
}
