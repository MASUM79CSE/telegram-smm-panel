import { prisma } from "@/lib/db";
import type { AuditAction, Prisma } from "@/lib/generated/prisma";
import { logger, requestLogger } from "@/lib/logger";

interface AuditParams {
  actorId?: string | null;
  actorEmail?: string | null;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  metadata?: unknown;
  request?: Request;
}

export async function recordAudit(params: AuditParams): Promise<void> {
  try {
    const ip = params.request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    const userAgent = params.request?.headers.get("user-agent") ?? null;

    await prisma.auditLog.create({
      data: {
        actorId: params.actorId ?? null,
        actorEmail: params.actorEmail ?? null,
        action: params.action,
        targetType: params.targetType ?? null,
        targetId: params.targetId ?? null,
        metadata: (params.metadata ?? null) as Prisma.InputJsonValue,
        ip,
        userAgent,
      },
    });
  } catch (err) {
    // Audit logging must never break the primary operation, but we must not
    // silently lose visibility either — log loudly to server logs.
    const log = params.request ? requestLogger(params.request) : logger;
    log.error({ err, action: params.action }, "[audit] Failed to record audit log entry");
  }
}
