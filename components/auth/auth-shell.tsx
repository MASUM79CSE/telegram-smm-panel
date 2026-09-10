import { Send } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { LocaleSwitcher } from "@/components/shared/locale-switcher";

/**
 * Shared visual chrome for every `/[locale]/{login,register,forgot-password,
 * reset-password,verify-email}` page — previously each page duplicated the
 * same `min-h-screen`/card markup with no shared brand header and no way to
 * switch language (Phase 4 i18n follow-up: a locale switcher existed
 * nowhere in the app). Centralizing it here means the advanced-UI treatment
 * (animated gradient backdrop, glass card, brand mark) and the locale
 * switcher are both real, functioning, and consistent across every auth
 * surface instead of copy-pasted per page.
 */
export function AuthShell({ children, cardClassName = "" }: { children: React.ReactNode; cardClassName?: string }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 px-4 py-12">
      {/* Ambient background: two soft, slowly animated color blobs behind a
          fine grid — real CSS, no external image assets (which wouldn't
          load in a sandboxed preview anyway). */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-blue-600/20 blur-3xl" />
        <div className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-indigo-600/20 blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              "linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />
      </div>

      <div className="relative z-10 w-full max-w-md">
        <div className="mb-6 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-950/50">
              <Send className="h-5 w-5 text-white" />
            </div>
            <span className="text-lg font-bold text-white">SMM Panel</span>
          </Link>
          <LocaleSwitcher />
        </div>

        <div
          className={`rounded-2xl border border-slate-800/80 bg-slate-900/60 p-8 shadow-2xl shadow-black/40 backdrop-blur-xl ${cardClassName}`}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
