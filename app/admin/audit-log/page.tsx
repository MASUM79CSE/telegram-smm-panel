import { prisma } from "@/lib/db";
import { AuditLogViewer } from "@/components/admin/audit-log-viewer";

const LIMIT = 30;

export default async function AdminAuditLogPage() {
  const [entries, total] = await Promise.all([
    prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: LIMIT }),
    prisma.auditLog.count(),
  ]);

  const rows = entries.map((e) => ({
    _id: e.id,
    actorEmail: e.actorEmail,
    action: e.action,
    targetType: e.targetType,
    targetId: e.targetId,
    metadata: e.metadata,
    ip: e.ip,
    createdAt: e.createdAt.toISOString(),
  }));

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Audit Log</h1>
        <p className="mt-1 text-slate-400">Full history of sensitive/admin actions across the platform.</p>
      </div>

      <AuditLogViewer initialEntries={rows} initialTotal={total} limit={LIMIT} />
    </div>
  );
}
