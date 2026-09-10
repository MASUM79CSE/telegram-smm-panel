import { Schema, model, models, Model, Types } from "mongoose";

/**
 * In-app notification inbox, complementary to (not a replacement for) the
 * existing Telegram push notifications in `lib/telegram/notify.ts`
 * (docs/DASHBOARD_UPGRADE_PLAN.md §1.3). Every user (customer or admin)
 * gets their own rows — admins receive "admin-facing" event types
 * (NEW_ORDER, NEW_DEPOSIT, NEW_TICKET) while customers receive
 * "customer-facing" ones (their own order/deposit/ticket updates).
 */
export type NotificationType =
  | "ORDER_PLACED"
  | "ORDER_STATUS_CHANGED"
  | "ORDER_REFILL_RESOLVED"
  | "DEPOSIT_SUBMITTED"
  | "DEPOSIT_APPROVED"
  | "DEPOSIT_REJECTED"
  | "TICKET_CREATED"
  | "TICKET_REPLIED"
  | "NEW_ORDER" // admin-facing
  | "NEW_DEPOSIT" // admin-facing
  | "NEW_TICKET"; // admin-facing

export interface INotification {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  type: NotificationType;
  title: string;
  body: string;
  /** Relative path to navigate to when clicked, e.g. "/dashboard/orders". Locale-prefixing (if any) is applied by the UI, not stored here. */
  href: string | null;
  read: boolean;
  readAt: Date | null;
  createdAt: Date;
}

const notificationSchema = new Schema<INotification>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: {
      type: String,
      enum: [
        "ORDER_PLACED",
        "ORDER_STATUS_CHANGED",
        "ORDER_REFILL_RESOLVED",
        "DEPOSIT_SUBMITTED",
        "DEPOSIT_APPROVED",
        "DEPOSIT_REJECTED",
        "TICKET_CREATED",
        "TICKET_REPLIED",
        "NEW_ORDER",
        "NEW_DEPOSIT",
        "NEW_TICKET",
      ],
      required: true,
    },
    title: { type: String, required: true, maxlength: 200 },
    body: { type: String, required: true, maxlength: 500 },
    href: { type: String, default: null },
    read: { type: Boolean, default: false, index: true },
    readAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

notificationSchema.index({ userId: 1, read: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, createdAt: -1 });

export const Notification: Model<INotification> =
  models.Notification || model<INotification>("Notification", notificationSchema);
