# Implementation Plan: Executing the Competitive Roadmap

This document turns `docs/COMPETITIVE_ANALYSIS_AND_ROADMAP.md` into an execution-ready engineering plan: concrete tasks, exact files touched, schema diffs, migration steps, and acceptance criteria per phase. Read the roadmap doc first for the *why*; this document is the *how* and *in what order*.

> **Migration history note:** every phase below was implemented and verified against this project's **original MongoDB Atlas/Mongoose backend** — file paths like `models/Transaction.ts`, patterns like `mongoose.startSession().withTransaction()`, and "verified live against real MongoDB Atlas data" acceptance criteria reflect that, and are left as an accurate historical record rather than rewritten to describe the current Postgres/Prisma system (which didn't exist yet at the time these phases shipped). The project has since been fully migrated to PostgreSQL/Prisma (Supabase) — see [`DATABASE.md`](DATABASE.md) for the current schema/mechanics, and [`ARCHITECTURE.md`](ARCHITECTURE.md)/[`PRODUCTION_READINESS.md`](PRODUCTION_READINESS.md) for how the equivalent patterns (transactions, optimistic concurrency, connection pooling) now work under Prisma. Every behavioral property this plan verified — atomicity, optimistic-concurrency wallet safety, idempotency — was carried over 1:1 across that later migration; only the storage engine and ORM-specific mechanics changed.

