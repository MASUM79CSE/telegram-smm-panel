import Link from "next/link";
import { prisma } from "@/lib/db";
import { CategoriesManager } from "@/components/admin/categories-manager";

export default async function AdminCategoriesPage() {
  const [categories, groups] = await Promise.all([
    prisma.category.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.serviceGroup.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
  ]);

  const rows = categories.map((c) => ({
    _id: c.id,
    name: c.name,
    description: c.description,
    groupId: c.groupId ?? null,
    active: c.active,
  }));

  const groupOptions = groups.map((g) => ({
    _id: g.id,
    name: g.icon ? `${g.icon} ${g.name}` : g.name,
  }));

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Categories</h1>
        <p className="mt-1 text-slate-400">
          Organize services into categories. Optionally assign each category to a{" "}
          <Link href="/admin/service-groups" className="text-blue-400 hover:underline">
            Service Group
          </Link>{" "}
          for a two-level catalog structure.
        </p>
      </div>

      <CategoriesManager categories={rows} groups={groupOptions} />
    </div>
  );
}
