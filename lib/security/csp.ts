/**
 * Content-Security-Policy header construction.
 *
 * Pattern: nonce + `strict-dynamic`. This is the same header shape verified
 * working in production on the reference site analyzed in
 * `docs/COMPETITIVE_ANALYSIS_AND_ROADMAP.md` §2.1, and is the current
 * best-practice CSP pattern recommended by Next.js's own docs
 * (https://nextjs.org/docs/app/guides/content-security-policy):
 *
 *  - `'nonce-<random>'` allows only script tags carrying the matching
 *    per-request nonce to execute.
 *  - `'strict-dynamic'` lets any script that IS allowed (via the nonce)
 *    dynamically load further scripts (e.g. webpack/Next.js's own runtime
 *    chunk loading) without having to nonce every single chunk URL — this
 *    is what makes nonce-based CSP practical for a framework like Next.js
 *    that injects many hashed script chunks per page.
 *  - Legacy `script-src` fallbacks (a bare `'self'`/domain list) are
 *    IGNORED by browsers that support `'strict-dynamic'`, so this policy
 *    is safe for modern browsers and simply less strict (falls back to
 *    `'self'`) on very old ones that ignore `'strict-dynamic'` entirely.
 *
 * This project has zero inline `<script>` tags or `dangerouslySetInnerHTML`
 * usage today (verified by grep across `app/` and `components/` before
 * shipping this policy) — so this CSP introduces no risk of breaking
 * existing pages. If an inline script or third-party embed is ever added,
 * it MUST carry the nonce from `getNonceFromHeaders()` (see below) or it
 * will be silently blocked by the browser, not by this server.
 */
export function buildCsp(nonce: string): string {
  const directives = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'unsafe-inline'`, // Tailwind's generated utility classes are plain CSS, not inline <script>; 'unsafe-inline' here only affects style-src, not script-src, so it doesn't weaken the script protection above
    `img-src 'self' data: https: blob:`,
    `font-src 'self' data:`,
    `connect-src 'self' https:`,
    `frame-ancestors 'none'`, // redundant with X-Frame-Options: DENY (next.config.ts) but kept for defense-in-depth and because frame-ancestors is the modern replacement CSP directive
    `base-uri 'self'`,
    `form-action 'self'`,
    `upgrade-insecure-requests`,
  ];
  return directives.join("; ");
}

/** Header name used to pass the per-request nonce from proxy.ts to Server Components via next/headers(). */
export const NONCE_HEADER = "x-nonce";

/** Generates a cryptographically random nonce, base64-encoded (Web Crypto API — available in both the Node.js and Edge runtimes). */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
