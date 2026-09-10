import { getTranslations } from "next-intl/server";
import { NewTicketForm } from "@/components/support/new-ticket-form";

export default async function NewTicketPage() {
  const t = await getTranslations("Dashboard.supportNew");

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">{t("title")}</h1>
        <p className="mt-1 text-slate-400">{t("subtitle")}</p>
      </div>

      <NewTicketForm />
    </div>
  );
}
