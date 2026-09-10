import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { connectDB } from "@/lib/db";
import { getRevenueSeries } from "@/lib/services/analytics";

const ALLOWED_DAYS = [7, 30, 90];

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await connectDB();

  const { searchParams } = new URL(request.url);
  const daysParam = parseInt(searchParams.get("days") || "30", 10);
  const days = ALLOWED_DAYS.includes(daysParam) ? daysParam : 30;

  const series = await getRevenueSeries(days);

  return NextResponse.json(series);
}