**Ground rules carried over from the rest of this project's docs (do not relax these while implementing):**
- Every money-moving change reuses the existing atomic-transaction + `Wallet.version` optimistic-concurrency pattern (`lib/services/admin-payments.ts`'s `approveDeposit` is the reference implementation) — no new parallel money-movement code path.
- Every new schema field is additive/nullable where it touches existing collections, so no destructive migration is ever required (matches the pattern already used for `AUTH_TRUST_HOST`, `Category.groupId`, etc.).
- Every new mutating route gets a Zod schema in `lib/validation.ts`, an `auth()`/role check, and a `lib/rate-limit.ts` config entry — no exceptions.
- After each phase: `npm run typecheck && npm run lint && npm run build`, plus a real end-to-end manual verification pass (not just "it compiles"), then update `docs/PRODUCTION_READINESS.md` / `docs/COMPETITIVE_ANALYSIS_AND_ROADMAP.md` to reflect what's now actually done vs. still planned — keep these living documents, not one-time reports.

---

## Phase 0 — Ship immediately (no scope decision needed)

**Status: ✅ all of Phase 0 implemented and verified — see the "what was actually shipped" note at the end of each subsection below.**

### 0.1 Nonce-based Content-Security-Policy

**Files touched:** `proxy.ts` (extend, don't replace — it already runs on every matched request), `app/layout.tsx`, new `lib/security/csp.ts`.

**Tasks:**
1. `lib/security/csp.ts`: export `buildCsp(nonce: string): string` returning the header value string (`default-src 'self'; script-src 'self' 'nonce-${nonce}' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; font-src 'self' data:; connect-src 'self' https:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; upgrade-insecure-requests`). Model directly on the reference site's proven header (verified working in production there).
2. In `proxy.ts`'s `auth((request) => {...})` callback: generate a per-request nonce (`crypto.randomUUID()` or `crypto.randomBytes(16).toString("base64")`), set it on a request header (e.g. `x-nonce`) via `NextResponse.next({ request: { headers } })`, and set the `Content-Security-Policy` response header on the same response.
3. `app/layout.tsx`: read the nonce from `headers()` (Next.js `next/headers`) and pass it to any `<Script>` tag if/when one is added later. **Today this project has zero inline `<script>` tags in its own pages** (confirmed: grep found none), so this step is precautionary/future-proofing, not fixing an active violation — verify this remains true before shipping (re-grep for inline `<script>`/`onClick=` string handlers, which the App Router doesn't produce for React event handlers but a future `dangerouslySetInnerHTML` could).
4. Verify: `curl -I` any page in production mode shows the CSP header with a fresh nonce on each request; verify the dashboard/admin UI still functions fully in a real browser (no console CSP violations) — do this manually in the live preview, not just via curl.

**Acceptance criteria:** CSP header present on every response with a unique nonce per request; zero CSP violations in browser console across login, dashboard, admin, and order-placement flows; `npm run build` clean.

**Risk:** low. **Est. effort:** 2–4 hours including manual verification across all pages.

**✅ Shipped:** `lib/security/csp.ts` (nonce generation + header builder), `proxy.ts` (generates a per-request nonce, forwards it via the `x-nonce` request header, sets `Content-Security-Policy` on every response path — origin-rejection, sign-in redirect, and pass-through alike), `app/layout.tsx` (reads the nonce via `next/headers()`, currently only stored on a `data-csp-nonce` attribute for future use since no inline script exists yet). Verified via a real production build + live curl/browser check that the header is present with a fresh nonce per request and that all existing pages (login, register, dashboard, admin) still render/function with no CSP console violations.

### 0.2 `robots.ts` + `sitemap.ts`

**Files touched:** new `app/robots.ts`, new `app/sitemap.ts`.

**Tasks:**
1. `app/robots.ts` (Next.js App Router native `MetadataRoute.Robots`): allow `/` and (once it exists, see Phase 1) `/services`; disallow `/api/`, `/dashboard`, `/admin`. Mirror the reference site's crawler-specific block list for AI-training bots only if the project owner wants that policy — otherwise a simple `Allow: /` / `Disallow` list for admin/dashboard/api is sufficient and is the part that actually matters (keeping private routes out of search results).
2. `app/sitemap.ts` (Next.js native `MetadataRoute.Sitemap`): list `/`, and once Phase 1 ships, `/services` and any public category pages — dynamically generated from the `Category`/`ServiceGroup` collections, not hardcoded, so it stays correct as the catalog grows.
3. Verify: `GET /robots.txt` and `GET /sitemap.xml` render correctly in production mode.

**Acceptance criteria:** both endpoints return valid, correctly-formatted output; `/dashboard`, `/admin`, `/api` are disallowed.

**Risk:** trivial. **Est. effort:** 1 hour.

**✅ Shipped:** `app/robots.ts` and `app/sitemap.ts` (Next.js native `MetadataRoute.Robots`/`MetadataRoute.Sitemap`), both driven by `NEXT_PUBLIC_APP_URL` rather than a hardcoded domain. `app/sitemap.ts` is deliberately left static/synchronous for now with a code comment explaining it should become DB-driven once Phase 1.2's public catalog page ships. Verified via a real production build that both `/robots.txt` and `/sitemap.xml` render correctly.

### 0.3 Carry-over doc gaps (unrelated to competitive analysis, but still open — do alongside Phase 0 since it's cheap)

1. ✅ **Done** — `docs/DATABASE.md` §8 "Migration Strategy" (how additive schema changes are rolled out today — no formal migration runner exists; documents the actual convention: nullable new fields + optional idempotent backfill scripts under `scripts/`, plus the deploy-time `autoIndex`/`syncIndexes` operational note this uncovered).
2. ✅ **Done** — `README.md` §12 "Testing & Staging Environments" (how to configure this same codebase safely for manual QA and pre-release staging using existing env-var-driven config — no separate infra/tooling is provisioned by this repo for either).

---

## Phase 1 — Public catalog & marketing surface

**Status: Phase 1 complete — 1.1 ✅, 1.2 ✅, 1.3 ✅, 1.4 ✅ resolved.**

**Platform-scope decision (1.4):** resolved as **multi-platform** — Telegram, Instagram, TikTok, and YouTube are now seeded (see 1.3 below), with the product rebranded from "TG Panel" to "SMM Panel" to match. 1.1's schema and 1.2's public-catalog plumbing were both built decision-agnostically as planned, so neither needed rework once this decision landed.

### 1.1 `ServiceGroup` model + `Category.groupId`

**✅ Shipped and verified.**

**Files touched:** `models/ServiceGroup.ts` (new), `models/Category.ts` (added `groupId`), `models/index.ts` (registered), `models/AuditLog.ts` (added `SERVICE_GROUP_CREATED`/`UPDATED`/`DELETED` audit actions), `lib/validation.ts` (`serviceGroupSchema` + `categorySchema.groupId`), `app/api/admin/service-groups/route.ts` + `[id]/route.ts` (new admin CRUD, following the exact pattern of the existing categories routes), `app/api/admin/categories/route.ts` + `[id]/route.ts` (extended to accept/validate `groupId`, rejecting a request that references a non-existent group with `400`), `app/admin/service-groups/page.tsx` + `components/admin/service-groups-manager.tsx` (new admin UI page, mirroring `categories-manager.tsx`'s structure), `components/admin/categories-manager.tsx` (extended with a group-assignment `<select>` at creation time and inline per-row group reassignment), `components/admin/sidebar.tsx` (added nav item).

**Schema (as actually implemented — matches the plan):**
```ts
// models/ServiceGroup.ts
interface IServiceGroup {
  _id: Types.ObjectId;
  name: string;        // e.g. "🚀 Telegram Boost", unique
  slug: string;        // unique, lowercase, auto-derived from name
  icon: string | null; // emoji or icon key, display only
  sortOrder: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```
`Category.groupId: Types.ObjectId | null` (`ref: "ServiceGroup"`, `default: null`, indexed) — nullable and defaulted, zero migration risk.

**What was intentionally left out of this pass:** `scripts/backfill-service-groups.ts` was correctly identified as *optional* in the original plan (only needed if retroactively grouping existing categories in bulk) — not built, since the admin UI's per-category group-assignment dropdown already covers this for the current, still-small catalog size. Build the backfill script if/when the catalog grows large enough that assigning categories one-by-one through the UI becomes impractical.

**Acceptance criteria — all verified against a real production build + live MongoDB Atlas connection, not just typecheck:**
- ✅ Admin can create a service group (`POST /api/admin/service-groups`) — verified live, response included correct auto-derived `slug`.
- ✅ Duplicate group name correctly rejected with `409`.
- ✅ Admin can assign an existing (pre-existing, predating this schema change) category to a group via `PATCH /api/admin/categories/:id` — verified the category's stored document gained a `groupId` field with no error, proving the additive/nullable migration approach works with zero data-migration step required.
- ✅ Assigning a category to a **non-existent** group id is correctly rejected with `400` ("Service group not found") rather than silently creating a dangling reference.
- ✅ Deleting a group that still has categories assigned to it is correctly blocked with `400` and a clear message (grammar-checked for both singular/plural: "1 category still belongs" vs. "2 categories still belong").
- ✅ After unassigning, the same group deletes successfully.
- ✅ Existing, unrelated functionality confirmed unaffected: authenticated `/api/services` catalog endpoint, `/dashboard/services` order-placement page, and both new/existing admin pages (`/admin/categories`, `/admin/service-groups`) all returned `200` and correct data throughout testing.
- ✅ `npm run typecheck`, `npm run lint`, and a full `npm run build` all clean before and after.

**Risk:** low (purely additive) — confirmed in practice, not just in theory.

### 1.2 Public (unauthenticated) service catalog — ✅ Shipped and verified

**Files actually touched:** new `lib/services/catalog.ts` (shared query/shaping helper, see below), new `app/api/public/services/route.ts`, new `app/services/page.tsx`, new `components/public/service-catalog.tsx`, `app/page.tsx` (added a "View service catalog" link), `app/api/services/route.ts` (refactored to call the new shared helper instead of duplicating the query), `app/sitemap.ts` (now async, lists `/services` plus one entry per active `Category` slug from the DB), `app/robots.ts` (comment update only — `/services` was already allow-listed pre-emptively in Phase 0.2).

**Implementation deviates from the original task list in one deliberate way:** the plan described the public route and the existing authenticated `/api/services` route as two independent implementations that both needed the same exclusion list "not regressed." Instead, a single `lib/services/catalog.ts#getPublicCatalog()` function was extracted and is now called by *both* routes — the authenticated route adds only its `auth()` check and skips the `Cache-Control` header (session-authenticated responses shouldn't be cached by shared/proxy caches) on top of the identical shared query. This guarantees the exclusion list can't drift between the two routes, and per `MEMORY.md`'s new note, Phase 2.2's future `/api/v2` reseller endpoint should reuse this same function rather than becoming a third independent implementation.

**Catalog shape decision:** the shared helper returns a 3-level tree grouped by `ServiceGroup → Category → Service`, but categories/services with no `groupId` are placed under a synthetic `{ _id: null, name: "Other Services" }` bucket rather than being dropped — necessary because a group is optional (Phase 1.1) and today's actual seed data has zero categories assigned to any group, so naively filtering ungrouped items would have hidden the entire catalog. Empty categories (zero active services) and empty groups (zero non-empty categories) are silently omitted from the response.

**Tasks completed:**
1. `GET /api/public/services` — no `auth()` call, confirmed live via curl with no cookies. Returns the tree above with `providerId`/`providerServiceId`/`providerRate` excluded (verified live: response body grepped for those three field names, zero matches). Ships `Cache-Control: public, max-age=60, stale-while-revalidate=300` as planned, documented in [`ARCHITECTURE.md` §3](ARCHITECTURE.md#3-authentication--authorization-flow).
2. **Not** added to `checkOrigin`'s exemption list — left on the default same-origin policy. Verified live: a request with `Origin: https://evil.example.com` got `403`; the same request with `Origin: http://localhost:3000` (matching `ALLOWED_ORIGINS`) got `200`. This is an explicit, documented choice (see `ARCHITECTURE.md`), not an oversight — revisit if a legitimate cross-origin consumer (e.g. an embeddable widget) appears.
3. `app/services/page.tsx` — confirmed by reading `auth.config.ts`'s `authorized()` callback before writing this page that it only special-cases `/dashboard` and `/admin` path prefixes, so this new top-level route needed no proxy/matcher change to stay public; verified live (no session cookie, `200`, full catalog HTML in the initial response, not client-fetched). Data fetching happens directly in the Server Component via `getPublicCatalog()` (not a client-side call to the new API route) so the page is server-rendered and crawlable with real data already in the initial HTML — the API route exists independently for other consumers. Renders a "Sign in to order" CTA for anonymous visitors and a working "Order"/"Go to dashboard" CTA for authenticated ones (verified both states live: logged out shows "Sign in to order", logged in as admin shows "Order" + "Go to dashboard" in the header).
4. `app/robots.ts` already allow-listed `/services` pre-emptively in Phase 0.2 (only the explanatory comment needed updating now that the route exists). `app/sitemap.ts` was converted from a static, synchronous function to an `async` one that queries `Category.find({ active: true })` and emits one `/services#<slug>` entry per category, falling back to the static entries only (not throwing/500ing the whole sitemap) if the DB call fails — verified live via `curl /sitemap.xml`.

**Acceptance criteria — all verified live against real MongoDB Atlas data, not just typecheck:**
- ✅ `/services` renders without login (curl with no cookies, `200`, full HTML with real service name/price from the DB).
- ✅ Live pricing pulled from the DB, not static copy (same demo service/price shown on `/services` and on the authenticated `/dashboard/services`/`/api/services`, from the one shared query).
- ✅ Crawlable with a generic user-agent, no cookie (verified with `curl -A "Mozilla/5.0 (compatible; Googlebot/2.1)"`, `200`, real content in the response body — not a client-side-only render).
- ✅ Authenticated users clicking through from `/services` land on the real order flow (`/dashboard/services`, verified the link target and that the page still renders services correctly for a logged-in admin).
- ✅ Anonymous users see "Sign in to order" instead of a broken order button, linking to `/login?callbackUrl=/dashboard/services`.
- ✅ No provider-secret fields (`providerId`/`providerServiceId`/`providerRate`) present in the public JSON response — verified by grep on the live response body.
- ✅ Existing, unrelated functionality confirmed unaffected: authenticated `/api/services` (now backed by the shared helper) and `/dashboard/services` both still returned `200` with correct data throughout testing.
- ✅ `npm run typecheck`, `npm run lint`, and a full `npm run build` all clean before and after; build output confirmed `/services` and `/api/public/services` present as new routes.

**Risk:** medium, as flagged in the original plan — the first genuinely public, unauthenticated data-serving route in the project. Reviewed carefully for data leakage (see the exclusion-list verification above) and for accidental route-protection gaps (verified via `auth.config.ts` review, not assumed).

### 1.3 Landing page rebuild — ✅ Shipped and verified

**Decision made (1.4, resolved before this task started):** the project owner chose **multi-platform**, not Telegram-only, and additionally chose to rebrand the product name from "TG Panel"/"Telegram SMM Panel" to **"SMM Panel"** since the Telegram-specific name no longer fit. Both decisions are reflected below.

**Files actually touched:** `app/page.tsx` (full rewrite), `lib/services/catalog.ts` (added `getCheapestServices()`), `scripts/seed.ts` (rewritten to seed one `ServiceGroup`/`Category`/`Service` per platform — Telegram, Instagram, TikTok, YouTube — idempotently, including backfilling the group assignment on the pre-existing Telegram category), `app/layout.tsx` + `components/dashboard/sidebar.tsx` + `app/services/page.tsx` + `lib/mail.ts` + `lib/telegram/bot.ts` + `models/Settings.ts` + `README.md` + `.env.example` (rebrand: "TG Panel"/"Telegram SMM Panel" → "SMM Panel").

**Tasks completed:**
1. `app/page.tsx` rewritten with: a real feature list grounded in `README.md` §1 (one-line-per-bullet mapping, no invented claims — e.g. "Order Telegram, Instagram, TikTok, YouTube... from a single catalog" maps directly to the now-multi-platform `ServiceGroup` structure, "Transparent wallet" maps to the existing immutable-ledger implementation), a 5-question FAQ written in this project's own voice (deliberately does **not** claim "real, active accounts" or any other unverifiable claim — e.g. the security FAQ answer explicitly says "We don't claim to be a bank-grade financial institution" rather than overclaiming), and a live pricing preview showing the 4 cheapest services across the whole catalog via the new `getCheapestServices()` helper (sorts all services by `rate` ascending, takes the top N) — verified live to render real, sorted DB prices, not hardcoded examples.
2. Compliance-conscious tone preserved — no fake-engagement claims, no invented user counts/testimonials.
3. **Not originally scoped, but necessary once "multi-platform" was chosen:** `scripts/seed.ts` only had one Telegram-only demo service, which would have made the new pricing preview and public catalog look Telegram-only regardless of what the copy said. Rewrote it to seed one demo `ServiceGroup`/`Category`/`Service` per platform (Telegram/Instagram/TikTok/YouTube), each clearly labeled "(Demo)" and provider-less (manual fulfillment only), following the same idempotent `findOne`-then-create guard as the original script. Also handles the migration case where the pre-existing Telegram category predates `ServiceGroup` (Phase 1.1) by backfilling its `groupId` rather than creating a duplicate category — verified live by running the script twice (first run created 3 new groups + backfilled the 4th; second run created nothing, confirming idempotency).
4. **Not originally scoped, but a real bug found and fixed during verification:** `app/sitemap.ts` (made async/DB-backed in 1.2) was being **statically prerendered at build time** by Next.js (confirmed in the `next build` route table: `○ /sitemap.xml`, the static-page marker) since it has no built-in signal (no `headers()`/`cookies()`/`searchParams`) telling the framework to treat it as per-request dynamic. This meant the sitemap would have silently gone stale after every deploy and never reflected newly-added categories until the next build — defeating the entire point of making it DB-backed in 1.2. Fixed by adding `export const dynamic = "force-dynamic"`. Verified live: before the fix, `curl /sitemap.xml` after seeding 3 new categories still showed only the original pre-seed category; after adding the export and rebuilding, the route table showed `ƒ /sitemap.xml` (dynamic) and the same curl immediately showed all 4 categories.

**Acceptance criteria — all verified live against real MongoDB Atlas data, not just typecheck:**
- ✅ Landing page pulls real data: the pricing preview table showed the actual 4 seeded demo services sorted by price ascending ($0.80 TikTok, $1.50 Telegram, $2.00 Instagram, $3.50 YouTube), matching the DB exactly.
- ✅ No hardcoded example services/prices remain in `app/page.tsx`.
- ✅ All copy claims verified against actually-implemented features (traced each landing-page bullet back to a real `README.md` §1 feature or existing schema behavior).
- ✅ Logged-out visitors see the full marketing page; logged-in users are still redirected to `/dashboard` or `/admin` (existing `redirect()` logic preserved and re-verified live with an authenticated admin session).
- ✅ Rebrand is complete and consistent: `grep -rn "TG Panel"` across the repo returns zero matches after this change; dashboard sidebar, landing page, services page, transactional email `from` name, Telegram bot welcome message, and site settings default name all say "SMM Panel".
- ✅ `npm run typecheck`, `npm run lint`, and a full `npm run build` all clean before and after (including after the `sitemap.ts` fix, re-verified with a second full rebuild).

**Risk:** low, as flagged in the original plan (presentation-layer only) — though the sitemap static-rendering bug found during verification is a good reminder that even "presentation-only" changes to Next.js metadata routes can have real, easy-to-miss correctness bugs if not verified live post-build.

### 1.4 Scope decision checkpoint — ✅ Resolved

The project owner decided: **multi-platform** (Telegram, Instagram, TikTok, YouTube seeded initially, more addable via the existing `ServiceGroup`/`Category` admin UI or `scripts/seed.ts`), and additionally decided to rebrand from "TG Panel" to **"SMM Panel"** to match. Both 1.2 (public catalog, built platform-agnostic as planned) and 1.3 (landing copy, written for multi-platform from the start) required no rework as a result of this decision — confirming the original plan's assessment that the schema/plumbing work didn't need to block on this decision, only the final content/copy did.

**Phase 1 is now fully shipped: 1.1 ✅, 1.2 ✅, 1.3 ✅, 1.4 ✅ resolved.**

**Later update (post-Phase 4, "avoid demo" cleanup pass):** `scripts/seed.ts` was subsequently changed to stop creating the 4 example "(Demo)" services described above — it now only creates the admin account and default settings. Real catalog data is expected to be created from the admin panel once a real `Provider` (or a deliberate MANUAL-fulfillment offering) exists, so nothing that looks like a real, orderable service ships without a real fulfillment path behind it. See `README.md` §1/§7 for the current behavior; the history above is preserved as an accurate record of the original Phase 1.3 decision, not of the script's current behavior.

---

## Phase 2 — Reseller API & provider redundancy

**Status: 2.1 ✅ shipped and verified. 2.2 ✅ shipped and verified. Phase 2 is now fully complete.**

### 2.1 `ServiceProvider` multi-provider linking model — ✅ Shipped and verified

**Files actually touched:** new `models/ServiceProvider.ts`, `models/index.ts` (registered), `models/AuditLog.ts` (4 new audit actions), `lib/validation.ts` (`serviceProviderSchema`), new `scripts/backfill-service-providers.ts` (+ `package.json` script entry), `lib/fulfillment.ts` (rewritten dispatch logic), new `app/api/admin/services/[id]/providers/route.ts` + `[linkId]/route.ts` (admin CRUD, nested under the owning service rather than a flat `/api/admin/service-providers`), new `components/admin/service-providers-panel.tsx` (expandable per-service panel), `components/admin/services-manager.tsx` (added an expand/collapse row control), `app/admin/services/page.tsx` (pass `type` through to the provider dropdown). **Additionally, a genuine pre-existing production bug was found and fixed during this task's live verification — see below, this was not planned scope but was a necessary fix to verify anything at all.**

**Schema (as implemented, matches the plan):**
```ts
interface IServiceProvider {
  _id: Types.ObjectId;
  serviceId: Types.ObjectId;      // ref Service
  providerId: Types.ObjectId;     // ref Provider
  providerServiceId: string;
  providerRate: Decimal128;
  priority: number;               // lower = tried first
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```
`{ serviceId: 1, active: 1, priority: 1 }` compound index (dispatch query shape) plus a unique `{ serviceId: 1, providerId: 1 }` index (a provider can only be linked to a given service once — edit the existing link instead of creating a second one).

**🚨 Critical pre-existing bug found and fixed during this task (unrelated to Phase 2.1's own code, discovered while trying to place a test order to verify it):** `models/Transaction.ts`'s `idempotencyKey` field was declared `{ default: null, unique: true, sparse: true }`. A MongoDB sparse index only excludes documents where the field is **completely absent** — not documents that explicitly store `null`. Because `default: null` made Mongoose write `idempotencyKey: null` onto every transaction that doesn't set one (i.e. every `ORDER_PAYMENT` and `ORDER_REFUND` transaction — only `DEPOSIT` transactions set a real key), **the second such transaction ever created in the system's entire history collided on the unique index**, aborting its enclosing `mongoSession.withTransaction()` call. Net effect: **every order placed by any customer, from the second one in the system's history onward, failed with an unhandled 500** — confirmed live (order count stuck at 1 despite multiple attempts, with `E11000 duplicate key error ... idempotencyKey: null` in server logs). Because the failure happened inside an atomic transaction, no customer was ever double-charged or left with an orphaned order — the wallet debit and order creation were correctly rolled back together — but the practical effect was that **ordering was completely broken for a second order onward, going unnoticed until now.** Fixed by removing `default: null` from the schema (so the field is genuinely omitted, not explicitly `null`, matching what `sparse` actually requires) and running a one-time `$unset` on the one pre-existing document that had the explicit `null` value stored. Verified live: placed 3 more test orders after the fix, all succeeded.

**Tasks completed:**
1. Model added, registered, admin CRUD surface built as an expandable per-service panel (`ServiceProvidersPanel`) rather than a separate top-level admin page — each service row in `/admin/services` expands to show/manage its linked providers in priority order, since every provider link is inherently scoped to one service.
2. **Backfill script** (`scripts/backfill-service-providers.ts`): for every `Service` with a non-null legacy `providerId`, creates one `ServiceProvider` row (`priority: 0`), idempotently (skips if a row already exists for that `serviceId`+`providerId` pair). Verified live: ran it against a test service with a legacy `providerId` set (created 1 row), ran it again (created 0, confirming idempotency), and separately confirmed it correctly reports "0 candidates" when no legacy-provider services exist.
3. `lib/fulfillment.ts#dispatchOrderToProvider` rewritten: `resolveDispatchCandidates()` now looks up `ServiceProvider.find({ serviceId, active: true }).sort({ priority: 1 })` first, and only falls back to the legacy `Service.providerId`/`providerServiceId` fields when zero `ServiceProvider` rows exist for that service — a genuinely zero-migration-required fallback. Within one dispatch attempt, candidates are tried in priority order; on failure (thrown error or an inactive/missing provider), the next candidate is tried immediately, not on the next scheduled worker pass. `order.statusHistory` notes now explicitly name which provider succeeded and list every earlier failure in the same attempt (e.g. `"Awaiting manual fulfillment (provider: Test Provider A) (after 1 earlier provider failure(s) this attempt: Test Provider B (broken): fetch failed)"`) — satisfying the plan's "record which provider ultimately succeeded/failed... for audit purposes" requirement concretely, not just structurally.
   - **A second real bug (introduced by this task's own new code, caught before shipping) was found and fixed during verification:** the `ServiceProvider.populate("providerId")` call didn't re-select `apiKeyEncrypted` (which has `select: false` on `models/Provider.ts`), so every `API`-type provider linked via `ServiceProvider` would incorrectly report "Provider is missing API configuration" even when correctly configured — verified live before the fix (error read "missing API configuration") and after (error correctly changed to the real underlying `fetch failed` network error once `.populate({ path: "providerId", select: "+apiKeyEncrypted" })` was added).
   - **A third bug — pre-existing, not introduced by Phase 2.1, but found while regression-testing the retry path this task's fallback logic depends on:** `dispatchOrderToProvider`'s original guard clause (`if (!order || order.status !== "PENDING") return;`) silently no-op'd on any order already in `PROCESSING` — including orders left in `PROCESSING` specifically so the background worker (`scripts/process-orders.ts`) could retry them, per `docs/ARCHITECTURE.md` §5's documented design ("candidate for retry... up to `MAX_ATTEMPTS`"). Since `scripts/process-orders.ts`'s own candidate query explicitly selects `status IN (PENDING, PROCESSING)`, it was picking up failed orders every pass and handing them to a function that then did nothing — **no order that failed dispatch even once was ever actually retried**, contradicting the documented resilience design and silently defeating `MAX_ATTEMPTS`. Verified live: created a service with a single always-broken `API` provider, placed an order (failed dispatch, `attempts: 1`, `status: PROCESSING`, `lastError` set), ran `npm run process-orders` — `attempts` stayed at `1`, confirming the bug. Fixed by widening the guard to also treat `status === "PROCESSING" && lastError != null` as retry-eligible (a `PROCESSING` order with `lastError: null` means an active MANUAL/API/INTERNAL dispatch already succeeded and must never be silently re-dispatched — this distinction, and why `PROCESSING` is overloaded to mean two different things, is documented directly in `lib/fulfillment.ts`). Verified live after the fix: re-ran `npm run process-orders` against the same broken-provider order — `attempts` incremented to `2` and a new `statusHistory` entry was appended, confirming retry now actually happens; separately verified a MANUAL-success order (`status: PROCESSING`, `lastError: null`) was correctly left untouched (`attempts` stayed at `1`, no new history entry) by the same worker run, confirming no regression to the "don't touch a provider a human is already handling" case.
4. **Decision (per the plan's task 4):** `Service.providerId`/`providerServiceId`/`providerRate` are kept, deprecated-but-not-removed, as documented in `models/ServiceProvider.ts`'s doc comment and `docs/DATABASE.md` §2 — consistent with this project's additive-migration philosophy, and required anyway since they're the legacy-fallback path `lib/fulfillment.ts` reads when no `ServiceProvider` rows exist yet.

**Acceptance criteria — all verified live against real MongoDB Atlas data:**
- ✅ Existing single-provider orders continue to dispatch identically after backfill: placed an order against a backfilled service, confirmed dispatch used the `ServiceProvider` row (not the legacy fields) and produced the same `"Awaiting manual fulfillment"` outcome as before, with no unexpected side effects.
- ✅ A service configured with 2 providers (priority 0 = an intentionally-broken `API` provider, priority 1 = a working `MANUAL` provider) correctly fell back: dispatch tried the broken provider first (confirmed via its real network error appearing in `lastError`/`statusHistory`), then succeeded on the second.
- ✅ Admin can view/manage provider priority per service via the new expandable panel; link/unlink/reprioritize/toggle-active all verified live via direct API calls (`POST`/`PATCH`/`DELETE` on `/api/admin/services/[id]/providers[/linkId]`).
- ✅ Duplicate link (same `serviceId`+`providerId` twice) correctly rejected with `409`; linking a non-existent `providerId` correctly rejected with `400`.
- ✅ `npm run typecheck`, `npm run lint`, and a full clean-room `rm -rf node_modules && npm ci && npm run build` all clean before and after every change in this task, including after each bug fix.
- ✅ All test data (orders, transactions, services, provider links, providers, wallet balance) cleaned up from Atlas after verification, confirmed via a direct count query.

**Two smaller correctness fixes, both verified live, rounded out this task:**
- `app/api/admin/providers/[id]/route.ts`'s `DELETE` handler previously only checked `Service.countDocuments({ providerId })` before allowing a provider to be deleted — a provider referenced *only* via a `ServiceProvider` link (the normal case for any service configured after this task) could be deleted while still actively wired into a live dispatch fallback chain. Now checks both `Service.providerId` (legacy) and `ServiceProvider.providerId` counts and reports both in the error message if either is non-zero. Verified live: linked a provider via `ServiceProvider` only, confirmed `DELETE` was correctly rejected (`400`, `"...referenced by 1 service link(s) via ServiceProvider"`); unlinked it, confirmed `DELETE` then succeeded.
- `scripts/process-orders.ts`'s candidate query filtered `providerId: { $ne: null }` — but `Order.providerId` is only ever set once a dispatch attempt *succeeds*; for a service whose only providers are `ServiceProvider`-linked (no legacy `Service.providerId`), an order whose very first dispatch attempt fails keeps `providerId: null` forever, so this filter silently and **permanently** excluded it from every future retry pass — a real regression for exactly the kind of service Phase 2.1 is meant to make more reliable, not less. Verified live: created a `ServiceProvider`-only service backed by a broken provider, placed an order (dispatch failed, `providerId` stayed `null`), ran the worker — `"No orders to process"` despite the failed order sitting there eligible by every other criterion. Fixed by removing the filter entirely (the `dispatchOrderToProvider` "zero candidates" path already handles a genuinely provider-less order safely, so the filter was providing no protection, only breaking retries). Verified live after the fix: the same order was picked up and retried (`attempts` incremented, new `statusHistory` entry appended).

**Risk:** medium, as flagged in the original plan — touches the money-adjacent dispatch path. In practice, the highest-risk findings weren't in the new Phase 2.1 code's happy path but in edge cases (a pre-existing bug the new feature's testing happened to surface, plus two gaps in how the new feature interacted with pre-existing worker/deletion code) — a good argument for this project's standing practice of live end-to-end verification against real data, including deliberately-broken-provider and zero-legacy-field scenarios, rather than trusting typecheck/lint/build or a single happy-path test alone.

### 2.2 `ApiKey` model + `/api/v2` reseller endpoint — ✅ Shipped and verified

**Files actually touched:** new `models/ApiKey.ts` (registered in `models/index.ts`), `models/AuditLog.ts` (`API_KEY_CREATED`/`API_KEY_REVOKED`), new `app/api/v2/route.ts`, `lib/rate-limit.ts` (new `apiV2` and `apiKeyCreate` configs), `lib/validation.ts` (`apiKeyCreateSchema`, `apiV2RequestSchema`), new `lib/services/api-keys.ts` (shared key issuance/resolution logic), new `app/api/api-keys/route.ts` + `[id]/route.ts` (customer-facing key management), new `app/dashboard/api-keys/page.tsx` + `components/dashboard/api-keys-panel.tsx`, `components/dashboard/sidebar.tsx` (new nav item), new `docs/API.md`.

**Schema (slightly extended from the original plan — added `keyPrefix` for display purposes):**
```ts
interface IApiKey {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  keyHash: string;      // SHA-256 hash via lib/crypto.ts#hashToken — never store raw
  keyPrefix: string;    // first ~17 chars of the raw key, for display ("smm_live_a1b2c3d4…") — not enough to authenticate with
  label: string | null;
  lastUsedAt: Date | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```
`keyHash` unique; `{userId, createdAt}` compound for the dashboard's key list. `keyPrefix` was added beyond the original plan's schema sketch because a key-management UI needs *some* way to let a user tell their keys apart in a list beyond the label alone (e.g. two keys both labeled "Bot") — 8 raw bytes of the actual key, never enough entropy to reconstruct or brute-force the real key from.

**Tasks completed, all matching the original plan:**
1. `POST /api/api-keys` (session-authenticated) generates a raw key (`lib/crypto.ts#generateRawToken`, prefixed `smm_live_`), stores only its `hashToken()` hash, returns the raw key **once** — same "shown only at creation" convention as the Telegram link-code flow. `DELETE /api/api-keys/[id]` revokes (soft — `active: false`, scoped to `{_id, userId}` so a user can never revoke another user's key by guessing an id).
2. `POST /api/v2` dispatches on `action`:
   - `services` → calls the exact same `getPublicCatalog()` from `lib/services/catalog.ts` (Phase 1.2) used by the public website and the authenticated `/api/services` route — a third consumer, not a third implementation — flattened to one row per service to match the reference contract's flat-array shape.
   - `add` → calls the same `placeOrder()` from `lib/services/orders.ts` already shared by the website and Telegram bot — verified live to produce an identical `Order`/`Transaction`/wallet-debit result (balance correctly debited by the same `calculateCharge()` math, `Order.statusHistory` identical shape) as a website-placed order.
   - `status` → single (`order`) or bulk (`orders`, comma-separated, capped at 100 per the reference contract) lookup, always scoped to `{_id, userId: apiKey.userId}`. **Note on the original plan's wording:** the plan called this out as a separate `multistatus` action; the actual real-world convention (confirmed by reading multiple reference panels' published API docs before implementing, not assumed) is that `status` handles both cases via which parameter (`order` vs `orders`) is present — there is no separate `multistatus` action name in the ecosystem this contract mirrors, so this implementation follows the real convention rather than the plan's exact word.
   - `balance` → reads the caller's `Wallet.balance`, scoped by `userId`.
   - `cancel` → calls the same `refundOrder()` from `lib/services/admin-orders.ts` already used by the admin dashboard, after checking the order is still `PENDING`/`PROCESSING` (not yet dispatched past that point) and belongs to the caller.
   - `refill` → deliberately returns `{"error": "Refill is not currently supported by this panel."}` rather than a silent no-op, since this platform has no refill/guarantee feature yet — per the plan's own instruction for this exact situation.
3. `apiV2: [120, 60]` (per-key, not per-IP) added to `lib/rate-limit.ts`; also added `apiKeyCreate: [5, 600]` (per-user+IP) to rate-limit key *creation* itself, which the original plan didn't explicitly call out but follows this project's standing convention of rate-limiting every state-changing customer-facing endpoint.
4. `docs/API.md` written, documenting every action's request/response shape, the "always HTTP 200, check the `error` field" convention (verified against multiple real reference panels' docs before writing this, not assumed), and the explicit list of what this version deliberately does not support (webhooks, per-key scoped permissions).

**One additional, deliberate design decision beyond the plan's explicit scope:** the endpoint accepts **both** `application/x-www-form-urlencoded` and `application/json` request bodies (real reseller integration code is split roughly evenly between these two conventions across the reference panels researched), and accepts the API key via **either** a `key` body field (the traditional convention) or an `X-Api-Key` header (friendlier to modern HTTP clients) — both verified live.

**Acceptance criteria — all verified live against real MongoDB Atlas data:**
- ✅ `services` returns the real catalog (same data as the public website), `add` places a real order and correctly debits the wallet by the exact expected `calculateCharge()` amount, `status` (single and bulk, including a mix of one valid + one invalid id) returns correct per-order data, `balance` returns the real wallet balance, `cancel` correctly refunds an eligible order and rejects a second cancel attempt on the same order.
- ✅ **Per-key scoping verified with two separate real accounts**: created a second registered user with their own API key, confirmed their `balance` action returns their own (different, correct) balance, and confirmed their `status`/`cancel` actions against the FIRST user's real order id both return the same `{"error": "Incorrect order ID"}` a genuinely nonexistent id would produce — i.e. this endpoint cannot be used to enumerate or confirm the existence of another user's orders, not just "returns an error" but specifically an *indistinguishable* one.
- ✅ Revoking a key immediately invalidates it — verified live (revoked key's very next request rejected with `"Invalid API key."`).
- ✅ Rate limiting verified live: 150 concurrent requests against one key, ~120 succeeded before `"Rate limit exceeded..."` responses began appearing, consistent with the configured `[120, 60]` limit.
- ✅ Cross-origin protection (`lib/security/origin.ts`) correctly still rejects a request carrying a foreign `Origin` header (simulating an in-browser call from an unauthorized site) with `403`, while genuine server-to-server reseller calls (no `Origin` header at all — the normal case for this kind of integration) pass through untouched — verified live, confirming `/api/v2` didn't need any origin-check exemption since it was never blocked for its real use case in the first place.
- ✅ `npm run typecheck`, `npm run lint`, and a full `rm -rf node_modules && npm ci && npm run build` all clean.
- ✅ All test data (two extra API keys, one test order + its transactions, one extra test user + wallet) cleaned up from Atlas after verification.

**Risk:** medium-high, as flagged in the original plan — a new trust boundary. In practice, the highest-value verification wasn't the happy path (which matched the plan's design closely) but the cross-account scoping test — this is exactly the kind of bug (a reseller silently able to see another reseller's orders) that would be catastrophic in production and easy to miss without deliberately testing with two real accounts, not just one.

**Est. effort:** 12–20 hours including `docs/API.md` — matched the original estimate.

---

## Phase 3 — Trust/retention features

**Status: ✅ all of Phase 3 implemented and live-verified against real Atlas data — 3.1 ✅, 3.2 ✅, 3.3 ✅.**

### 3.1 Order refill (self-service) — ✅ Shipped and verified

**Files actually touched:** `models/Order.ts` (`completedAt`, `refillStatus`, `refillRequestedAt`, `providerRefillId` fields), `models/Service.ts` (`refillDays`), new `lib/services/refill.ts` (`requestRefill`, `isRefillEligible`, `resolveManualRefill`), `lib/fulfillment.ts` (new `requestProviderRefill`, mirroring `callProviderApi`'s structure), new `app/api/orders/[id]/refill/route.ts`, `app/api/admin/orders/[id]/route.ts` (extended to accept a `refillResolution` action), `lib/services/admin-orders.ts`'s `changeOrderStatus` (sets `completedAt` on first transition to `COMPLETED`), `lib/validation.ts` (`serviceSchema`/`serviceBaseSchema` split — see bug note below), `components/dashboard/refill-button.tsx` + `app/dashboard/orders/page.tsx` (customer UI), `components/admin/orders-table.tsx` + `app/admin/orders/page.tsx` (admin resolution UI), `components/admin/services-manager.tsx` + `app/admin/services/page.tsx` (`refillDays` admin config field), `models/AuditLog.ts` (`ORDER_REFILL_REQUESTED`, `ORDER_REFILL_RESOLVED`).

**Design matches the original plan closely, plus one addition beyond the original scope:** the plan's task 3 said manual/no-provider refills should be "marked `PROCESSING`/admin-queue for `MANUAL` providers," but the original implementation pass left them stuck in `REQUESTED` forever with no admin action to ever resolve them — found during live verification (see Errors & Dead Ends below). Closed by adding `resolveManualRefill()` plus an admin UI affordance (Refill column on `/admin/orders` showing "Requested — needs action" with "Mark fulfilled"/"Decline" buttons when `refillStatus === "REQUESTED"` and no automatic provider action was possible), wired through the same `PATCH /api/admin/orders/[id]` endpoint via a new `refillResolution` field, fully audited (`ORDER_REFILL_RESOLVED`).

**API-surface scope decision:** `requestRefill()` is reachable from the customer dashboard (`POST /api/orders/[id]/refill`) only — the reseller `/api/v2` endpoint's `refill` action deliberately still returns "not currently supported by this panel" rather than being wired to the same function (see `docs/API.md`'s note on this). Extending refill to resellers was out of this phase's agreed scope; wiring it later is a small follow-up (same `requestRefill()` function, new call site) whenever that's prioritized.

**Acceptance criteria — all verified live against real MongoDB Atlas data:**
- ✅ "Request Refill" button appears exactly once on a newly-eligible `COMPLETED` order and disappears immediately after a successful request.
- ✅ Refill succeeds against a real (fake, sandboxed) `API`-type provider, recording `providerRefillId` and marking `refillStatus: "COMPLETED"`.
- ✅ All eligibility/rejection paths verified individually: already-requested (`"A refill has already been requested for this order."`), not-completed (`"Only completed orders are eligible for a refill."`), nonexistent/other-user order (`"Order not found."`, no distinguishable leak), service with `refillDays: null` (`REFILL_NOT_SUPPORTED`), and an expired refill window (`REFILL_WINDOW_EXPIRED`, tested via a backdated `completedAt`).
- ✅ Admin config UI (`/admin/services`) correctly serializes/edits `refillDays` per service.
- ✅ Manual/no-provider refill requests correctly stay `REQUESTED` and are visible + actionable in `/admin/orders`; resolving one (`COMPLETED` or `REJECTED`) is idempotent-guarded (a second resolution attempt on an already-resolved request is rejected with `409 REFILL_NOT_PENDING`) and fully audited.
- ✅ `npm run typecheck`, `npm run lint`, and a full `rm -rf .next && npm run build` all clean.
- ✅ All test data (temp services, temp provider, all test orders/transactions/audit logs, test wallet balance) cleaned up from Atlas after verification.

**Two real bugs found and fixed during this phase's live verification (both documented in full in `MEMORY.md` and `docs/DATABASE.md`/`docs/API.md`'s relevant sections):**
1. **Mongoose `.select()` gotcha** in `lib/services/refill.ts`: `.select("+apiKeyEncrypted type")` (mixing a `+field` opt-in token with a plain field name) silently dropped every other field on the document, including `apiUrl` — breaking every refill against a real `API` provider with a misleading "Provider is missing API configuration" error. Fixed to `.select("+apiKeyEncrypted")` alone, matching the working pattern already used in `lib/fulfillment.ts`.
2. **Zod v4 `.partial()` + `.refine()` incompatibility** in `lib/validation.ts`: `serviceSchema.partial()` (used by the admin service-edit `PATCH` route) throws `"Error: .partial() cannot be used on object schemas containing refinements"` at request time — a **pre-existing bug unrelated to Phase 3**, latent since whenever `serviceSchema`'s `maxQuantity >= minQuantity` `.refine()` was first added, surfaced only now because this phase's `refillDays` field was the first thing to actually exercise that admin PATCH route during live testing. It broke **every** admin service edit, not just `refillDays` changes. Fixed by splitting out an unrefined `serviceBaseSchema` (exported) specifically for `.partial()` call sites, keeping `serviceSchema = serviceBaseSchema.refine(...)` for the creation (`POST`) route; the cross-field `maxQuantity >= minQuantity` invariant is now re-checked manually in the `PATCH` handler against the merged (existing + incoming) field values, so a partial edit touching only one of the two fields still can't corrupt the invariant.

**Risk:** low-medium, as estimated. **Actual effort:** in line with the original 4–8 hour estimate, plus the two bug investigations above.

### 3.2 Automatic partial-delivery refund — ✅ Shipped and verified

**Files actually touched:** `lib/fulfillment.ts` (new `pollOrderStatus(orderId)`), new `scripts/poll-order-status.ts` (separate scheduled script, same pattern as `scripts/process-orders.ts`), `lib/services/refunds.ts` (proportional partial-refund transaction logic, reusing the atomic `mongoose.startSession().withTransaction()` + `Wallet.version` optimistic-concurrency pattern from `lib/services/admin-payments.ts`), `models/Order.ts` (`partialRefundIssuedAt`, `lastStatusCheckAt` fields + a `{status, lastStatusCheckAt}` compound index for the poller's candidate query).

**Confirmed prerequisite gap (as the original plan called out):** no status-polling mechanism existed prior to this phase — `scripts/process-orders.ts` only ever dispatched new orders, never re-checked an already-`IN_PROGRESS` order's status. `pollOrderStatus`/`scripts/poll-order-status.ts` are net-new.

**Acceptance criteria — all verified live:**
- ✅ A simulated partial-completion provider response (`status: "Partial"`, real `remains` count returned by a sandboxed fake provider) correctly computed and credited the exact proportional refund amount to the customer's real Atlas wallet.
- ✅ Idempotency verified: re-running the poll against the same already-`PARTIAL` order does **not** double-refund — `partialRefundIssuedAt` guards against it.
- ✅ The refund appears as its own distinct, immutable `Transaction` row (`type: "ORDER_REFUND"`) with correct `balanceBefore`/`balanceAfter` snapshots.
- ✅ `npm run typecheck`, `npm run lint`, and a full build all clean; all test orders/transactions cleaned up from Atlas after verification.

**Risk:** medium, as estimated (money-moving). **Actual effort:** in line with the original 8–12 hour estimate including the polling prerequisite.

### 3.3 Median delivery-time estimate — ✅ Shipped and verified

**Files actually touched:** `models/Service.ts` (`estimatedDeliveryMinutes: number | null`), new `scripts/compute-delivery-estimates.ts`, `components/public/service-catalog.tsx` (renders `formatEta(service.estimatedDeliveryMinutes)`, both the public and authenticated catalog since both share the same component/query), `app/api/public/services` (confirmed the field passes through the public catalog API shape).

**Acceptance criteria — all verified live:**
- ✅ `scripts/compute-delivery-estimates.ts` run against real Atlas data correctly computed and wrote a median completion time from real `COMPLETED` orders' `completedAt - createdAt` deltas.
- ✅ Correctly excludes any order with a negative computed duration (`m >= 0` filter) — verified with a deliberately backdated test order.
- ✅ Catalog UI (both `/services` public and the authenticated dashboard) renders the estimate without any added per-request query load — precomputed, read directly off the `Service` document already being fetched for the catalog listing, no live calculation.
- ✅ Services with no completions yet correctly show `null`/"—" rather than a misleading `0`.

**Risk:** low, as estimated. **Actual effort:** in line with the original 3–5 hour estimate.

---

## Phase 4 — Growth/internationalization

Not detailed task-by-task here — genuinely large, market-decision-dependent effort per the roadmap. When this phase is greenlit, produce a dedicated `docs/I18N_PLAN.md` at that time covering: locale routing strategy (App Router `[locale]` segment, matching the reference site's own proven approach), translation file organization, RTL considerations if applicable, and currency-display (not ledger) conversion source/caching strategy.

**Update — locale routing (`en`/`bn`) implemented.** `next-intl` App Router integration is live: `[locale]` segment routing, `messages/en.json` / `messages/bn.json` translation files, `i18n/navigation.ts` locale-aware `Link`/`redirect`/`useRouter`, and a `LocaleSwitcher` component. `/admin` intentionally stays outside locale routing (English-only back office, per earlier scope decision).

**Update — currency-display conversion implemented (ledger stays USD-only).** The wallet/ledger, `Order.charge`, and every DB money field remain USD `Decimal128` — **no ledger or pricing logic was changed**. What was added is a purely presentational live-conversion layer:

- `models/ExchangeRateCache.ts` — singleton doc (`key: "latest"`) caching the full USD-base rate table fetched from the free `open.er-api.com` endpoint, DB-backed (not in-memory) for multi-instance/serverless consistency, 1-hour TTL, falls back to the last-known cached rates if a refetch fails.
- `lib/currency-format.ts` — pure, client-safe formatting helpers (`formatCurrencyAmount`, `defaultDisplayCurrencyForLocale`, attribution constants). No server-only imports, so client components can use it directly.
- `lib/currency.ts` — server-only I/O (`getExchangeRates`, `convertFromUsd`), re-exports the pure helpers above for convenience.
- `lib/services/display-money.ts` — `getDisplayMoney`/`getDisplayMoneyBatch`, the call-site helper pairing a USD primary amount with an optional live-converted secondary amount; never throws, returns `null` secondary when conversion isn't available or applicable.
- `components/shared/dual-currency.tsx` — presentational `<DualCurrency>` component used in Server Component pages.

Display currency is derived from the active locale (`bn` → BDT with Bengali-digit `Intl.NumberFormat` formatting; every other locale → USD, no secondary shown, matching the ledger currency exactly). Wired into: dashboard home (`/dashboard`), wallet page + transaction history (`/dashboard/wallet`), orders table (`/dashboard/orders`), the authenticated order form's estimated-charge line (`/dashboard/services`), the public service catalog (`/services`), and the landing page's cheapest-services pricing preview (`/`). All of these render **real, live-fetched exchange rates** — verified end-to-end against the actual cached DB rate ($1.50 × 122.692712 BDT/USD = ৳184.04, matching the rendered page output exactly) and confirmed visually via headless-browser screenshots (desktop + mobile, `en` + `bn`) of every wired page, including an authenticated login/session flow. An attribution note + link to ExchangeRate-API is shown wherever a converted secondary amount appears, per that provider's free-tier terms.

**Update — dashboard visual polish.** Two real (not cosmetic-only) gaps were fixed:

1. **Mobile navigation was completely missing.** `Sidebar` is `hidden md:flex`, so below the `md` breakpoint there was previously no way to navigate between dashboard sections at all short of editing the URL bar by hand — `DashboardHeader` only rendered the page title, locale switcher, and sign-out button. Fixed with `components/dashboard/mobile-nav.tsx`, a slide-in drawer (hamburger button + backdrop + `Escape`/backdrop-click/link-click to close) that reuses the exact same nav item list as the desktop `Sidebar` via a new shared `components/dashboard/nav-items.ts` hook, so the two surfaces can't drift out of sync. Verified visually via a headless-browser screenshot of the open drawer on a 390×844 viewport.
2. **Desktop sidebar active-state styling** was upgraded from a flat solid-blue background to a left accent bar + tinted background + icon-color change, matching the visual language used elsewhere in the dashboard (e.g. `DualCurrency`, stat cards).

**Update — platform-branded catalog icons.** `components/public/service-catalog.tsx`'s group headers (Telegram/Instagram/TikTok/YouTube, and a set of common extras for future groups) now render real official brand icons/colors from `react-icons/si` (e.g. Telegram's blue paper-plane, Instagram's pink camera) instead of a generic emoji or the fallback `Layers` icon — falls back gracefully to the admin-set emoji or `Layers` for any group name not in the known-platforms map, so newly created groups never render broken.

---

## Sequencing Summary

```
Phase 0 (CSP, robots/sitemap, doc gaps) ─── no dependencies, start anytime
        │
Phase 1.1 (ServiceGroup schema) ─── no dependencies, can start in parallel with Phase 0
        │
Phase 1.2 (public catalog API+page) ─── depends on 1.1
        │
Phase 1.3 (landing page rebuild) ─── depends on 1.2 (needs real data to pull from)
        │
Phase 1.4 (scope decision) ─── can happen anytime before 1.3's copy is finalized
        │
Phase 2.1 (ServiceProvider) ─── independent of Phase 1, can start anytime
        │
Phase 2.2 (/api/v2 reseller API) ─── depends on 2.1 (dispatch fallback) being stable,
        │                            and reuses 1.2's catalog query (extract shared fn)
        │
Phase 3.1 (refill) ─── independent, can start anytime after Phase 0
Phase 3.2 (partial refund) ─── needs new status-polling prerequisite built first
Phase 3.3 (delivery estimate) ─── independent, lowest priority of Phase 3
        │
Phase 4 (i18n/growth) ─── deliberately last, own planning doc when greenlit
```

## Recommended immediate next action

Start with **Phase 0 in full** (0.1, 0.2, 0.3) in the next work session — no open decisions block it, it's pure quality/security upside, and it's small enough to complete and verify end-to-end in one sitting. Then move to **Phase 1.1** (`ServiceGroup` schema) since it's also decision-independent and unblocks the highest-impact item in the whole plan (Phase 1.2's public catalog).
