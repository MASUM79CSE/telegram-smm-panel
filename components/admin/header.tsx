"use client";

import { signOut } from "next-auth/react";
import { LogOut, Search } from "lucide-react";
import { NotificationBell } from "@/components/shared/notification-bell";

export function AdminHeader({ name }: { name?: string | null }) {
  return (
    <header className="flex h-16 items-center justify-between border-b border-slate-800 bg-slate-950 px-6">
      <div>
        <h2 className="font-semibold text-white">Administration</h2>
      </div>

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("admin-command-palette:open"))}
          className="flex items-center gap-2 rounded-lg border border-slate-800 px-3 py-1.5 text-sm text-slate-400 hover:border-slate-700 hover:text-slate-200"
        >
          <Search className="h-4 w-4" />
          <span className="hidden sm:inline">Quick search</span>
          <kbd className="hidden rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-500 sm:inline">
            Ctrl K
          </kbd>
        </button>

        <NotificationBell />

        <div className="text-right">
          <p className="text-sm font-medium text-white">{name || "Administrator"}</p>
          <p className="text-xs text-red-400">ADMIN</p>
        </div>

        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="rounded-lg p-2 text-slate-400 hover:bg-red-950 hover:text-red-400"
          aria-label="Sign out"
        >
          <LogOut className="h-5 w-5" />
        </button>
      </div>
    </header>
  );
}
