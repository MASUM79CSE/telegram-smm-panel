import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import type { Prisma, UserStatus } from "@/lib/generated/prisma";
import { parseListQuery } from "@/lib/admin-query";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const { page, limit, status, search, dateRange } = parseListQuery(searchParams);

  const where: Prisma.UserWhereInput = {};
  if (status && status.length > 0) where.status = { in: status as UserStatus[] };
  if (dateRange) where.createdAt = dateRange;
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
    ];
  }

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      omit: { passwordHash: true, twoFactorSecret: true },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.user.count({ where }),
  ]);

  return NextResponse.json({ users, total, page, limit });
}
