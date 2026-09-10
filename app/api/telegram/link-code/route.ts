import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { connectDB } from "@/lib/db";
import { createTelegramLinkCode } from "@/lib/services/telegram-link";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ip = getClientIp(request);
  const { success } = await rateLimit("telegramLink", `telegram-link-code:${session.user.id}:${ip}`);
  if (!success) {
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
  }

  await connectDB();

  const code = await createTelegramLinkCode(session.user.id);

  return NextResponse.json({ code, expiresInMinutes: 15 });
}
