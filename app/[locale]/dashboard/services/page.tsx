import { getLocale, getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { connectDB } from "@/lib/db";
import { Service } from "@/models/Service";
import { Category } from "@/models/Category";
import { User } from "@/models/User";
import { OrderForm } from "@/components/dashboard/order-form";
import { defaultDisplayCurrencyForLocale } from "@/lib/currency-format";
import { convertFromUsd } from "@/lib/currency";

export default async function ServicesPage() {
  const session = await auth();
  await connectDB();
  const locale = await getLocale();
  const t = await getTranslations("Dashboard.services");

  const [services, categories, user] = await Promise.all([
    Service.find({ active: true, hidden: false }).sort({ name: 1 }).lean(),
    Category.find({ active: true }).sort({ sortOrder: 1 }).lean(),
    User.findById(session!.user.id).select("favoriteServiceIds").lean(),
  ]);

  const favoriteIds = new Set((user?.favoriteServiceIds ?? []).map((id) => id.toString()));

  const serviceOptions = services.map((s) => ({
    _id: s._id.toString(),
    name: s.name,
    rate: s.rate.toString(),
    minQuantity: s.minQuantity,
    maxQuantity: s.maxQuantity,
    categoryId: s.categoryId.toString(),
    isFavorite: favoriteIds.has(s._id.toString()),
  }));

  // Phase 4 currency-display: resolve one live USD->local rate server-side
  // (same pattern as the public catalog) so the client-side `OrderForm`'s
  // interactive estimated-charge calculation can show a real converted
  // secondary amount as the user changes quantity, without any client-side
  // DB/network access.
  const displayCurrency = defaultDisplayCurrencyForLocale(locale);
  const displayRate = displayCurrency === "USD" ? null : await convertFromUsd(1, displayCurrency);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">{t("title")}</h1>
        <p className="mt-1 text-slate-400">
          {t("subtitle", { categoryCount: categories.length, serviceCount: services.length })}
        </p>
      </div>

      <OrderForm services={serviceOptions} displayCurrency={displayCurrency} displayRate={displayRate} />
    </div>
  );
}

