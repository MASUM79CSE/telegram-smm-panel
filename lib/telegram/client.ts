import { Bot, session, InlineKeyboard } from "grammy";
import type { StorageAdapter } from "grammy";
import { conversations } from "@grammyjs/conversations";

import { env } from "@/lib/env";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma";
import type { BotContext, SessionData } from "@/lib/telegram/types";
import { logger } from "@/lib/logger";

let botInstance: Bot<BotContext> | null = null;
let initPromise: Promise<Bot<BotContext>> | null = null;

/**
 * grammY session storage backed by the `TelegramBotSession` table via
 * Prisma, replacing `@grammyjs/storage-mongodb` (which required the shared
 * Mongoose connection's native driver handle — no longer available after
 * the Postgres migration). No `@grammyjs/storage-prisma` package exists,
 * so this implements grammY's small `StorageAdapter` interface directly —
 * only three methods are required (`read`/`write`/`delete`), which map
 * 1:1 onto `findUnique`/`upsert`/`delete` against the single-row-per-key
 * table. See prisma/schema.prisma's own comment on that model.
 */
const prismaStorageAdapter: StorageAdapter<SessionData> = {
  async read(key) {
    const row = await prisma.telegramBotSession.findUnique({ where: { key } });
    return row ? (row.data as unknown as SessionData) : undefined;
  },
  async write(key, value) {
    await prisma.telegramBotSession.upsert({
      where: { key },
      update: { data: value as unknown as Prisma.InputJsonValue },
      create: { key, data: value as unknown as Prisma.InputJsonValue },
    });
  },
  async delete(key) {
    await prisma.telegramBotSession.delete({ where: { key } }).catch(() => {
      // Already absent — deleting a non-existent session key is a no-op,
      // matching grammY's own documented "delete" contract.
    });
  },
};

/**
 * Lazily constructs (once per server process) the grammY bot instance with
 * session storage backed by the same Postgres database as the rest of the
 * app (via Prisma) — no second database connection to manage.
 *
 * Returns null if TELEGRAM_BOT_TOKEN isn't configured, so every caller can
 * simply no-op instead of crashing when the bot isn't set up yet.
 */
export async function getBot(): Promise<Bot<BotContext> | null> {
  if (!env.TELEGRAM_BOT_TOKEN) return null;
  if (botInstance) return botInstance;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const bot = new Bot<BotContext>(env.TELEGRAM_BOT_TOKEN!);

    bot.use(
      session({
        initial: (): SessionData => ({}),
        storage: prismaStorageAdapter,
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
