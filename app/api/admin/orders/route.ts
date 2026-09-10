import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { connectDB } from "@/lib/db";
import { Order } from "@/models/Order";
import { User } from "@/models/User";
import { parseListQuery, escapeRegExp } from "@/lib/admin-query";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await connectDB();

  const { searchParams } = new URL(request.url);
  const { page, limit, status, search, dateRange } = parseListQuery(searchParams);

  const filter: Record<string, unknown> = {};
  if (status && status.length > 0) filter.status = { $in: status };
  if (dateRange) filter.createdAt = dateRange;

  if (search) {
    const re = { $regex: escapeRegExp(search), $options: "i" };
    const matchingUsers = await User.find({ $or: [{ name: re }, { email: re }] })
      .select("_id")
      .lean();
    filter.$or = [{ target: re }, { userId: { $in: matchingUsers.map((u) => u._id) } }];
  }

  const [orders, total] = await Promise.all([
    Order.find(filter)
      .populate("userId", "name email")
      .populate("serviceId", "name")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Order.countDocuments(filter),
  ]);

  return NextResponse.json({ orders, total, page, limit });
}
