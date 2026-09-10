import { Schema, model, models, Model, Types } from "mongoose";

export type TokenPurpose = "EMAIL_VERIFY" | "PASSWORD_RESET" | "TELEGRAM_LINK";

export interface IVerificationToken {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  /** SHA-256 hash of the raw token — the raw token is only ever sent via email, never stored. */
  tokenHash: string;
  purpose: TokenPurpose;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

const verificationTokenSchema = new Schema<IVerificationToken>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    purpose: { type: String, enum: ["EMAIL_VERIFY", "PASSWORD_RESET", "TELEGRAM_LINK"], required: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// TTL index: MongoDB automatically deletes expired tokens.
verificationTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const VerificationToken: Model<IVerificationToken> =
  models.VerificationToken || model<IVerificationToken>("VerificationToken", verificationTokenSchema);
