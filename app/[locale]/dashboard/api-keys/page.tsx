import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { connectDB } from "@/lib/db";
import { ApiKey } from "@/models/ApiKey";
import { ApiKeysPanel } from "@/components/dashboard/api-keys-panel";

export default async function ApiKeysPage() {
  const session = await auth();
  await connectDB();
  const t = await getTranslations("Dashboard.apiKeys");

  const keys = await ApiKey.find({ userId: session!.user.id })
    .select("-keyHash")
    .sort({ createdAt: -1 })
    .lean();

  const serialized = keys.map((k) => ({
    _id: k._id.toString(),
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
