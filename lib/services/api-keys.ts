import { ApiKey, type IApiKey } from "@/models/ApiKey";
import { hashToken, generateRawToken } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import type { HydratedDocument } from "mongoose";
import { logger } from "@/lib/logger";

/**
 * Shared API-key issuance/lookup logic for the reseller endpoint
 * (docs/IMPLEMENTATION_PLAN.md Phase 2.2). Follows the exact same
 * "hash-only storage, raw value shown once" convention as
 * `lib/crypto.ts#hashToken`/`generateRawToken`, already used for
 * VerificationToken raw codes — reused here rather than inventing a second
 * token-generation scheme.
 */

const KEY_PREFIX = "smm_live_";

export async function createApiKey(params: {
  userId: string;
  label?: string | null;
}): Promise<{ apiKey: HydratedDocument<IApiKey>; rawKey: string }> {
  const raw = `${KEY_PREFIX}${generateRawToken()}`;
  const keyHash = hashToken(raw);

  const apiKey = await ApiKey.create({
    userId: params.userId,
    keyHash,
    keyPrefix: raw.slice(0, KEY_PREFIX.length + 8),
    label: params.label ?? null,
    active: true,
  });

  return { apiKey, rawKey: raw };
}

/**
 * Resolves a raw API key (as sent by a reseller in `/api/v2` requests) to
 * its owning, active `ApiKey` document. Also stamps `lastUsedAt` — best
 * effort, not awaited by callers that don't need to block on it.
 */
export async function resolveApiKey(rawKey: string): Promise<HydratedDocument<IApiKey>> {
  if (!rawKey || typeof rawKey !== "string") {
    throw new AppError("INVALID_API_KEY", "Invalid API key.");
  }

  const keyHash = hashToken(rawKey);
  const apiKey = await ApiKey.findOne({ keyHash, active: true });

  if (!apiKey) {
    throw new AppError("INVALID_API_KEY", "Invalid API key.");
  }

  // Fire-and-forget — must never block or fail the actual request.
  ApiKey.updateOne({ _id: apiKey._id }, { $set: { lastUsedAt: new Date() } }).catch((err) =>
    logger.error({ err, apiKeyId: apiKey._id.toString() }, "[api-keys] Failed to stamp lastUsedAt")
  );

  return apiKey;
}
