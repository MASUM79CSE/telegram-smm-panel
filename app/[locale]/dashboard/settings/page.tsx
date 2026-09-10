import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { connectDB } from "@/lib/db";
import { User } from "@/models/User";
import { AccountSettingsPanel } from "@/components/dashboard/account-settings-panel";

export default async function SettingsPage() {
  const session = await auth();
  await connectDB();
  const t = await getTranslations("Dashboard.settings");

  const user = await User.findById(session!.user.id).lean();

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">{t("title")}</h1>
        <p className="mt-1 text-slate-400">{t("subtitle")}</p>
      </div>

      <AccountSettingsPanel
        name={user?.name ?? ""}
        email={user?.email ?? ""}
        lastLoginAt={user?.lastLoginAt ? user.lastLoginAt.toISOString() : null}
        lastLoginIp={user?.lastLoginIp ?? null}
        telegramLinked={Boolean(user?.telegramId)}
      />
    </div>
  );
}
