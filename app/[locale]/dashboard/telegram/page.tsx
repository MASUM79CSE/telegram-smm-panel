import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { TelegramLinkPanel } from "@/components/dashboard/telegram-link-panel";
import { env } from "@/lib/env";

export default async function TelegramPage() {
  const session = await auth();
  const t = await getTranslations("Dashboard.telegram");

  const user = await prisma.user.findUnique({ where: { id: session!.user.id } });
  const botUsername = env.TELEGRAM_BOT_USERNAME ?? null;

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">{t("title")}</h1>
        <p className="mt-1 text-slate-400">{t("subtitle")}</p>
      </div>

      <TelegramLinkPanel
        linked={Boolean(user?.telegramId)}
        telegramUsername={user?.telegramUsername ?? null}
        botUsername={botUsername}
      />
    </div>
  );
}
