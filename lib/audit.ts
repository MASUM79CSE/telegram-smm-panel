import { AuditLog, AuditAction } from "@/models/AuditLog";
import { Types } from "mongoose";
import { logger, requestLogger } from "@/lib/logger";

interface AuditParams {
  actorId?: string | Types.ObjectId | null;
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

    await AuditLog.create({
      actorId: params.actorId ?? null,
      actorEmail: params.actorEmail ?? null,
      action: params.action,
      targetType: params.targetType ?? null,
      targetId: params.targetId ?? null,
      metadata: params.metadata ?? null,
      ip,
      userAgent,
    });
  } catch (err) {
    // Audit logging must never break the primary operation, but we must not
    // silently lose visibility either — log loudly to server logs.
    const log = params.request ? requestLogger(params.request) : logger;
    log.error({ err, action: params.action }, "[audit] Failed to record audit log entry");
  }
}
