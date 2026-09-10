import { InlineKeyboard } from "grammy";
import { createConversation } from "@grammyjs/conversations";
import type { Conversation } from "@grammyjs/conversations";

import { connectDB } from "@/lib/db";
import { User } from "@/models/User";
import { Wallet } from "@/models/Wallet";
import { Order } from "@/models/Order";
import { Category } from "@/models/Category";
import { Service } from "@/models/Service";
import type { PaymentMethod } from "@/models/Payment";
import { formatMoney } from "@/lib/money";
import { escapeHtml } from "@/lib/telegram/format";
import { getBot } from "@/lib/telegram/client";
import { linkTelegramAccount, unlinkTelegramAccount } from "@/lib/services/telegram-link";
import { placeOrder } from "@/lib/services/orders";
import { submitDeposit } from "@/lib/services/payments";
import { createTicket } from "@/lib/services/tickets";
import { approveDeposit, rejectDeposit } from "@/lib/services/admin-payments";
import { notifyAdminNewDeposit, notifyAdminNewTicket, notifyOrderPlaced, notifyUserDepositReviewed } from "@/lib/telegram/notify";
import { recordAudit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { BotContext } from "@/lib/telegram/types";

let registered = false;

/** Loads the linked panel user for the current Telegram chat, or null if unlinked. */
async function getLinkedUser(ctx: BotContext) {
  const telegramId = String(ctx.from!.id);
  await connectDB();
  return User.findOne({ telegramId });
}

function requireLinked<T extends BotContext>(handler: (ctx: T, user: NonNullable<Awaited<ReturnType<typeof getLinkedUser>>>) => Promise<void>) {
  return async (ctx: T) => {
    const user = await getLinkedUser(ctx);
    if (!user) {
      await ctx.reply(
        "🔒 Your Telegram account isn't linked to a panel account yet.\n\n" +
          "Go to your dashboard → Settings → Telegram, copy the code shown, then send:\n" +
          "<code>/link YOUR_CODE</code>",
        { parse_mode: "HTML" }
      );
      return;
    }

    const { success } = await rateLimit("telegramBotAction", `tg:${ctx.from!.id}`);
    if (!success) {
      await ctx.reply("⏳ You're doing that too fast. Please wait a moment and try again.");
      return;
    }

    await handler(ctx, user);
  };
}

const mainMenuKeyboard = new InlineKeyboard()
  .text("🛒 Order Service", "menu:order")
  .text("💰 Deposit", "menu:deposit")
  .row()
  .text("📦 My Orders", "menu:orders")
  .text("💳 Balance", "menu:balance")
  .row()
  .text("🎫 Support", "menu:support");

async function sendMainMenu(ctx: BotContext, greeting?: string) {
  await ctx.reply(
    (greeting ? `${greeting}\n\n` : "") + "What would you like to do?",
    { reply_markup: mainMenuKeyboard }
  );
}

/**
 * Conversation: /order — walk the user through category → service → target → quantity,
 * reusing the exact same `placeOrder` service the website uses (same wallet
 * transaction, same validation, same fulfillment dispatch).
 */
async function orderConversation(conversation: Conversation<BotContext, BotContext>, ctx: BotContext) {
  // IMPORTANT: `conversation.external()` results are JSON-serialized by the
  // conversations plugin so the conversation can be replayed deterministically
  // across restarts. Mongoose ObjectId/Decimal128 instances survive the FIRST
  // pass looking fine (still live objects), but silently turn into plain
  // strings on REPLAY — causing subtle bugs like `.toString()` on a value
  // that's already a string, or a raw ObjectId leaking into a Mongoose query
  // as `"[object Object]"`. To avoid this entirely, every `external()` call
  // below returns fully plain, pre-serialized (string/number/boolean) data —
  // never a Mongoose document, subdocument, ObjectId, or Decimal128.
  const user = await conversation.external(async () => {
    const u = await getLinkedUser(ctx);
    if (!u) return null;
    return { id: u._id.toString(), status: u.status as string };
  });

  if (!user) {
    await ctx.reply("Please link your account first with /link.");
    return;
  }

  const categories = await conversation.external(async () => {
    const docs = await Category.find({ active: true }).sort({ sortOrder: 1 }).lean();
    return docs.map((c) => ({ id: c._id.toString(), name: c.name }));
  });

  if (categories.length === 0) {
    await ctx.reply("No service categories are available right now.");
    return;
  }

  const catKeyboard = new InlineKeyboard();
  categories.forEach((c, i) => {
    catKeyboard.text(c.name, `cat:${c.id}`);
    if (i % 2 === 1) catKeyboard.row();
  });

  await ctx.reply("Choose a category:", { reply_markup: catKeyboard });
  const catCtx = await conversation.waitForCallbackQuery(/^cat:/);
  await catCtx.answerCallbackQuery();
  const categoryId = catCtx.callbackQuery.data.split(":")[1];

  const services = await conversation.external(async () => {
    const docs = await Service.find({ categoryId, active: true, hidden: false }).lean();
    return docs.map((s) => ({
      id: s._id.toString(),
      name: s.name,
      rate: s.rate.toString(),
      minQuantity: s.minQuantity,
      maxQuantity: s.maxQuantity,
    }));
  });

  if (services.length === 0) {
    await ctx.reply("No services available in this category right now.");
    return;
  }

  const svcKeyboard = new InlineKeyboard();
  services.forEach((s) => {
    svcKeyboard.text(`${s.name} — ${s.rate}/1000`, `svc:${s.id}`).row();
  });

  await ctx.reply("Choose a service:", { reply_markup: svcKeyboard });
  const svcCtx = await conversation.waitForCallbackQuery(/^svc:/);
  await svcCtx.answerCallbackQuery();
  const serviceId = svcCtx.callbackQuery.data.split(":")[1];
  const service = services.find((s) => s.id === serviceId)!;

  await ctx.reply(
    `Send the target link/username (e.g. https://t.me/yourchannel).\n` +
      `Quantity must be between ${service.minQuantity} and ${service.maxQuantity}.`
  );
  const targetCtx = await conversation.waitFor(":text");
  const target = targetCtx.msg.text.trim();

  await ctx.reply(`Send the quantity (${service.minQuantity}-${service.maxQuantity}):`);
  const qtyCtx = await conversation.waitFor(":text");
  const quantity = parseInt(qtyCtx.msg.text.trim(), 10);

  if (!Number.isFinite(quantity) || quantity < service.minQuantity || quantity > service.maxQuantity) {
    await ctx.reply("Invalid quantity. Order canceled — send /order to try again.");
    return;
  }

  const estimatedCharge = (parseFloat(service.rate) * quantity) / 1000;
  const confirmKeyboard = new InlineKeyboard().text("✅ Confirm", "order:confirm").text("❌ Cancel", "order:cancel");
  await ctx.reply(
    `<b>Confirm order</b>\nService: ${escapeHtml(service.name)}\nTarget: ${escapeHtml(target)}\n` +
      `Quantity: ${quantity}\nEstimated charge: ${formatMoney(estimatedCharge)}`,
    { parse_mode: "HTML", reply_markup: confirmKeyboard }
  );

  const confirmCtx = await conversation.waitForCallbackQuery(["order:confirm", "order:cancel"]);
  await confirmCtx.answerCallbackQuery();

  if (confirmCtx.callbackQuery.data === "order:cancel") {
    await ctx.reply("Order canceled.");
    return;
  }

  try {
    const result = await conversation.external(async () => {
      try {
        const order = await placeOrder({
          userId: user.id,
          userStatus: user.status,
          serviceId,
          target,
          quantity,
        });
        // Return plain data + fire the admin notification here (still inside
        // `external`, so it isn't re-run on replay) rather than passing the
        // Mongoose document back out to the conversation body.
        await notifyOrderPlaced(order);
        return {
          ok: true as const,
          orderId: order._id.toString(),
          charge: order.charge.toString(),
        };
      } catch (err) {
        if (err instanceof AppError) {
          return { ok: false as const, code: err.code, message: err.message };
        }
        throw err;
      }
    });

    if (!result.ok) {
      await ctx.reply(`❌ ${result.message}`);
      return;
    }

    await ctx.reply(
      `✅ Order placed!\nOrder ID: <code>${result.orderId}</code>\nCharge: ${formatMoney(result.charge)}`,
      { parse_mode: "HTML" }
    );
  } catch (err) {
    logger.error({ err }, "[telegram bot] order conversation error");
    await ctx.reply("Something went wrong placing your order. Please try again later.");
  }
}

/** Conversation: /deposit — collects method + amount + transaction ref, reuses submitDeposit. */
async function depositConversation(conversation: Conversation<BotContext, BotContext>, ctx: BotContext) {
  // See the long comment at the top of `orderConversation` — every value
  // returned from `conversation.external()` must be plain/JSON-safe.
  const user = await conversation.external(async () => {
    const u = await getLinkedUser(ctx);
    return u ? { id: u._id.toString() } : null;
  });

  if (!user) {
    await ctx.reply("Please link your account first with /link.");
    return;
  }

  const methods: PaymentMethod[] = ["BKASH", "NAGAD", "SSLCOMMERZ", "CRYPTO", "MANUAL"];
  const methodKeyboard = new InlineKeyboard();
  methods.forEach((m, i) => {
    methodKeyboard.text(m, `pm:${m}`);
    if (i % 2 === 1) methodKeyboard.row();
  });

  await ctx.reply("Choose a deposit method:", { reply_markup: methodKeyboard });
  const methodCtx = await conversation.waitForCallbackQuery(/^pm:/);
  await methodCtx.answerCallbackQuery();
  const method = methodCtx.callbackQuery.data.split(":")[1] as PaymentMethod;

  await ctx.reply("Enter the deposit amount (numbers only):");
  const amountCtx = await conversation.waitFor(":text");
  const amount = parseFloat(amountCtx.msg.text.trim());

  if (!Number.isFinite(amount) || amount <= 0) {
    await ctx.reply("Invalid amount. Deposit canceled — send /deposit to try again.");
    return;
  }

  await ctx.reply("Enter your transaction reference / TrxID:");
  const refCtx = await conversation.waitFor(":text");
  const transactionRef = refCtx.msg.text.trim();

  try {
    const result = await conversation.external(async () => {
      try {
        const payment = await submitDeposit({ userId: user.id, amount, method, transactionRef });
        await notifyAdminNewDeposit(payment);
        return { ok: true as const, amount: payment.amount.toString(), currency: payment.currency };
      } catch (err) {
        if (err instanceof AppError) {
          return { ok: false as const, message: err.message };
        }
        throw err;
      }
    });

    if (!result.ok) {
      await ctx.reply(`❌ ${result.message}`);
      return;
    }

    await ctx.reply(
      `✅ Deposit request submitted!\nAmount: ${formatMoney(result.amount, result.currency)}\n` +
        `It will be reviewed by an admin shortly.`
    );
  } catch (err) {
    logger.error({ err }, "[telegram bot] deposit conversation error");
    await ctx.reply("Something went wrong submitting your deposit. Please try again later.");
  }
}

/** Conversation: /support — collects subject + message, reuses createTicket. */
async function supportConversation(conversation: Conversation<BotContext, BotContext>, ctx: BotContext) {
  const user = await conversation.external(async () => {
    const u = await getLinkedUser(ctx);
    return u ? { id: u._id.toString() } : null;
  });

  if (!user) {
    await ctx.reply("Please link your account first with /link.");
    return;
  }

  await ctx.reply("What's the subject of your issue?");
  const subjectCtx = await conversation.waitFor(":text");
  const subject = subjectCtx.msg.text.trim();

  await ctx.reply("Describe your issue in detail:");
  const msgCtx = await conversation.waitFor(":text");
  const message = msgCtx.msg.text.trim();

  try {
    const ticketId = await conversation.external(async () => {
      const ticket = await createTicket({ userId: user.id, subject, priority: "MEDIUM", message });
      await notifyAdminNewTicket(ticket);
      return ticket._id.toString();
    });

    await ctx.reply(`✅ Support ticket created!\nTicket ID: <code>${ticketId}</code>`, {
      parse_mode: "HTML",
    });
  } catch (err) {
    logger.error({ err }, "[telegram bot] support conversation error");
    await ctx.reply("Something went wrong creating your ticket. Please try again later.");
  }
}

function isAdminChat(chatId: number): boolean {
  return !!env.TELEGRAM_ADMIN_CHAT_ID && String(chatId) === env.TELEGRAM_ADMIN_CHAT_ID;
}

/**
 * Registers all command/callback handlers on the shared bot instance exactly
 * once per server process (idempotent — safe to call from every webhook
 * invocation since `getBot()` caches the instance).
 */
export async function registerHandlers(): Promise<void> {
  if (registered) return;
  registered = true;

  const bot = await getBot();
  if (!bot) return;

  bot.use(createConversation(orderConversation, "order"));
  bot.use(createConversation(depositConversation, "deposit"));
  bot.use(createConversation(supportConversation, "support"));

  bot.use(async (ctx, next) => {
    logger.info(
      { telegramId: ctx.from?.id, username: ctx.from?.username },
      ctx.message?.text ?? ctx.callbackQuery?.data ?? "(non-text)"
    );
    await next();
  });

  bot.command("start", async (ctx) => {
    const user = await getLinkedUser(ctx);
    if (user) {
      await sendMainMenu(ctx, `Welcome back, ${escapeHtml(user.name)}!`);
    } else {
      await ctx.reply(
        "👋 Welcome to the SMM Panel bot!\n\n" +
          "To get started, link your panel account:\n" +
          "1. Log in to the website\n" +
          "2. Go to Dashboard → Settings → Telegram\n" +
          "3. Copy the code shown and send it here as:\n" +
          "<code>/link YOUR_CODE</code>",
        { parse_mode: "HTML" }
      );
    }
  });

  bot.command("link", async (ctx) => {
    const code = ctx.match?.toString().trim();
    if (!code) {
      await ctx.reply("Usage: <code>/link YOUR_CODE</code>", { parse_mode: "HTML" });
      return;
    }

    const { success } = await rateLimit("telegramLink", `tg-link-attempt:${ctx.from!.id}`);
    if (!success) {
      await ctx.reply("⏳ Too many attempts. Please wait a few minutes and try again.");
      return;
    }

    await connectDB();

    try {
      const result = await linkTelegramAccount({
        code,
        telegramId: String(ctx.from!.id),
        telegramUsername: ctx.from?.username ?? null,
      });
      await recordAudit({
        actorId: result.userId,
        action: "TELEGRAM_LINKED",
        targetType: "User",
        targetId: result.userId,
        metadata: { telegramId: String(ctx.from!.id) },
      });
      await ctx.reply(`✅ Linked! Welcome, ${escapeHtml(result.name)}.`);
      await sendMainMenu(ctx);
    } catch (err) {
      if (err instanceof AppError) {
        await ctx.reply(`❌ ${err.message}`);
        return;
      }
      logger.error({ err }, "[telegram bot] /link error");
      await ctx.reply("Something went wrong. Please try again later.");
    }
  });

  bot.command("unlink", requireLinked(async (ctx, user) => {
    await unlinkTelegramAccount(user._id.toString());
    await recordAudit({
      actorId: user._id.toString(),
      action: "TELEGRAM_UNLINKED",
      targetType: "User",
      targetId: user._id.toString(),
    });
    await ctx.reply("Your Telegram account has been unlinked.");
  }));

  bot.command("menu", requireLinked(async (ctx) => {
    await sendMainMenu(ctx);
  }));

  bot.command("balance", requireLinked(async (ctx, user) => {
    await connectDB();
    const wallet = await Wallet.findOne({ userId: user._id }).lean();
    await ctx.reply(`💳 Your balance: <b>${formatMoney(wallet?.balance ?? 0, wallet?.currency)}</b>`, {
      parse_mode: "HTML",
    });
  }));

  bot.command("orders", requireLinked(async (ctx, user) => {
    await connectDB();
    const orders = await Order.find({ userId: user._id })
      .sort({ createdAt: -1 })
      .limit(5)
      .populate("serviceId", "name")
      .lean();

    if (orders.length === 0) {
      await ctx.reply("You have no orders yet. Send /order to place one.");
      return;
    }

    const lines = orders.map((o) => {
      const service = o.serviceId as unknown as { name?: string } | null;
      return `<code>${o._id.toString()}</code> — ${escapeHtml(service?.name ?? "Service")} — ${o.status} — ${formatMoney(o.charge)}`;
    });

    await ctx.reply(`📦 <b>Your recent orders:</b>\n\n${lines.join("\n")}`, { parse_mode: "HTML" });
  }));

  bot.command("order", requireLinked(async (ctx) => {
    await ctx.conversation.enter("order");
  }));

  bot.command("deposit", requireLinked(async (ctx) => {
    await ctx.conversation.enter("deposit");
  }));

  bot.command("support", requireLinked(async (ctx) => {
    await ctx.conversation.enter("support");
  }));

  bot.callbackQuery("menu:order", requireLinked(async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter("order");
  }));
  bot.callbackQuery("menu:deposit", requireLinked(async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter("deposit");
  }));
  bot.callbackQuery("menu:support", requireLinked(async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter("support");
  }));
  bot.callbackQuery("menu:balance", requireLinked(async (ctx, user) => {
    await ctx.answerCallbackQuery();
    await connectDB();
    const wallet = await Wallet.findOne({ userId: user._id }).lean();
    await ctx.reply(`💳 Your balance: <b>${formatMoney(wallet?.balance ?? 0, wallet?.currency)}</b>`, {
      parse_mode: "HTML",
    });
  }));
  bot.callbackQuery("menu:orders", requireLinked(async (ctx, user) => {
    await ctx.answerCallbackQuery();
    await connectDB();
    const orders = await Order.find({ userId: user._id })
      .sort({ createdAt: -1 })
      .limit(5)
      .populate("serviceId", "name")
      .lean();

    if (orders.length === 0) {
      await ctx.reply("You have no orders yet. Send /order to place one.");
      return;
    }

    const lines = orders.map((o) => {
      const service = o.serviceId as unknown as { name?: string } | null;
      return `<code>${o._id.toString()}</code> — ${escapeHtml(service?.name ?? "Service")} — ${o.status} — ${formatMoney(o.charge)}`;
    });

    await ctx.reply(`📦 <b>Your recent orders:</b>\n\n${lines.join("\n")}`, { parse_mode: "HTML" });
  }));

  // --- Admin-only inline approve/reject buttons on deposit notifications ---
  bot.callbackQuery(/^dep:(approve|reject):/, async (ctx) => {
    if (!ctx.chat || !isAdminChat(ctx.chat.id)) {
      await ctx.answerCallbackQuery({ text: "Not authorized.", show_alert: true });
      return;
    }

    // Acknowledge the button press immediately. Telegram callback queries
    // expire ~15s after being sent, but the approval transaction below
    // (Mongo connection + atomic wallet update) can occasionally take longer
    // than that on a cold start — if we wait until after that work to call
    // `answerCallbackQuery`, Telegram rejects it with "query is too old" even
    // though the underlying approval succeeded. Ack now with a lightweight
    // toast, then report the real outcome via message edits/replies instead
    // (which have no such expiry).
    await ctx.answerCallbackQuery({ text: "Processing…" }).catch((err) => {
      logger.error({ err }, "[telegram bot] failed to ack callback query");
    });

    await connectDB();
    const [, action, paymentId] = ctx.callbackQuery.data.split(":");

    // The bot admin chat has no linked panel "reviewer" user id in general,
    // so we fall back to a well-known system marker. If the admin has ALSO
    // linked their own panel account to this same chat, prefer their id for
    // accurate audit trail attribution.
    const reviewer = await User.findOne({ telegramId: String(ctx.from!.id) });
    const reviewerId = reviewer?._id.toString();

    if (!reviewerId) {
      await ctx.reply("Link your admin panel account first (/link) to approve/reject from the bot.");
      return;
    }

    try {
      if (action === "approve") {
        const payment = await approveDeposit(paymentId, reviewerId);
        await recordAudit({
          actorId: reviewerId,
          actorEmail: reviewer!.email,
          action: "PAYMENT_APPROVED",
          targetType: "Payment",
          targetId: paymentId,
          metadata: { via: "telegram_bot" },
        });
        await ctx.editMessageText(`${ctx.callbackQuery.message?.text}\n\n✅ Approved by ${escapeHtml(reviewer!.name)}`, {
          parse_mode: "HTML",
        });
        await notifyUserDepositReviewed(payment.userId.toString(), true, formatMoney(payment.amount, payment.currency));
      } else {
        const payment = await rejectDeposit(paymentId, reviewerId);
        await recordAudit({
          actorId: reviewerId,
          actorEmail: reviewer!.email,
          action: "PAYMENT_REJECTED",
          targetType: "Payment",
          targetId: paymentId,
          metadata: { via: "telegram_bot" },
        });
        await ctx.editMessageText(`${ctx.callbackQuery.message?.text}\n\n❌ Rejected by ${escapeHtml(reviewer!.name)}`, {
          parse_mode: "HTML",
        });
        await notifyUserDepositReviewed(payment.userId.toString(), false, formatMoney(payment.amount, payment.currency));
      }
    } catch (err) {
      const message = err instanceof AppError ? err.message : "Failed to process this action.";
      await ctx.reply(`❌ ${message}`);
    }
  });

  bot.on("message:text", requireLinked(async (ctx) => {
    // Fallback for plain-text messages outside a conversation/command:
    // treat it as nothing actionable, just re-show the menu so users are
    // never stuck without a visible next step.
    await sendMainMenu(ctx, "Not sure what you mean — here's the menu:");
  }));

  bot.catch((err) => {
    logger.error({ err: err.error }, "[telegram bot] unhandled error");
  });
}
