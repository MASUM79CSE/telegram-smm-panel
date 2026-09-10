import { Service } from "@/models/Service";
import { Category } from "@/models/Category";
import { ServiceGroup } from "@/models/ServiceGroup";

/**
 * Shared catalog-tree query, used by BOTH the authenticated `/api/services`
 * route and the public `/api/public/services` route (see
 * docs/IMPLEMENTATION_PLAN.md Phase 1.2) — kept in one place so the
 * customer-safe field projection only needs to be maintained once. When
 * Phase 2.2's `/api/v2` reseller endpoint ships, it should call this same
 * function rather than re-querying, per that phase's explicit instruction
 * not to duplicate this query logic in a third place.
 *
 * Returns the full 3-level tree: ServiceGroup -> Category -> Service.
 * Categories/services with no group are returned under a synthetic
 * `null`-id "ungrouped" bucket rather than dropped, since a group is
 * optional (see models/ServiceGroup.ts) and today's seed data has no
 * groups assigned at all — omitting ungrouped items would currently mean
 * omitting the entire catalog.
 *
 * Deliberately excludes provider-identifying fields
 * (`providerId`/`providerServiceId`/`providerRate`) from every `Service`
 * returned — this is customer/public-facing data. This exclusion must be
 * kept in sync with (or stricter than) the equivalent projection in
 * app/api/services/route.ts's authenticated route.
 */
export interface CatalogService {
  _id: string;
  name: string;
  description: string | null;
  rate: string;
  minQuantity: number;
  maxQuantity: number;
  categoryId: string;
  /** Median historical delivery time (docs/IMPLEMENTATION_PLAN.md Phase 3.3), null until at least one completed order exists to compute from. */
  estimatedDeliveryMinutes: number | null;
}

export interface CatalogCategory {
  _id: string;
  name: string;
  slug: string;
  description: string | null;
  groupId: string | null;
  services: CatalogService[];
}

export interface CatalogGroup {
  _id: string | null; // null = the synthetic "ungrouped" bucket
  name: string;
  icon: string | null;
  categories: CatalogCategory[];
}

export async function getPublicCatalog(): Promise<{ groups: CatalogGroup[]; totalServices: number }> {
  const [groups, categories, services] = await Promise.all([
    ServiceGroup.find({ active: true }).sort({ sortOrder: 1, name: 1 }).lean(),
    Category.find({ active: true }).sort({ sortOrder: 1, name: 1 }).lean(),
    Service.find({ active: true, hidden: false })
      .select("-providerId -providerServiceId -providerRate")
      .sort({ name: 1 })
      .lean(),
  ]);

  const servicesByCategory = new Map<string, CatalogService[]>();
  for (const s of services) {
    const key = s.categoryId.toString();
    const list = servicesByCategory.get(key) ?? [];
    list.push({
      _id: s._id.toString(),
      name: s.name,
      description: s.description,
      rate: s.rate.toString(),
      minQuantity: s.minQuantity,
      maxQuantity: s.maxQuantity,
      categoryId: key,
      estimatedDeliveryMinutes: s.estimatedDeliveryMinutes ?? null,
    });
    servicesByCategory.set(key, list);
  }

  const categoriesByGroup = new Map<string | null, CatalogCategory[]>();
  let totalServices = 0;
  for (const c of categories) {
    const catServices = servicesByCategory.get(c._id.toString()) ?? [];
    if (catServices.length === 0) continue; // hide empty categories from the public catalog
    totalServices += catServices.length;

    const groupKey = c.groupId ? c.groupId.toString() : null;
    const list = categoriesByGroup.get(groupKey) ?? [];
    list.push({
      _id: c._id.toString(),
      name: c.name,
      slug: c.slug,
      description: c.description,
      groupId: groupKey,
      services: catServices,
    });
    categoriesByGroup.set(groupKey, list);
  }

  const result: CatalogGroup[] = [];
  for (const g of groups) {
    const cats = categoriesByGroup.get(g._id.toString());
    if (!cats || cats.length === 0) continue;
    result.push({
      _id: g._id.toString(),
      name: g.name,
      icon: g.icon,
      categories: cats,
    });
  }

  const ungrouped = categoriesByGroup.get(null);
  if (ungrouped && ungrouped.length > 0) {
    result.push({ _id: null, name: "Other Services", icon: null, categories: ungrouped });
  }

  return { groups: result, totalServices };
}

/**
 * A flattened service, with its group/category names attached, used for
 * the landing page's live pricing preview (docs/IMPLEMENTATION_PLAN.md
 * Phase 1.3) — picks a handful of the cheapest services across the whole
 * catalog rather than one fixed category, so the preview stays
 * representative as the catalog grows/changes, and pulls real DB data
 * instead of hardcoded example prices.
 */
export interface CheapestServicePreview {
  _id: string;
  name: string;
  rate: string;
  groupName: string;
  categoryName: string;
}

export async function getCheapestServices(limit: number): Promise<CheapestServicePreview[]> {
  const { groups } = await getPublicCatalog();

  const flattened: CheapestServicePreview[] = [];
  for (const group of groups) {
    for (const category of group.categories) {
      for (const service of category.services) {
        flattened.push({
          _id: service._id,
          name: service.name,
          rate: service.rate,
          groupName: group.name,
          categoryName: category.name,
        });
      }
    }
  }

  return flattened.sort((a, b) => Number(a.rate) - Number(b.rate)).slice(0, limit);
}
