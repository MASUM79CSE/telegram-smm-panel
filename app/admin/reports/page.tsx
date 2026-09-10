import { connectDB } from "@/lib/db";
import { getFinancialReportRows } from "@/lib/services/analytics";
import { ReportsPanel } from "@/components/admin/reports-panel";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await connectDB();

  const resolved = await searchParams;
  const to = resolved.to && !Number.isNaN(new Date(resolved.to).getTime()) ? new Date(resolved.to) : new Date();
  const from =
    resolved.from && !Number.isNaN(new Date(resolved.from).getTime())
      ? new Date(resolved.from)
      : new Date(to.getTime() - 29 * 24 * 60 * 60 * 1000);

  const summary = await getFinancialReportRows(from, to);

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Financial Reports</h1>
        <p className="mt-1 text-slate-400">
          Revenue, deposit, and refund summary for a chosen date range, with CSV export.
        </p>
      </div>

      <ReportsPanel summary={summary} from={isoDate(from)} to={isoDate(to)} />
    </div>
  );
}
