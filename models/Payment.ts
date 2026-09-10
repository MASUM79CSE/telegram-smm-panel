import { Schema, model, models, Model, Types } from "mongoose";
import { Decimal128 } from "mongodb";

export type PaymentMethod = "BKASH" | "NAGAD" | "SSLCOMMERZ" | "MANUAL" | "CRYPTO";
export type PaymentStatus = "PENDING" | "COMPLETED" | "FAILED" | "CANCELED" | "REJECTED";

export interface IPayment {
  _id: Types.ObjectId;
  userId: Types.ObjectId;

  amount: Decimal128;
  currency: string;

  method: PaymentMethod;
  /** Gateway/manual reference number supplied by user or returned by gateway. */
  transactionRef: string | null;

  status: PaymentStatus;

  /** Raw gateway webhook/callback payload, for audit/debugging. */
  gatewayPayload: unknown;

  reviewedBy: Types.ObjectId | null;
  reviewedAt: Date | null;
  rejectionReason: string | null;

  createdAt: Date;
  updatedAt: Date;
}

const paymentSchema = new Schema<IPayment>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },

    amount: { type: Schema.Types.Decimal128, required: true },
    currency: { type: String, default: "BDT" },

    method: { type: String, enum: ["BKASH", "NAGAD", "SSLCOMMERZ", "MANUAL", "CRYPTO"], required: true },
    transactionRef: { type: String, default: null, unique: true, sparse: true },

    status: { type: String, enum: ["PENDING", "COMPLETED", "FAILED", "CANCELED", "REJECTED"], default: "PENDING", index: true },

    gatewayPayload: { type: Schema.Types.Mixed, default: null },

    reviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: null },
  },
  { timestamps: true }
);

paymentSchema.index({ userId: 1, createdAt: -1 });

export const Payment: Model<IPayment> = models.Payment || model<IPayment>("Payment", paymentSchema);
