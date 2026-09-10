import { getLocale } from "next-intl/server";
import { auth } from "@/auth";
import { redirect } from "@/i18n/navigation";
import { Sidebar } from "@/components/dashboard/sidebar";
import { DashboardHeader } from "@/components/dashboard/header";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const locale = await getLocale();

  if (!session?.user?.id) {
    // Returning the call (rather than a bare statement) works around a
    // known TypeScript control-flow-analysis limitation with next-intl's
    // `redirect` (which, despite being typed to return `never`, isn't
    // narrowed correctly after a bare call) — see next-intl's navigation
    // docs, "Why does TypeScript not narrow types correctly after calling
    // redirect?".
    return redirect({ href: "/login", locale });
  }

  return (
    <div className="flex min-h-screen bg-slate-950">
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <DashboardHeader name={session.user.name} />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
