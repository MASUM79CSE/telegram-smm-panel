import { Schema, model, models, Model, Types } from "mongoose";

export type UserRole = "USER" | "ADMIN";
export type UserStatus = "ACTIVE" | "SUSPENDED" | "BANNED";

export interface IUser {
  _id: Types.ObjectId;
  name: string;
  email: string;
  passwordHash: string | null;
  role: UserRole;
  status: UserStatus;

  emailVerified: Date | null;

  // Telegram account linking (Step 11 groundwork)
  telegramId: string | null;
  telegramUsername: string | null;

  // Security
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  twoFactorEnabled: boolean;
  twoFactorSecret: string | null;

  lastLoginAt: Date | null;
  lastLoginIp: string | null;

  /**
   * Saved/favorite services (docs/DASHBOARD_UPGRADE_PLAN.md §3.6) — a plain
   * array on `User` rather than a separate join collection, since this
   * project doesn't need per-favorite timestamps and the expected list size
   * per user is small (dozens at most, not the kind of scale that would
   * make an unbounded array on the parent document a real concern).
   */
  favoriteServiceIds: Types.ObjectId[];

  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    passwordHash: { type: String, default: null, select: false },
    role: { type: String, enum: ["USER", "ADMIN"], default: "USER", index: true },
    status: { type: String, enum: ["ACTIVE", "SUSPENDED", "BANNED"], default: "ACTIVE", index: true },

    emailVerified: { type: Date, default: null },

    // No `default: null` here: a sparse unique index only excludes documents
    // where the field is *missing*, not ones explicitly set to `null`. If we
    // defaulted to null, every user without a linked Telegram account would
    // collide on the same `telegramId: null` value and registration would
    // fail with a duplicate key error after the first non-Telegram user.
    telegramId: { type: String, unique: true, sparse: true },
    telegramUsername: { type: String, default: null },

    failedLoginAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    twoFactorEnabled: { type: Boolean, default: false },
    twoFactorSecret: { type: String, default: null, select: false },

    lastLoginAt: { type: Date, default: null },
    lastLoginIp: { type: String, default: null },

    favoriteServiceIds: { type: [Schema.Types.ObjectId], ref: "Service", default: [] },
  },
  { timestamps: true }
);

userSchema.index({ createdAt: -1 });

export const User: Model<IUser> = models.User || model<IUser>("User", userSchema);
