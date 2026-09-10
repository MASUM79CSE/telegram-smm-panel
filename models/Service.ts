import { Schema, model, models, Model, Types } from "mongoose";
import { Decimal128 } from "mongodb";

export type ServiceType = "DEFAULT" | "CUSTOM_COMMENTS" | "MENTIONS" | "SUBSCRIPTIONS";

export interface IService {
  _id: Types.ObjectId;
  categoryId: Types.ObjectId;

  name: string;
  description: string | null;
  type: ServiceType;

  /** Price charged to the customer per 1000 units (standard SMM-panel convention). */
  rate: Decimal128;

  /** Underlying provider fulfillment config (optional — MANUAL/INTERNAL types may omit). */
  providerId: Types.ObjectId | null;
  /** The provider's own service id, used when calling their `add` API action. */
  providerServiceId: string | null;
  /** Provider's own rate per 1000, cached for margin calculations/reporting. */
  providerRate: Decimal128 | null;

  minQuantity: number;
  maxQuantity: number;

  active: boolean;
  /** If true, hidden from customer catalog but still processable (e.g. deprecated). */
  hidden: boolean;

  /**
   * Self-service refill eligibility window in days (docs/IMPLEMENTATION_PLAN.md
   * Phase 3.1). `null` = this service does not support refills at all (the
   * admin has not opted it in) — distinct from an order simply being outside
   * an otherwise-configured window.
   */
  refillDays: number | null;

  /**
   * Precomputed median minutes from order creation to COMPLETED, refreshed
   * periodically by `scripts/compute-delivery-estimates.ts` (Phase 3.3).
   * `null` until at least one completed order exists to compute from —
   * deliberately NOT computed live per-request (see that script's doc
   * comment for why).
   */
  estimatedDeliveryMinutes: number | null;

  createdAt: Date;
  updatedAt: Date;
}

const serviceSchema = new Schema<IService>(
  {
    categoryId: { type: Schema.Types.ObjectId, ref: "Category", required: true, index: true },

    name: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: null, maxlength: 2000 },
    type: { type: String, enum: ["DEFAULT", "CUSTOM_COMMENTS", "MENTIONS", "SUBSCRIPTIONS"], default: "DEFAULT" },

    rate: { type: Schema.Types.Decimal128, required: true },

    providerId: { type: Schema.Types.ObjectId, ref: "Provider", default: null },
    providerServiceId: { type: String, default: null },
    providerRate: { type: Schema.Types.Decimal128, default: null },

    minQuantity: { type: Number, required: true, min: 1 },
    maxQuantity: { type: Number, required: true, min: 1 },

    active: { type: Boolean, default: true, index: true },
    hidden: { type: Boolean, default: false },

    refillDays: { type: Number, default: null, min: 0 },
    estimatedDeliveryMinutes: { type: Number, default: null, min: 0 },
  },
  { timestamps: true }
);

serviceSchema.index({ categoryId: 1, active: 1 });

export const Service: Model<IService> = models.Service || model<IService>("Service", serviceSchema);
