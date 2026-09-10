import { Schema, model, models, Model, Types } from "mongoose";

/**
 * A Provider represents an upstream fulfillment source for orders.
 *
 * - API: A remote SMM-panel-style HTTP API (add/status/refill/cancel actions).
 * - MANUAL: Fulfilled by an admin/operator manually (no automated API).
 * - INTERNAL: Fulfilled by this platform's own bot/automation (e.g. Telegram bot
 *   actions your organization directly controls and is authorized to perform).
 *
 * IMPORTANT (compliance): This platform is designed for legitimate, compliant
 * services (e.g. content distribution to consenting audiences, channel/group
 * management automation, ads assistance) — not fake engagement, bot followers,
 * or ToS-violating automation. Enforce this at the product/service level.
 */
export type ProviderType = "API" | "MANUAL" | "INTERNAL";
export type ProviderStatus = "ACTIVE" | "DISABLED";

export interface IProvider {
  _id: Types.ObjectId;
  name: string;
  type: ProviderType;
  status: ProviderStatus;

  apiUrl: string | null;
  /** Encrypted at rest — see lib/crypto.ts. Never return in API responses. */
  apiKeyEncrypted: string | null;

  /** Currency exchange applied to provider cost before storing as internal cost. */
  balance: string | null; // cached last-known provider balance (display only)
  lastBalanceSyncAt: Date | null;

  notes: string | null;

  createdAt: Date;
  updatedAt: Date;
}

const providerSchema = new Schema<IProvider>(
  {
    name: { type: String, required: true, unique: true, trim: true },
    type: { type: String, enum: ["API", "MANUAL", "INTERNAL"], required: true },
    status: { type: String, enum: ["ACTIVE", "DISABLED"], default: "ACTIVE", index: true },

    apiUrl: { type: String, default: null },
    apiKeyEncrypted: { type: String, default: null, select: false },

    balance: { type: String, default: null },
    lastBalanceSyncAt: { type: Date, default: null },

    notes: { type: String, default: null },
  },
  { timestamps: true }
);

export const Provider: Model<IProvider> = models.Provider || model<IProvider>("Provider", providerSchema);
