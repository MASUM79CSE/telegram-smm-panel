import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { connectDB } from "@/lib/db";
import { User } from "@/models/User";
import { Order } from "@/models/Order";
import { Payment } from "@/models/Payment";
import { escapeRegExp } from "@/lib/admin-query";
import { Types } from "mongoose";

/**
 * Backing search for the admin command palette (Cmd/Ctrl+K —
 * docs/DASHBOARD_UPGRADE_PLAN.md §2.7). Looks up a handful of matches
 * across Users (name/email)/Orders (target, or exact _id)/Payments
 * (transactionRef, or exact _id) for a single free-text query, capped at a
 * small per-type limit since this only needs to power "jump to a specific
 * record," not a full search UI.
 */
const PER_TYPE_LIMIT = 5;

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

  await connectDB();

  const re = { $regex: escapeRegExp(q), $options: "i" };
  const isObjectId = Types.ObjectId.isValid(q) && q.length === 24;

  const [users, orders, payments] = await Promise.all([
    User.find({ $or: [{ name: re }, { email: re }] })
      .select("_id name email")
      .limit(PER_TYPE_LIMIT)
      .lean(),
    Order.find(isObjectId ? { _id: q } : { target: re })
      .select("_id target status")
      .limit(PER_TYPE_LIMIT)
      .lean(),
    Payment.find(isObjectId ? { _id: q } : { transactionRef: re })
      .select("_id transactionRef status")
      .limit(PER_TYPE_LIMIT)
      .lean(),
  ]);

  return NextResponse.json({
    users: users.map((u) => ({ id: u._id.toString(), name: u.name, email: u.email })),
    orders: orders.map((o) => ({ id: o._id.toString(), target: o.target, status: o.status })),
    payments: payments.map((p) => ({ id: p._id.toString(), ref: p.transactionRef, status: p.status })),
  });
}
