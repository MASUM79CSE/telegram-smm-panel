import { Schema, model, models, Model, Types } from "mongoose";
import { Decimal128 } from "mongodb";

export interface IWallet {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  balance: Decimal128;
  currency: string;
  /** Optimistic concurrency guard; incremented on every balance mutation. */
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const walletSchema = new Schema<IWallet>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true, index: true },
    balance: { type: Schema.Types.Decimal128, required: true, default: () => Decimal128.fromString("0") },
    currency: { type: String, default: "USD" },
    version: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const Wallet: Model<IWallet> = models.Wallet || model<IWallet>("Wallet", walletSchema);
