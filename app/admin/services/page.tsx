import { connectDB } from "@/lib/db";
import { Service } from "@/models/Service";
import { Category } from "@/models/Category";
import { Provider } from "@/models/Provider";
import { ServicesManager } from "@/components/admin/services-manager";

export default async function AdminServicesPage() {
  await connectDB();

  const [services, categories, providers] = await Promise.all([
    Service.find().populate("categoryId", "name").populate("providerId", "name").sort({ createdAt: -1 }).lean(),
    Category.find().sort({ name: 1 }).lean(),
    Provider.find().sort({ name: 1 }).lean(),
  ]);

  const serviceRows = services.map((s) => ({
    _id: s._id.toString(),
    name: s.name,
    rate: s.rate.toString(),
    minQuantity: s.minQuantity,
    maxQuantity: s.maxQuantity,
    active: s.active,
    refillDays: s.refillDays ?? null,
    categoryId: s.categoryId
      ? { _id: (s.categoryId as unknown as { _id: string })._id.toString(), name: (s.categoryId as unknown as { name: string }).name }
      : null,
    providerId: s.providerId
      ? { _id: (s.providerId as unknown as { _id: string })._id.toString(), name: (s.providerId as unknown as { name: string }).name }
      : null,
  }));

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Services</h1>
        <p className="mt-1 text-slate-400">Manage the service catalog and pricing.</p>
      </div>

      <ServicesManager
        services={serviceRows}
        categories={categories.map((c) => ({ _id: c._id.toString(), name: c.name }))}
        providers={providers.map((p) => ({ _id: p._id.toString(), name: p.name, type: p.type }))}
      />
    </div>
  );
}
