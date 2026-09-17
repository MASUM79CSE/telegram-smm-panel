import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

/**
 * Backing search for the admin command palette (Cmd/Ctrl+K —
 * docs/DASHBOARD_UPGRADE_PLAN.md §2.7). Looks up a handful of matches
 * across Users (name/email)/Orders (target, or exact id)/Payments
 * (transactionRef, or exact id) for a single free-text query, capped at a
 * small per-type limit since this only needs to power "jump to a specific
 * record," not a full search UI.
 *
 * Ids are now Prisma-generated UUIDs (`uuid()`), not Mongo ObjectIds — the
 * exact-id-match branch below checks UUID shape instead of the old 24-hex
 * ObjectId check.
 */
const PER_TYPE_LIMIT = 5;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();
  if (!q || q.length < 2) {
    return NextResponse.json({ users: [], orders: [], payments: [] });
  }

  const isUuid = UUID_RE.test(q);

  const [users, orders, payments] = await Promise.all([
    prisma.user.findMany({
      where: { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] },
      select: { id: true, name: true, email: true },
      take: PER_TYPE_LIMIT,
    }),
    prisma.order.findMany({
      where: isUuid ? { id: q } : { target: { contains: q, mode: "insensitive" } },
      select: { id: true, target: true, status: true },
      take: PER_TYPE_LIMIT,
    }),
    prisma.payment.findMany({
      where: isUuid ? { id: q } : { transactionRef: { contains: q, mode: "insensitive" } },
      select: { id: true, transactionRef: true, status: true },
      take: PER_TYPE_LIMIT,
    }),
  ]);

  return NextResponse.json({
    users: users.map((u) => ({ id: u.id, name: u.name, email: u.email })),
    orders: orders.map((o) => ({ id: o.id, target: o.target, status: o.status })),
    payments: payments.map((p) => ({ id: p.id, ref: p.transactionRef, status: p.status })),
  });
}
