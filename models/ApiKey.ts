import { Schema, model, models, Model, Types } from "mongoose";

/**
 * A customer-issued API key for the reseller endpoint (`POST /api/v2`,
 * docs/IMPLEMENTATION_PLAN.md Phase 2.2). Follows the exact same
 * "never store the raw secret, only its hash" convention already used by
 * `VerificationToken.tokenHash` (`lib/crypto.ts#hashToken`/`generateRawToken`)
 * — the raw key is generated once, shown to the user exactly once at
 * creation time, and is unrecoverable after that (the user must revoke and
 * re-issue if it's lost), same UX/security tradeoff as a password.
 *
 * One user can hold multiple keys (e.g. to rotate without downtime, or to
 * label keys per integration) — no uniqueness constraint on `userId`.
 */
export interface IApiKey {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  /** SHA-256 hash of the raw key (`lib/crypto.ts#hashToken`) — the raw key is never stored. */
  keyHash: string;
  /** First 8 chars of the raw key, stored only for display ("sk_live_a1b2c3..."), never enough to authenticate with. */
  keyPrefix: string;
  label: string | null;
  lastUsedAt: Date | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const apiKeySchema = new Schema<IApiKey>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    keyHash: { type: String, required: true, unique: true },
    keyPrefix: { type: String, required: true },
    label: { type: String, default: null, maxlength: 100 },
    lastUsedAt: { type: Date, default: null },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

apiKeySchema.index({ userId: 1, createdAt: -1 });

export const ApiKey: Model<IApiKey> = models.ApiKey || model<IApiKey>("ApiKey", apiKeySchema);
