import { Bot, session, InlineKeyboard } from "grammy";
import { conversations } from "@grammyjs/conversations";
import { MongoDBAdapter } from "@grammyjs/storage-mongodb";

import { env } from "@/lib/env";
import { connectDB } from "@/lib/db";
import type { BotContext, SessionData } from "@/lib/telegram/types";
import { logger } from "@/lib/logger";

let botInstance: Bot<BotContext> | null = null;
let initPromise: Promise<Bot<BotContext>> | null = null;

/**
 * Lazily constructs (once per server process) the grammY bot instance with
 * session storage backed by the same MongoDB connection as the rest of the
 * app (via the shared Mongoose connection's native driver handle) — no
 * second database connection to manage.
 *
 * Returns null if TELEGRAM_BOT_TOKEN isn't configured, so every caller can
 * simply no-op instead of crashing when the bot isn't set up yet.
 */
export async function getBot(): Promise<Bot<BotContext> | null> {
  if (!env.TELEGRAM_BOT_TOKEN) return null;
  if (botInstance) return botInstance;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const mongoose = await connectDB();
    // `@grammyjs/storage-mongodb` ships its own bundled/rolled-up `mongodb`
    // type declarations (a different nominal type than the `mongodb` package
    // resolved elsewhere in this project via mongoose), so the structurally
    // identical `Collection` type doesn't type-check as assignable. The
    // runtime object is a completely normal MongoDB driver Collection —
    // safe to cast through `unknown`.
    const collection = mongoose.connection.db!.collection("telegram_bot_sessions") as unknown as ConstructorParameters<
      typeof MongoDBAdapter
    >[0]["collection"];

    const bot = new Bot<BotContext>(env.TELEGRAM_BOT_TOKEN!);

    bot.use(
      session({
        initial: (): SessionData => ({}),
        storage: new MongoDBAdapter({ collection }),
      })
    );
    bot.use(conversations());

    await bot.init();

    botInstance = bot;
    return bot;
  })();

  return initPromise;
}

/** Send a plain text message to an arbitrary chat id, swallowing errors (best-effort notifications). */
export async function sendTelegramMessage(
  chatId: string | number,
  text: string,
  replyMarkup?: InlineKeyboard
): Promise<void> {
  const bot = await getBot();
  if (!bot) return;

  try {
    await bot.api.sendMessage(chatId, text, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: replyMarkup,
    });
  } catch (err) {
    logger.error({ err, chatId }, "[telegram] Failed to send message");
  }
}
