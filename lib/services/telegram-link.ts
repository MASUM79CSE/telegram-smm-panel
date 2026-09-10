import { nanoid } from "nanoid";

import { VerificationToken } from "@/models/VerificationToken";
import { User } from "@/models/User";
import { AppError } from "@/lib/errors";

const LINK_CODE_TTL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Generates a short, human-typeable link code (shown on the website dashboard)
 * that the user then sends to the bot via `/link <code>` to associate their
 * Telegram account with their panel account. Reuses the VerificationToken
 * model (purpose: TELEGRAM_LINK) rather than a new collection — it already
 * has a TTL index and one-time-use semantics we need here.
 */
export async function createTelegramLinkCode(userId: string): Promise<string> {
  // Invalidate any previous unused link codes for this user so only the
  // most recently generated one is valid (avoids stale codes lingering).
  await VerificationToken.updateMany(
    { userId, purpose: "TELEGRAM_LINK", usedAt: null },
    { $set: { usedAt: new Date() } }
  );

  const code = nanoid(8).toUpperCase();

  await VerificationToken.create({
    userId,
    tokenHash: code, // short-lived, low-entropy code by design; not a security-critical secret like a password reset token
    purpose: "TELEGRAM_LINK",
    expiresAt: new Date(Date.now() + LINK_CODE_TTL_MS),
  });

  return code;
}

export async function linkTelegramAccount(params: {
  code: string;
  telegramId: string;
  telegramUsername: string | null;
}): Promise<{ userId: string; name: string }> {
  const { code, telegramId, telegramUsername } = params;

  const record = await VerificationToken.findOne({
    tokenHash: code.toUpperCase(),
    purpose: "TELEGRAM_LINK",
    usedAt: null,
    expiresAt: { $gt: new Date() },
  });

  if (!record) {
    throw new AppError("INVALID_CODE", "That code is invalid or has expired. Generate a new one from your dashboard.");
  }

  const alreadyLinked = await User.findOne({ telegramId });
  if (alreadyLinked && alreadyLinked._id.toString() !== record.userId.toString()) {
    throw new AppError("ALREADY_LINKED", "This Telegram account is already linked to a different panel account.");
  }

  const user = await User.findByIdAndUpdate(
    record.userId,
    { telegramId, telegramUsername },
    { returnDocument: "after" }
  );

  if (!user) {
    throw new AppError("USER_NOT_FOUND", "Panel account not found.");
  }

  record.usedAt = new Date();
  await record.save();

  return { userId: user._id.toString(), name: user.name };
}

export async function unlinkTelegramAccount(userId: string): Promise<void> {
  await User.findByIdAndUpdate(userId, { telegramId: null, telegramUsername: null });
}
