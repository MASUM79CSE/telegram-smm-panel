import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { ApiKeysPanel } from "@/components/dashboard/api-keys-panel";

export default async function ApiKeysPage() {
  const session = await auth();
  const t = await getTranslations("Dashboard.apiKeys");

  const keys = await prisma.apiKey.findMany({
    where: { userId: session!.user.id },
    omit: { keyHash: true },
    orderBy: { createdAt: "desc" },
  });

  const serialized = keys.map((k) => ({
    _id: k.id,
    label: k.label,
    keyPrefix: k.keyPrefix,
    lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
    active: k.active,
    createdAt: k.createdAt.toISOString(),
  }));

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">{t("title")}</h1>
        <p className="mt-1 text-slate-400">
          {t.rich("subtitle", {
            endpoint: () => <code className="rounded bg-slate-900 px-1.5 py-0.5">POST /api/v2</code>,
            doc: () => <code className="rounded bg-slate-900 px-1.5 py-0.5">docs/API.md</code>,
          })}
        </p>
      </div>

      <ApiKeysPanel initialKeys={serialized} />
    </div>
  );
}
