import { Schema, model, models, Model, Types } from "mongoose";
import { Decimal128 } from "mongodb";

export type TransactionType = "DEPOSIT" | "ORDER_PAYMENT" | "ORDER_REFUND" | "ADJUSTMENT";
export type TransactionStatus = "PENDING" | "COMPLETED" | "FAILED" | "CANCELED";

export interface ITransaction {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  walletId: Types.ObjectId;

  type: TransactionType;
  status: TransactionStatus;

  amount: Decimal128;
  balanceBefore: Decimal128;
  balanceAfter: Decimal128;

  description: string | null;

  /** Links to Order / Payment id that caused this ledger entry, for traceability. */
  relatedOrderId: Types.ObjectId | null;
  relatedPaymentId: Types.ObjectId | null;

  /** Idempotency key so the same external event (e.g. webhook retry) never double-applies. */
  idempotencyKey: string | null;

  createdAt: Date;
}

const transactionSchema = new Schema<ITransaction>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    walletId: { type: Schema.Types.ObjectId, ref: "Wallet", required: true, index: true },

    type: { type: String, enum: ["DEPOSIT", "ORDER_PAYMENT", "ORDER_REFUND", "ADJUSTMENT"], required: true },
    status: { type: String, enum: ["PENDING", "COMPLETED", "FAILED", "CANCELED"], default: "COMPLETED" },

    amount: { type: Schema.Types.Decimal128, required: true },
    balanceBefore: { type: Schema.Types.Decimal128, required: true },
    balanceAfter: { type: Schema.Types.Decimal128, required: true },

    description: { type: String, default: null },

    relatedOrderId: { type: Schema.Types.ObjectId, ref: "Order", default: null, index: true },
    relatedPaymentId: { type: Schema.Types.ObjectId, ref: "Payment", default: null, index: true },

    // NOTE: deliberately NO `default: null` here. A MongoDB sparse index
    // only excludes documents where the field is completely ABSENT, not
    // documents that explicitly store `null` — `default: null` would make
    // Mongoose write `idempotencyKey: null` onto every transaction that
    // doesn't set one, and the second such transaction would then collide
    // on this unique index (found and fixed live: see MEMORY.md §7 for the
    // incident writeup). Leaving no default means the field is truly
    // omitted from the document when not provided, which is what `sparse`
    // actually requires to work as intended.
    idempotencyKey: { type: String, unique: true, sparse: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

transactionSchema.index({ userId: 1, createdAt: -1 });

export const Transaction: Model<ITransaction> =
  models.Transaction || model<ITransaction>("Transaction", transactionSchema);
