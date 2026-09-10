import type { AuditAction } from "@/models/AuditLog";

/**
 * Human-readable label + category for each `AuditAction`, shared by the
 * admin overview's "Recent Activity" feed and the full `/admin/audit-log`
 * viewer (docs/DASHBOARD_UPGRADE_PLAN.md §2.1/§2.2) so the two surfaces
 * never present the same action differently.
 */
export type AuditCategory = "security" | "financial" | "content" | "telegram" | "support";

export const AUDIT_CATEGORY_COLORS: Record<AuditCategory, string> = {
  security: "bg-red-950 text-red-300",
  financial: "bg-green-950 text-green-300",
  content: "bg-blue-950 text-blue-300",
  telegram: "bg-sky-950 text-sky-300",
  support: "bg-amber-950 text-amber-300",
};

interface AuditActionMeta {
  label: string;
  category: AuditCategory;
}

export const AUDIT_ACTION_META: Record<AuditAction, AuditActionMeta> = {
  USER_ROLE_CHANGE: { label: "Changed user role", category: "security" },
  USER_STATUS_CHANGE: { label: "Changed user status", category: "security" },
  PAYMENT_APPROVED: { label: "Approved deposit", category: "financial" },
  PAYMENT_REJECTED: { label: "Rejected deposit", category: "financial" },
  ORDER_STATUS_CHANGE: { label: "Changed order status", category: "content" },
  ORDER_BULK_STATUS_CHANGE: { label: "Bulk-changed order status", category: "content" },
  ORDER_REFUNDED: { label: "Refunded order", category: "financial" },
  SERVICE_CREATED: { label: "Created service", category: "content" },
  SERVICE_UPDATED: { label: "Updated service", category: "content" },
  SERVICE_DELETED: { label: "Deleted service", category: "content" },
  CATEGORY_CREATED: { label: "Created category", category: "content" },
  CATEGORY_UPDATED: { label: "Updated category", category: "content" },
  CATEGORY_DELETED: { label: "Deleted category", category: "content" },
  SERVICE_GROUP_CREATED: { label: "Created service group", category: "content" },
  SERVICE_GROUP_UPDATED: { label: "Updated service group", category: "content" },
  SERVICE_GROUP_DELETED: { label: "Deleted service group", category: "content" },
  PROVIDER_CREATED: { label: "Created provider", category: "content" },
  PROVIDER_UPDATED: { label: "Updated provider", category: "content" },
  PROVIDER_DELETED: { label: "Deleted provider", category: "content" },
  SERVICE_PROVIDER_LINK_CREATED: { label: "Linked provider to service", category: "content" },
  SERVICE_PROVIDER_LINK_UPDATED: { label: "Updated service-provider link", category: "content" },
  SERVICE_PROVIDER_LINK_DELETED: { label: "Removed service-provider link", category: "content" },
  SERVICE_PROVIDER_BACKFILL_RUN: { label: "Ran service-provider backfill", category: "content" },
  API_KEY_CREATED: { label: "Created API key", category: "security" },
  API_KEY_REVOKED: { label: "Revoked API key", category: "security" },
  ORDER_REFILL_REQUESTED: { label: "Requested order refill", category: "content" },
  ORDER_REFILL_RESOLVED: { label: "Resolved order refill", category: "content" },
  ORDER_PARTIAL_REFUND_ISSUED: { label: "Issued partial refund", category: "financial" },
  SETTINGS_UPDATED: { label: "Updated platform settings", category: "security" },
  WALLET_ADJUSTMENT: { label: "Adjusted wallet balance", category: "financial" },
  LOGIN_SUCCESS: { label: "Logged in", category: "security" },
  LOGIN_FAILED: { label: "Failed login attempt", category: "security" },
  PASSWORD_RESET: { label: "Reset password", category: "security" },
  TELEGRAM_LINKED: { label: "Linked Telegram account", category: "telegram" },
  TELEGRAM_UNLINKED: { label: "Unlinked Telegram account", category: "telegram" },
  TELEGRAM_BOT_ORDER_PLACED: { label: "Placed order via Telegram bot", category: "telegram" },
  TELEGRAM_BOT_DEPOSIT_SUBMITTED: { label: "Submitted deposit via Telegram bot", category: "telegram" },
  TELEGRAM_BOT_ADMIN_ACTION: { label: "Admin action via Telegram bot", category: "telegram" },
  ACCOUNT_UPDATED: { label: "Updated account details", category: "security" },
  PASSWORD_CHANGED_BY_USER: { label: "Changed own password", category: "security" },
  FAVORITE_SERVICE_ADDED: { label: "Added favorite service", category: "content" },
  FAVORITE_SERVICE_REMOVED: { label: "Removed favorite service", category: "content" },
  DATA_EXPORTED: { label: "Exported data (CSV)", category: "financial" },
};

export function getAuditActionMeta(action: string): AuditActionMeta {
  return (
    AUDIT_ACTION_META[action as AuditAction] ?? {
      label: action.replace(/_/g, " ").toLowerCase(),
      category: "content",
    }
  );
}
