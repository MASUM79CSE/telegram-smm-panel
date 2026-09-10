import { Schema, model, models, Model, Types } from "mongoose";
import { Decimal128 } from "mongodb";

export type OrderStatus =
  | "PENDING" // created, awaiting dispatch to provider/queue
  | "PROCESSING" // dispatched, waiting on provider acknowledgement
  | "IN_PROGRESS" // provider confirmed and is actively fulfilling
  | "COMPLETED"
  | "PARTIAL"
  | "CANCELED"
  | "FAILED"
  | "REFUNDED";

export interface IOrderStatusEvent {
  status: OrderStatus;
  note: string | null;
  at: Date;
}

export type RefillStatus = "NONE" | "REQUESTED" | "COMPLETED" | "REJECTED";

export interface IOrder {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  serviceId: Types.ObjectId;
  providerId: Types.ObjectId | null;

  target: string; // link/username/channel — validated per service type
  quantity: number;
  startCount: number | null;
  remains: number | null;

  charge: Decimal128; // amount deducted from customer wallet

  status: OrderStatus;
  statusHistory: IOrderStatusEvent[];

  providerOrderId: string | null;
  providerResponse: unknown;

  /** Number of automated fulfillment attempts, to cap retries. */
  attempts: number;
  lastAttemptAt: Date | null;
  lastError: string | null;

  /**
   * Self-service refill request state (docs/IMPLEMENTATION_PLAN.md Phase
   * 3.1). `NONE` until the customer requests one; only meaningful once the
   * order has reached `COMPLETED`. `completedAt` is set the moment an order
   * first transitions to `COMPLETED` — needed to enforce the service's
   * `refillDays` eligibility window (see `Service.refillDays`) without
   * relying on `statusHistory` array scanning on every request.
   */
  completedAt: Date | null;
  refillStatus: RefillStatus;
  refillRequestedAt: Date | null;
  providerRefillId: string | null;

  /**
   * Set once a `status`-polling pass (Phase 3.2) observes provider-reported
   * partial delivery and issues the proportional refund — guards against
   * ever refunding the same shortfall twice across repeated polls.
   */
  partialRefundIssuedAt: Date | null;
  /** Timestamp of the most recent provider status poll, for scheduling/backoff. */
  lastStatusCheckAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

const orderSchema = new Schema<IOrder>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    serviceId: { type: Schema.Types.ObjectId, ref: "Service", required: true, index: true },
    providerId: { type: Schema.Types.ObjectId, ref: "Provider", default: null },

    target: { type: String, required: true, trim: true, maxlength: 500 },
    quantity: { type: Number, required: true, min: 1 },
    startCount: { type: Number, default: null },
    remains: { type: Number, default: null },

    charge: { type: Schema.Types.Decimal128, required: true },

    status: {
      type: String,
      enum: ["PENDING", "PROCESSING", "IN_PROGRESS", "COMPLETED", "PARTIAL", "CANCELED", "FAILED", "REFUNDED"],
      default: "PENDING",
      index: true,
    },
    statusHistory: [
      {
        status: { type: String, required: true },
        note: { type: String, default: null },
        at: { type: Date, default: Date.now },
      },
    ],

    providerOrderId: { type: String, default: null, index: true },
    providerResponse: { type: Schema.Types.Mixed, default: null },

    attempts: { type: Number, default: 0 },
    lastAttemptAt: { type: Date, default: null },
    lastError: { type: String, default: null },

    completedAt: { type: Date, default: null },
    refillStatus: {
      type: String,
      enum: ["NONE", "REQUESTED", "COMPLETED", "REJECTED"],
      default: "NONE",
    },
    refillRequestedAt: { type: Date, default: null },
    providerRefillId: { type: String, default: null },

    partialRefundIssuedAt: { type: Date, default: null },
    lastStatusCheckAt: { type: Date, default: null },
  },
  { timestamps: true }
);

orderSchema.index({ userId: 1, createdAt: -1 });
orderSchema.index({ status: 1, createdAt: 1 });
// Backs the Phase 3.2 status-polling worker's candidate query (orders
// actively IN_PROGRESS, oldest-checked-first).
orderSchema.index({ status: 1, lastStatusCheckAt: 1 });

export const Order: Model<IOrder> = models.Order || model<IOrder>("Order", orderSchema);
