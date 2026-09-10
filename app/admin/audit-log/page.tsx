import { connectDB } from "@/lib/db";
import { AuditLog } from "@/models/AuditLog";
import { AuditLogViewer } from "@/components/admin/audit-log-viewer";

const LIMIT = 30;

export default async function AdminAuditLogPage() {
  await connectDB();

  const [entries, total] = await Promise.all([
    AuditLog.find().sort({ createdAt: -1 }).limit(LIMIT).lean(),
    AuditLog.countDocuments(),
  ]);

  const rows = entries.map((e) => ({
    _id: e._id.toString(),
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
