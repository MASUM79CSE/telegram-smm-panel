import { NextFetchEvent, NextRequest, NextResponse } from "next/server";
import NextAuth, { type NextAuthRequest } from "next-auth";
import createIntlMiddleware from "next-intl/middleware";
import { authConfig } from "@/auth.config";
import { checkOrigin } from "@/lib/security/origin";
import { buildCsp, generateNonce, NONCE_HEADER } from "@/lib/security/csp";
import { REQUEST_ID_HEADER, generateRequestId } from "@/lib/security/request-id";
import { isLocaleRoutedPath } from "@/lib/security/locale-routing";
import { routing } from "@/i18n/routing";

/**
 * Route protection for /dashboard/* and /admin/*, cross-origin request
 * enforcement for /api/** (lib/security/origin.ts), a per-request
 * Content-Security-Policy nonce (lib/security/csp.ts), a per-request
 * correlation id for structured logging (lib/security/request-id.ts, see
 * docs/PRODUCTION_READINESS.md §3), PLUS (as of
 * docs/IMPLEMENTATION_PLAN.md Phase 4.1) next-intl's locale-routing
 * middleware for the customer-facing `/[locale]/**` surface.
 *
 * Named `proxy` per Next.js 16 convention (renamed from `middleware`).
 * Runs on the Node.js runtime by default in Next 16, so this file stays
 * Edge-safe anyway (no bcrypt/mongoose imports) to keep it portable.
 *
 * Must be a genuine named function export called `proxy` (not just a
 * destructured value assigned to that name) or Next 16's build-time check
 * fails with "must export a function" — see
 * https://nextjs.org/docs/messages/middleware-to-proxy
 *
 * IMPORTANT: NextAuth's `auth()` only auto-enforces the `authorized()`
 * callback in `auth.config.ts` when it is used bare (`export { auth as
 * proxy }`, no wrapper function). The moment a custom middleware function is
 * passed to `auth(...)` — which we must do here to also run the origin
 * check below — NextAuth stops applying that callback's boolean result for
 * us; it only still honors it if `authorized()` itself returns a `Response`.
 * So we call `authConfig.callbacks.authorized` ourselves and turn a `false`
 * result into the same signIn-page redirect NextAuth would have produced,
 * to avoid silently disabling route protection while adding origin checks.
 *
 * Composition with next-intl (see docs/I18N_PLAN.md §2 for the design
 * rationale): `/admin/**` and `/api/**` are excluded from locale routing
 * entirely — `/admin` is deliberately English-only back-office tooling, and
 * `/api` is machine-to-machine and was never locale-prefixed.
 *
 * CSP-nonce forwarding technique: next-intl's own middleware internally
 * forwards `new Headers(request.headers)` (plus its own locale header) when
 * it produces a `NextResponse.next()`/`NextResponse.rewrite()` — see
 * `next-intl/middleware`'s source. So the nonce is set on the INCOMING
 * request's headers before next-intl ever runs, which means next-intl
 * automatically carries it through to whatever response (pass-through or
 * internal rewrite to add the `[locale]` segment) it produces, with zero
 * risk of clobbering next-intl's own rewrite target — this is simpler and
 * more robust than trying to reconstruct next-intl's response after the
 * fact.
 */
const { auth } = NextAuth(authConfig);


const handleI18nRouting = createIntlMiddleware(routing);

/** Splits a pathname into its locale prefix (e.g. `/bn`, or `""` if none) and the remainder (always starting with `/`). */
function splitLocalePrefix(pathname: string): { prefix: string; rest: string } {
  for (const locale of routing.locales) {
    if (pathname === `/${locale}`) return { prefix: `/${locale}`, rest: "/" };
    if (pathname.startsWith(`/${locale}/`)) return { prefix: `/${locale}`, rest: pathname.slice(locale.length + 1) };
  }
  return { prefix: "", rest: pathname };
}

/** Clones a request with extra headers set, for forwarding to downstream middleware/next-intl. */
function withHeaders(request: NextRequest, extra: Record<string, string>): NextRequest {
  const headers = new Headers(request.headers);
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  return new NextRequest(request, { headers });
}

const authMiddleware = auth((request: NextAuthRequest, event: NextFetchEvent) => {
  void event;
  const nonce = generateNonce();
  const csp = buildCsp(nonce);
  // Generated once per request here (the earliest point every request
  // passes through) and forwarded both to route handlers (as a request
  // header, so `lib/logger.ts#requestLogger()` can read it back off
  // `request.headers`) and to the client (as a response header), so a
  // support/on-call engineer can correlate a user-reported error against
  // server-side log lines — see docs/PRODUCTION_READINESS.md §3.
  const requestId = generateRequestId();

  const applyCsp = (response: NextResponse) => {
    response.headers.set("Content-Security-Policy", csp);
    response.headers.set(REQUEST_ID_HEADER, requestId);
    return response;
  };

  const requestWithId = withHeaders(request, { [REQUEST_ID_HEADER]: requestId });

  const originRejection = checkOrigin(requestWithId);
  if (originRejection) return applyCsp(originRejection);

  const { pathname } = request.nextUrl;

  // `/admin/**`, `/api/**`, and `/monitoring` never go through next-intl —
  // see `isLocaleRoutedPath`'s doc comment above for why.
  // `authConfig.callbacks.authorized` matches on plain `/dashboard`/`/admin`
  // prefixes; strip any locale prefix first so e.g. `/bn/dashboard` is
  // still correctly recognized as protected.
  const isLocaleRouted = isLocaleRoutedPath(pathname);
  const { prefix: localePrefix, rest: unprefixedPathname } = isLocaleRouted
    ? splitLocalePrefix(pathname)
    : { prefix: "", rest: pathname };

  const authorized = authConfig.callbacks.authorized({
    auth: request.auth,
    request: { ...request, nextUrl: { ...request.nextUrl, pathname: unprefixedPathname } } as typeof request,
  });

  if (!authorized) {
    // Preserve a non-default locale prefix on the sign-in redirect (e.g.
    // `/bn/dashboard` -> `/bn/login`, not `/login`) — otherwise an
    // unauthenticated Bengali-locale user hitting a protected route would
    // silently get bounced to the English sign-in page.
    const signInUrl = request.nextUrl.clone();
    signInUrl.pathname = `${localePrefix}${authConfig.pages!.signIn!}`;
    signInUrl.searchParams.set("callbackUrl", request.nextUrl.href);
    return applyCsp(NextResponse.redirect(signInUrl));
  }

  // Built from `requestWithId` (not the original `request`) — constructing
  // a `NextRequest`/`Request` from another one consumes its body stream, so
  // building a second wrapper directly off the original `request` here
  // (which was already consumed above to produce `requestWithId`) throws
  // "Cannot construct a Request with a Request object that has already
  // been used." Chaining off `requestWithId` avoids re-reading the
  // already-consumed original and still carries both headers through.
  const requestWithNonce = withHeaders(requestWithId, { [NONCE_HEADER]: nonce });

  if (!isLocaleRouted) {
    return applyCsp(NextResponse.next({ request: { headers: requestWithNonce.headers } }));
  }

  // A genuine 3xx redirect from next-intl (e.g. a locale-cookie-driven
  // `/` -> `/bn`) is returned as-is, still carrying the CSP header — the
  // browser is about to navigate elsewhere, there's no page to apply a
  // nonce to.
  return applyCsp(handleI18nRouting(requestWithNonce));
});

export function proxy(request: NextRequest, event: NextFetchEvent) {
  return authMiddleware(request, event);
}

export const config = {
  matcher: [
    /*
     * Match all paths except static assets, images, and public files.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
