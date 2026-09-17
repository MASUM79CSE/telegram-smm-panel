import { InlineKeyboard } from "grammy";
import { sendTelegramMessage } from "@/lib/telegram/client";
import { escapeHtml } from "@/lib/telegram/format";
import { env } from "@/lib/env";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import type { Order, Payment, SupportTicket } from "@/lib/generated/prisma";
import { logger } from "@/lib/logger";

/**
 * Cross-cutting Telegram notifications, called from both the website API
 * routes and the bot's own conversations, so admins/users get the same
 * alerts regardless of which surface (web or bot) an event originated from.
 *
 * Every function here is best-effort and MUST NOT throw — a failed Telegram
 * notification must never break the underlying business operation (order
 * placement, payment approval, etc). Callers already wrap these in
 * `.catch((err) => log.error({ err }, ...))`, but we also guard internally
 * since some call sites (e.g. inside the bot) call these inline.
 */

async function notifyAdmin(text: string, replyMarkup?: InlineKeyboard): Promise<void> {
  if (!env.TELEGRAM_ADMIN_CHAT_ID) return;
  await sendTelegramMessage(env.TELEGRAM_ADMIN_CHAT_ID, text, replyMarkup);
}

async function notifyUserByTelegram(userId: string, text: string): Promise<void> {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { telegramId: true } });
    if (!user?.telegramId) return;
    await sendTelegramMessage(user.telegramId, text);
  } catch (err) {
    logger.error({ err, userId }, "[telegram] notifyUserByTelegram failed");
  }
}

export async function notifyOrderPlaced(order: Order): Promise<void> {
  const keyboard = new InlineKeyboard().url(
    "🔗 View in Admin Dashboard",
    `${env.NEXT_PUBLIC_APP_URL}/admin/orders`
  );

  await notifyAdmin(
    `🛒 <b>New order placed</b>\n` +
      `Order: <code>${order.id}</code>\n` +
      `Quantity: ${order.quantity}\n` +
      `Charge: ${formatMoney(order.charge)}\n` +
      `Target: ${escapeHtml(order.target)}`,
    keyboard
  );
}

export async function notifyOrderStatusChanged(
  userId: string,
  orderId: string,
  status: string,
  note?: string | null
): Promise<void> {
  await notifyUserByTelegram(
    userId,
    `📦 <b>Order update</b>\n` +
      `Order <code>${orderId}</code> is now <b>${escapeHtml(status)}</b>.` +
      (note ? `\n${escapeHtml(note)}` : "")
  );
}

export async function notifyAdminNewDeposit(payment: Payment): Promise<void> {
  const keyboard = new InlineKeyboard()
    .text("✅ Approve", `dep:approve:${payment.id}`)
    .text("❌ Reject", `dep:reject:${payment.id}`);

  await notifyAdmin(
    `💰 <b>New deposit request</b>\n` +
      `Amount: ${formatMoney(payment.amount, payment.currency)}\n` +
      `Method: ${payment.method}\n` +
      `Ref: <code>${escapeHtml(payment.transactionRef ?? "—")}</code>`,
    keyboard
  );
}

export async function notifyUserDepositReviewed(
  userId: string,
  approved: boolean,
  amount: string,
  reason?: string | null
): Promise<void> {
  await notifyUserByTelegram(
    userId,
    approved
      ? `✅ <b>Deposit approved</b>\nYour deposit of ${escapeHtml(amount)} has been credited to your wallet.`
      : `❌ <b>Deposit rejected</b>\nYour deposit of ${escapeHtml(amount)} was rejected.` +
          (reason ? `\nReason: ${escapeHtml(reason)}` : "")
  );
}

export async function notifyAdminNewTicket(ticket: SupportTicket): Promise<void> {
  const keyboard = new InlineKeyboard().url(
    "🔗 Reply in Admin Dashboard",
    `${env.NEXT_PUBLIC_APP_URL}/admin/support/${ticket.id}`
  );

  await notifyAdmin(
    `🎫 <b>New support ticket</b>\n` +
      `Subject: ${escapeHtml(ticket.subject)}\n` +
      `Priority: ${ticket.priority}`,
    keyboard
  );
}

export async function notifyTicketReply(
  userId: string,
  ticketId: string,
  subject: string,
  isAdminReply: boolean
): Promise<void> {
  if (!isAdminReply) {
    // A reply from an admin needs to notify the customer via bot; a reply
    // from the customer (isAdminReply=false) should alert the admin instead.
    await notifyAdmin(`💬 <b>New reply on ticket</b>\n${escapeHtml(subject)} (<code>${ticketId}</code>)`);
    return;
  }
  await notifyUserByTelegram(
    userId,
    `💬 <b>Support replied</b>\nYour ticket "${escapeHtml(subject)}" has a new reply.`
  );
}
