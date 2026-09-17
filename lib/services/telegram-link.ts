import { nanoid } from "nanoid";

import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";

const LINK_CODE_TTL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Generates a short, human-typeable link code (shown on the website dashboard)
 * that the user then sends to the bot via `/link <code>` to associate their
 * Telegram account with their panel account. Reuses the VerificationToken
 * model (purpose: TELEGRAM_LINK) rather than a new table — it already has
 * an `expiresAt` index and one-time-use semantics we need here.
 */
export async function createTelegramLinkCode(userId: string): Promise<string> {
  // Invalidate any previous unused link codes for this user so only the
  // most recently generated one is valid (avoids stale codes lingering).
  await prisma.verificationToken.updateMany({
    where: { userId, purpose: "TELEGRAM_LINK", usedAt: null },
    data: { usedAt: new Date() },
  });

  const code = nanoid(8).toUpperCase();

  await prisma.verificationToken.create({
    data: {
      userId,
      tokenHash: code, // short-lived, low-entropy code by design; not a security-critical secret like a password reset token
      purpose: "TELEGRAM_LINK",
      expiresAt: new Date(Date.now() + LINK_CODE_TTL_MS),
    },
  });

  return code;
}

export async function linkTelegramAccount(params: {
  code: string;
  telegramId: string;
  telegramUsername: string | null;
}): Promise<{ userId: string; name: string }> {
  const { code, telegramId, telegramUsername } = params;

  const record = await prisma.verificationToken.findFirst({
    where: {
      tokenHash: code.toUpperCase(),
      purpose: "TELEGRAM_LINK",
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
  });

  if (!record) {
    throw new AppError("INVALID_CODE", "That code is invalid or has expired. Generate a new one from your dashboard.");
  }

  const alreadyLinked = await prisma.user.findUnique({ where: { telegramId } });
  if (alreadyLinked && alreadyLinked.id !== record.userId) {
    throw new AppError("ALREADY_LINKED", "This Telegram account is already linked to a different panel account.");
  }

  const user = await prisma.user.update({
    where: { id: record.userId },
    data: { telegramId, telegramUsername },
  });

  if (!user) {
    throw new AppError("USER_NOT_FOUND", "Panel account not found.");
  }

  await prisma.verificationToken.update({
    where: { id: record.id },
    data: { usedAt: new Date() },
  });

  return { userId: user.id, name: user.name };
}

export async function unlinkTelegramAccount(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { telegramId: null, telegramUsername: null },
  });
}
