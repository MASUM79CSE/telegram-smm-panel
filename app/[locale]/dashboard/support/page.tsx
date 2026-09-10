import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { connectDB } from "@/lib/db";
import { SupportTicket } from "@/models/SupportTicket";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Link } from "@/i18n/navigation";
import { Plus } from "lucide-react";

export default async function SupportPage() {
  const session = await auth();
  await connectDB();
  const t = await getTranslations("Dashboard.support");
  const tStatus = await getTranslations("StatusBadge");

  const tickets = await SupportTicket.find({ userId: session!.user.id })
    .select("-messages")
    .sort({ updatedAt: -1 })
    .lean();

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">{t("title")}</h1>
          <p className="mt-1 text-slate-400">{t("subtitle")}</p>
        </div>

        <Link
          href="/dashboard/support/new"
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
        >
          <Plus className="h-4 w-4" />
          {t("newTicket")}
        </Link>
      </div>

      {tickets.length === 0 ? (
        <p className="text-slate-400">{t("empty")}</p>
      ) : (
        <div className="space-y-3">
          {tickets.map((ticket) => (
            <Link
              key={ticket._id.toString()}
              href={`/dashboard/support/${ticket._id}`}
              className="block rounded-xl border border-slate-800 bg-slate-950 p-5 hover:border-slate-700"
            >
              <div className="flex items-center justify-between">
                <p className="font-medium text-white">{ticket.subject}</p>
                <StatusBadge status={ticket.status} label={tStatus(ticket.status)} />
              </div>
              <p className="mt-2 text-xs text-slate-500">
                {t("updated", { date: new Date(ticket.updatedAt).toLocaleString() })}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
