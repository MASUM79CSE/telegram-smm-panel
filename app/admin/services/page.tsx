import { prisma } from "@/lib/db";
import { ServicesManager } from "@/components/admin/services-manager";

export default async function AdminServicesPage() {
  const [services, categories, providers] = await Promise.all([
    prisma.service.findMany({
      include: {
        category: { select: { name: true } },
        provider: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.category.findMany({ orderBy: { name: "asc" } }),
    prisma.provider.findMany({ orderBy: { name: "asc" }, omit: { apiKeyEncrypted: true } }),
  ]);

  const serviceRows = services.map((s) => ({
    _id: s.id,
    name: s.name,
    rate: s.rate.toString(),
    minQuantity: s.minQuantity,
    maxQuantity: s.maxQuantity,
    active: s.active,
    refillDays: s.refillDays ?? null,
    categoryId: s.category ? { _id: s.categoryId, name: s.category.name } : null,
    providerId: s.provider && s.providerId ? { _id: s.providerId, name: s.provider.name } : null,
  }));

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Services</h1>
        <p className="mt-1 text-slate-400">Manage the service catalog and pricing.</p>
      </div>

      <ServicesManager
        services={serviceRows}
        categories={categories.map((c) => ({ _id: c.id, name: c.name }))}
        providers={providers.map((p) => ({ _id: p.id, name: p.name, type: p.type }))}
      />
    </div>
  );
}
