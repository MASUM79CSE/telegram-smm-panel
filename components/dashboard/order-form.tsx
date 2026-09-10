"use client";

import { useState, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Star } from "lucide-react";
import { formatCurrencyAmount, type DisplayCurrency } from "@/lib/currency-format";

interface ServiceOption {
  _id: string;
  name: string;
  rate: string;
  minQuantity: number;
  maxQuantity: number;
  categoryId: string;
  isFavorite?: boolean;
}

export function OrderForm({
  services,
  displayCurrency = "USD",
  displayRate = null,
}: {
  services: ServiceOption[];
  /** Locale's default local display currency (Phase 4) — "USD" means no secondary conversion is shown. */
  displayCurrency?: DisplayCurrency;
  /** 1 USD expressed in `displayCurrency`, resolved server-side once per page load; null if unavailable. */
  displayRate?: number | null;
}) {
  const router = useRouter();
  const t = useTranslations("OrderForm");
  const showsConversion = displayCurrency !== "USD" && displayRate !== null;
  // Favorites (docs/DASHBOARD_UPGRADE_PLAN.md §3.6) sort to the top of the
  // dropdown so a customer's frequently-reordered services are one click
  // away instead of buried in an alphabetical list that can run to
  // hundreds of entries on a real catalog.
  const [favorites, setFavorites] = useState<Set<string>>(
    () => new Set(services.filter((s) => s.isFavorite).map((s) => s._id))
  );
  const [favoritePending, setFavoritePending] = useState<string | null>(null);
  const sortedServices = useMemo(() => {
    return [...services].sort((a, b) => {
      const aFav = favorites.has(a._id);
      const bFav = favorites.has(b._id);
      if (aFav !== bFav) return aFav ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [services, favorites]);
  const [serviceId, setServiceId] = useState(sortedServices[0]?._id ?? "");
  const [target, setTarget] = useState("");
  const [quantity, setQuantity] = useState<number>(services.find((s) => s._id === serviceId)?.minQuantity ?? 1);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const selected = services.find((s) => s._id === serviceId);

  function toggleFavorite(id: string) {
    const isFav = favorites.has(id);
    setFavoritePending(id);
    setFavorites((prev) => {
      const next = new Set(prev);
      if (isFav) next.delete(id);
      else next.add(id);
      return next;
    });

    fetch("/api/favorites" + (isFav ? `?serviceId=${id}` : ""), {
      method: isFav ? "DELETE" : "POST",
      headers: isFav ? undefined : { "Content-Type": "application/json" },
      body: isFav ? undefined : JSON.stringify({ serviceId: id }),
    })
      .catch(() => {
        // Best-effort — revert the optimistic toggle if the request failed.
        setFavorites((prev) => {
          const next = new Set(prev);
          if (isFav) next.add(id);
          else next.delete(id);
          return next;
        });
      })
      .finally(() => setFavoritePending((current) => (current === id ? null : current)));
  }

  const charge = useMemo(() => {
    if (!selected) return 0;
    return (parseFloat(selected.rate) * quantity) / 1000;
  }, [selected, quantity]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    startTransition(async () => {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceId, target, quantity }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || t("errorFallback"));
        return;
      }

      setSuccess(t("success"));
      setTarget("");
      router.refresh();
    });
  }

  if (services.length === 0) {
    return <p className="text-slate-400">{t("noServices")}</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-xl border border-slate-800 bg-slate-950 p-6">
      <div>
        <label className="mb-2 block text-sm text-slate-300">{t("service")}</label>
        <div className="flex items-center gap-2">
          <select
            value={serviceId}
            onChange={(e) => {
              setServiceId(e.target.value);
              const s = services.find((s) => s._id === e.target.value);
              if (s) setQuantity(s.minQuantity);
            }}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-white"
          >
            {sortedServices.map((s) => (
              <option key={s._id} value={s._id}>
                {favorites.has(s._id) ? "★ " : ""}
                {s.name} — {s.rate} / 1000
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => toggleFavorite(serviceId)}
            disabled={favoritePending === serviceId}
            aria-label={favorites.has(serviceId) ? t("removeFavorite") : t("addFavorite")}
            title={favorites.has(serviceId) ? t("removeFavorite") : t("addFavorite")}
            className="shrink-0 rounded-lg border border-slate-700 bg-slate-900 p-3 text-slate-400 hover:border-amber-500 hover:text-amber-400 disabled:opacity-50"
          >
            <Star className={`h-5 w-5 ${favorites.has(serviceId) ? "fill-amber-400 text-amber-400" : ""}`} />
          </button>
        </div>
      </div>

      <div>
        <label className="mb-2 block text-sm text-slate-300">{t("target")}</label>
        <input
          required
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="https://t.me/yourchannel"
          className="w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-white outline-none focus:border-blue-500"
        />
      </div>

      <div>
        <label className="mb-2 block text-sm text-slate-300">
          {t("quantity")} {selected && t("quantityRange", { min: selected.minQuantity, max: selected.maxQuantity })}
        </label>
        <input
          type="number"
          required
          min={selected?.minQuantity}
          max={selected?.maxQuantity}
          value={quantity}
          onChange={(e) => setQuantity(parseInt(e.target.value, 10) || 0)}
          className="w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-white outline-none focus:border-blue-500"
        />
      </div>

      <div className="rounded-lg bg-slate-900 p-4">
        <p className="text-sm text-slate-400">
          {t("estimatedCharge")}{" "}
          <span className="font-semibold text-white">{formatCurrencyAmount(charge, "USD", 4)}</span>
          {showsConversion && (
            <span className="ml-1.5 text-xs text-slate-500">
              ≈ {formatCurrencyAmount(charge * displayRate!, displayCurrency)}
            </span>
          )}
        </p>
      </div>

      {error && <div className="rounded-lg bg-red-950 p-3 text-sm text-red-400">{error}</div>}
      {success && <div className="rounded-lg bg-green-950 p-3 text-sm text-green-400">{success}</div>}

      <button
        disabled={isPending}
        className="w-full rounded-lg bg-blue-600 py-3 font-medium text-white hover:bg-blue-500 disabled:opacity-50"
      >
        {isPending ? t("submitting") : t("submit")}
      </button>
    </form>
  );
}
