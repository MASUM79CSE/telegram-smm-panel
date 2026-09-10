import { Schema, model, models, Model, Types } from "mongoose";
import { Decimal128 } from "mongodb";

/**
 * Links a customer-facing `Service` (the SKU shown in our catalog) to one or
 * more upstream `Provider`s that can fulfill it, with a priority order for
 * automatic failover (see docs/IMPLEMENTATION_PLAN.md Phase 2.1).
 *
 * Before this model existed, a `Service` could only ever point at a single
 * `Provider` via `Service.providerId`/`providerServiceId`/`providerRate` —
 * if that one provider's API failed or went down, the order would sit
 * retrying against the same broken provider forever. This model makes
 * "which provider(s) can fulfill this service, and in what order to try
 * them" a first-class, many-to-many relationship instead.
 *
 * `Service.providerId`/`providerServiceId`/`providerRate` are kept
 * (deprecated, not removed — see docs/DATABASE.md §2) as a zero-migration
 * fallback for services that haven't been backfilled into this table yet;
 * `lib/fulfillment.ts` prefers `ServiceProvider` rows when they exist and
 * only falls back to the legacy single-provider fields otherwise.
 *
 * Unique compound index on `{ serviceId, providerId }`: a given provider
 * should only ever be linked to a service once — if you need to change its
 * priority/rate/providerServiceId, update the existing row, don't create a
 * second ambiguous one.
 */
export interface IServiceProvider {
  _id: Types.ObjectId;
  serviceId: Types.ObjectId; // ref Service — the customer-facing SKU
  providerId: Types.ObjectId; // ref Provider
  /** The provider's own service id, used when calling their `add` API action. */
  providerServiceId: string;
  /** Provider's own rate per 1000, cached for margin calculations/reporting. */
  providerRate: Decimal128;
  /** Lower priority number = tried first during dispatch fallback. */
  priority: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const serviceProviderSchema = new Schema<IServiceProvider>(
  {
    serviceId: { type: Schema.Types.ObjectId, ref: "Service", required: true, index: true },
    providerId: { type: Schema.Types.ObjectId, ref: "Provider", required: true },
    providerServiceId: { type: String, required: true, trim: true },
    providerRate: { type: Schema.Types.Decimal128, required: true },
    priority: { type: Number, default: 0 },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

serviceProviderSchema.index({ serviceId: 1, active: 1, priority: 1 });
serviceProviderSchema.index({ serviceId: 1, providerId: 1 }, { unique: true });

export const ServiceProvider: Model<IServiceProvider> =
  models.ServiceProvider || model<IServiceProvider>("ServiceProvider", serviceProviderSchema);
