import { prisma } from "@/lib/db";
import type { NotificationType } from "@/lib/generated/prisma";
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
    await prisma.notification.create({
      data: {
        userId: params.userId,
        type: params.type,
        title: params.title,
        body: params.body,
        href: params.href ?? null,
      },
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
    const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } });
    await prisma.notification.createMany({
      data: admins.map((a) => ({
        userId: a.id,
        type: params.type,
        title: params.title,
        body: params.body,
        href: params.href ?? null,
      })),
    });
  } catch (err) {
    logger.error({ err, type: params.type }, "[notifications] Failed to fan out admin notification");
  }
}

export async function getUnreadCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, read: false } });
}

export async function getRecentNotifications(userId: string, limit = 10) {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function markAsRead(id: string, userId: string): Promise<boolean> {
  const result = await prisma.notification.updateMany({
    where: { id, userId },
    data: { read: true, readAt: new Date() },
  });
  return result.count === 1;
}

export async function markAllAsRead(userId: string): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: { userId, read: false },
    data: { read: true, readAt: new Date() },
  });
  return result.count;
}
