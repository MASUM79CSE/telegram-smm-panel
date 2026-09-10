import { useTranslations } from "next-intl";
import { LayoutDashboard, Package, ShoppingCart, Wallet, Headphones, Send, KeyRound, Settings, type LucideIcon } from "lucide-react";

export interface DashboardNavItem {
  title: string;
  href: string;
  icon: LucideIcon;
}

/**
 * Single source of truth for the dashboard's nav items — shared by the
 * desktop `Sidebar` and the mobile drawer (`MobileNav`) so the two never
 * drift out of sync (a real risk once there were two nav surfaces instead
 * of one).
 */
export function useDashboardNavItems(): DashboardNavItem[] {
  const t = useTranslations("Dashboard.nav");

  return [
    { title: t("dashboard"), href: "/dashboard", icon: LayoutDashboard },
    { title: t("services"), href: "/dashboard/services", icon: Package },
    { title: t("orders"), href: "/dashboard/orders", icon: ShoppingCart },
    { title: t("wallet"), href: "/dashboard/wallet", icon: Wallet },
    { title: t("support"), href: "/dashboard/support", icon: Headphones },
    { title: t("telegram"), href: "/dashboard/telegram", icon: Send },
    { title: t("apiKeys"), href: "/dashboard/api-keys", icon: KeyRound },
    { title: t("settings"), href: "/dashboard/settings", icon: Settings },
  ];
}
