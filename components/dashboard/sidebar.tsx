"use client";

import { usePathname } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Send } from "lucide-react";
import { useDashboardNavItems } from "./nav-items";

export function Sidebar() {
  const pathname = usePathname();
  const tNav = useTranslations("Nav");
  const menuItems = useDashboardNavItems();

  return (
    <aside className="hidden min-h-screen w-64 flex-col border-r border-slate-800 bg-slate-950 md:flex">
      <div className="flex h-16 items-center gap-3 border-b border-slate-800 px-6">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600">
          <Send className="h-5 w-5 text-white" />
        </div>
        <span className="font-bold text-white">{tNav("brand")}</span>
      </div>

      <nav className="flex-1 space-y-1 p-4">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`group relative flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium transition-colors ${
                active ? "bg-blue-600/15 text-blue-400" : "text-slate-400 hover:bg-slate-900 hover:text-white"
              }`}
            >
              {active && (
                <span className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-blue-500" />
              )}
              <Icon className={`h-5 w-5 shrink-0 ${active ? "text-blue-400" : "text-slate-500 group-hover:text-white"}`} />
              {item.title}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
