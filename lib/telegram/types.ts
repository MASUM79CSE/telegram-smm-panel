import type { Context, SessionFlavor } from "grammy";
import type { ConversationFlavor } from "@grammyjs/conversations";

/** Session data persisted per-chat in MongoDB (see lib/telegram/bot.ts). */
export interface SessionData {
  /** Cached linked panel user id once /link succeeds, to avoid a DB lookup on every update. */
  linkedUserId?: string;
}

export type BotContext = ConversationFlavor<Context & SessionFlavor<SessionData>>;
