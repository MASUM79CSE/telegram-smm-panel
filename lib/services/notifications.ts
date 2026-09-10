import { Notification, type NotificationType } from "@/models/Notification";
import { User } from "@/models/User";
import { logger } from "@/lib/logger";

/**
 * In-app notification service (docs/DASHBOARD_UPGRADE_PLAN.md §1.3).
 * Mirrors `lib/audit.ts#recordAudit`'s established convention: notification
 * writes are best-effort side effects and MUST NEVER throw or break the
 * primary operation (order placement, payment approval, etc.) — every
 * function here catches and logs internally rather than propagating.
 */
export async function createNotification(params: {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  href?: string | null;
}): Promise<void> {
  try {
    await Notification.create({
      userId: params.userId,
      type: params.type,
      title: params.title,
      body: params.body,
      href: params.href ?? null,
    });
  } catch (err) {
    logger.error({ err, userId: params.userId, type: params.type }, "[notifications] Failed to create notification");
  }
}

/** Fan-out helper for admin-facing notification types (NEW_ORDER/NEW_DEPOSIT/NEW_TICKET) — notifies every ADMIN user. */
export async function notifyAllAdmins(params: {
  type: NotificationType;
  title: string;
  body: string;
  href?: string | null;
}): Promise<void> {
  try {
    const admins = await User.find({ role: "ADMIN" }).select("_id").lean();
    await Notification.insertMany(
      admins.map((a) => ({
        userId: a._id,
        type: params.type,
        title: params.title,
        body: params.body,
        href: params.href ?? null,
      }))
    );
  } catch (err) {
    logger.error({ err, type: params.type }, "[notifications] Failed to fan out admin notification");
  }
}

export async function getUnreadCount(userId: string): Promise<number> {
  return Notification.countDocuments({ userId, read: false });
}

export async function getRecentNotifications(userId: string, limit = 10) {
  return Notification.find({ userId }).sort({ createdAt: -1 }).limit(limit).lean();
}

export async function markAsRead(id: string, userId: string): Promise<boolean> {
  const result = await Notification.updateOne(
    { _id: id, userId },
    { $set: { read: true, readAt: new Date() } }
  );
  return result.modifiedCount === 1;
}

export async function markAllAsRead(userId: string): Promise<number> {
  const result = await Notification.updateMany(
    { userId, read: false },
    { $set: { read: true, readAt: new Date() } }
  );
  return result.modifiedCount;
}
