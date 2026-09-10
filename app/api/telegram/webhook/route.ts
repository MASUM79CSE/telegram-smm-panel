import { NextResponse } from "next/server";
import { webhookCallback } from "grammy";

import { getBot } from "@/lib/telegram/client";
import { registerHandlers } from "@/lib/telegram/bot";
import { env } from "@/lib/env";
import { requestLogger } from "@/lib/logger";

// This route must never be statically optimized/cached — every request is a
// live Telegram update that needs a fresh bot response.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function POST(request: Request) {
  const bot = await getBot();

  if (!bot) {
    // Bot not configured (no TELEGRAM_BOT_TOKEN) — respond 200 so Telegram
    // doesn't retry forever, but make it obvious in logs this is a no-op.
    requestLogger(request).warn("[telegram webhook] Received update but TELEGRAM_BOT_TOKEN is not configured.");
    return NextResponse.json({ ok: true });
  }

  await registerHandlers();

  const handler = webhookCallback(bot, "std/http", {
    secretToken: env.TELEGRAM_WEBHOOK_SECRET,
  });

  return handler(request);
}
