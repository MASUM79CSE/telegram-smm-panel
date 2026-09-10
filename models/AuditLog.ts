import { Schema, model, models, Model, Types } from "mongoose";

/**
 * Immutable audit trail for sensitive/admin actions. Never update or delete
 * entries from application code — this is a compliance and incident-response
 * requirement for any platform that moves money.
 */
export type AuditAction =
  | "USER_ROLE_CHANGE"
  | "USER_STATUS_CHANGE"
  | "PAYMENT_APPROVED"
  | "PAYMENT_REJECTED"
  | "ORDER_STATUS_CHANGE"
  | "ORDER_REFUNDED"
  | "SERVICE_CREATED"
  | "SERVICE_UPDATED"
  | "SERVICE_DELETED"
  | "CATEGORY_CREATED"
  | "CATEGORY_UPDATED"
  | "CATEGORY_DELETED"
  | "SERVICE_GROUP_CREATED"
  | "SERVICE_GROUP_UPDATED"
  | "SERVICE_GROUP_DELETED"
  | "PROVIDER_CREATED"
  | "PROVIDER_UPDATED"
  | "PROVIDER_DELETED"
  | "SERVICE_PROVIDER_LINK_CREATED"
  | "SERVICE_PROVIDER_LINK_UPDATED"
  | "SERVICE_PROVIDER_LINK_DELETED"
  | "SERVICE_PROVIDER_BACKFILL_RUN"
  | "API_KEY_CREATED"
  | "API_KEY_REVOKED"
  | "ORDER_REFILL_REQUESTED"
  | "ORDER_REFILL_RESOLVED"
  | "ORDER_PARTIAL_REFUND_ISSUED"
  | "SETTINGS_UPDATED"
  | "WALLET_ADJUSTMENT"
  | "LOGIN_SUCCESS"
  | "LOGIN_FAILED"
  | "PASSWORD_RESET"
  | "TELEGRAM_LINKED"
  | "TELEGRAM_UNLINKED"
  | "TELEGRAM_BOT_ORDER_PLACED"
  | "TELEGRAM_BOT_DEPOSIT_SUBMITTED"
  | "TELEGRAM_BOT_ADMIN_ACTION"
  | "ACCOUNT_UPDATED"
  | "PASSWORD_CHANGED_BY_USER"
  | "FAVORITE_SERVICE_ADDED"
  | "FAVORITE_SERVICE_REMOVED"
  | "DATA_EXPORTED"
  | "ORDER_BULK_STATUS_CHANGE";


export interface IAuditLog {
  _id: Types.ObjectId;
  actorId: Types.ObjectId | null; // null for system/automated actions
  actorEmail: string | null;
  action: AuditAction;
  targetType: string | null;
  targetId: string | null;
  metadata: unknown;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
}

const auditLogSchema = new Schema<IAuditLog>(
  {
    actorId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    actorEmail: { type: String, default: null },
    action: { type: String, required: true, index: true },
    targetType: { type: String, default: null },
    targetId: { type: String, default: null, index: true },
    metadata: { type: Schema.Types.Mixed, default: null },
    ip: { type: String, default: null },
    userAgent: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditLogSchema.index({ createdAt: -1 });

export const AuditLog: Model<IAuditLog> = models.AuditLog || model<IAuditLog>("AuditLog", auditLogSchema);
