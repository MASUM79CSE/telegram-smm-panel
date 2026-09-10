import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { connectDB } from "@/lib/db";
import { markAllAsRead } from "@/lib/services/notifications";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await connectDB();
  const count = await markAllAsRead(session.user.id);

  return NextResponse.json({ message: "All notifications marked as read", count });
}
