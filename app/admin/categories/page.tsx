import Link from "next/link";
import { connectDB } from "@/lib/db";
import { Category } from "@/models/Category";
import { ServiceGroup } from "@/models/ServiceGroup";
import { CategoriesManager } from "@/components/admin/categories-manager";

export default async function AdminCategoriesPage() {
  await connectDB();
  const [categories, groups] = await Promise.all([
    Category.find().sort({ sortOrder: 1, name: 1 }).lean(),
    ServiceGroup.find({ active: true }).sort({ sortOrder: 1, name: 1 }).lean(),
  ]);

  const rows = categories.map((c) => ({
    _id: c._id.toString(),
    name: c.name,
    description: c.description,
    groupId: c.groupId ? c.groupId.toString() : null,
    active: c.active,
  }));

  const groupOptions = groups.map((g) => ({
    _id: g._id.toString(),
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
