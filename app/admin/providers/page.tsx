import { connectDB } from "@/lib/db";
import { Provider } from "@/models/Provider";
import { ProvidersManager } from "@/components/admin/providers-manager";
import { ProviderHealthPanel } from "@/components/admin/provider-health-panel";
import { getProviderHealthSummary } from "@/lib/services/analytics";

export default async function AdminProvidersPage() {
  await connectDB();
  const [providers, health] = await Promise.all([
    Provider.find().sort({ createdAt: -1 }).lean(),
    getProviderHealthSummary(),
  ]);

  const rows = providers.map((p) => ({
    _id: p._id.toString(),
    name: p.name,
    type: p.type,
    status: p.status,
    apiUrl: p.apiUrl,
  }));

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Providers</h1>
        <p className="mt-1 text-slate-400">
          Configure fulfillment providers — manual, upstream API, or internal automation.
        </p>
      </div>

      <div className="mb-8">
        <ProviderHealthPanel health={health} />
      </div>

      <ProvidersManager providers={rows} />
    </div>
  );
}
