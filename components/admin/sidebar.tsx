"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Tags,
  Package,
  ShoppingCart,
  CreditCard,
  Server,
  Headphones,
  Settings,
  Shield,
  Layers,
  ScrollText,
  BarChart3,
} from "lucide-react";

const menuItems = [
  { title: "Dashboard", href: "/admin", icon: LayoutDashboard },
  { title: "Reports", href: "/admin/reports", icon: BarChart3 },
  { title: "Users", href: "/admin/users", icon: Users },
  { title: "Service Groups", href: "/admin/service-groups", icon: Layers },
  { title: "Categories", href: "/admin/categories", icon: Tags },
  { title: "Services", href: "/admin/services", icon: Package },
  { title: "Providers", href: "/admin/providers", icon: Server },
  { title: "Orders", href: "/admin/orders", icon: ShoppingCart },
  { title: "Payments", href: "/admin/payments", icon: CreditCard },
  { title: "Support", href: "/admin/support", icon: Headphones },
  { title: "Audit Log", href: "/admin/audit-log", icon: ScrollText },
  { title: "Settings", href: "/admin/settings", icon: Settings },
];


export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden min-h-screen w-64 flex-col border-r border-slate-800 bg-slate-950 md:flex">
      <div className="flex h-16 items-center gap-3 border-b border-slate-800 px-6">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-600">
          <Shield className="h-5 w-5 text-white" />
        </div>
        <div>
          <p className="font-bold text-white">Admin Panel</p>
          <p className="text-xs text-slate-500">Management</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 p-4">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href || (item.href !== "/admin" && pathname.startsWith(item.href));

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-4 py-3 text-sm transition ${
                active ? "bg-red-600 text-white" : "text-slate-400 hover:bg-slate-900 hover:text-white"
              }`}
            >
              <Icon className="h-5 w-5" />
              {item.title}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-slate-800 p-4">
        <Link href="/dashboard" className="text-sm text-slate-400 hover:text-white">
          ← Back to Dashboard
        </Link>
      </div>
    </aside>
  );
}
