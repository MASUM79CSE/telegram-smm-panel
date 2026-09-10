import Link from "next/link";
import { connectDB } from "@/lib/db";
import { ServiceGroup } from "@/models/ServiceGroup";
import { ServiceGroupsManager } from "@/components/admin/service-groups-manager";

export default async function AdminServiceGroupsPage() {
  await connectDB();
  const groups = await ServiceGroup.find().sort({ sortOrder: 1, name: 1 }).lean();

  const rows = groups.map((g) => ({
    _id: g._id.toString(),
    name: g.name,
    icon: g.icon,
    active: g.active,
  }));

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Service Groups</h1>
        <p className="mt-1 text-slate-400">
          Top-level groupings shown above categories (e.g. &ldquo;Telegram Boost&rdquo; containing
          per-duration categories). Assign categories to a group from the{" "}
          <Link href="/admin/categories" className="text-blue-400 hover:underline">
            Categories
          </Link>{" "}
          page.
        </p>
      </div>

      <ServiceGroupsManager groups={rows} />
    </div>
  );
}
