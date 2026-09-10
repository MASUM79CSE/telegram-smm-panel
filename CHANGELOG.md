# Changelog

All notable changes to this project are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this
project uses [Semantic Versioning](https://semver.org/) starting now that
git history exists to anchor version tags to.

## [Unreleased]

### Added
- **Incident response runbook** (`docs/INCIDENT_RESPONSE.md`, closing the
  `docs/PRODUCTION_READINESS.md` §19 documentation gap): severity levels
  (SEV-1..4) with concrete examples from this app, a single-person/small-team
  role breakdown, current detection surfaces (`GET /api/health`, structured
  logs, `AuditLog`, support tickets — pending real error-tracking/alerting
  per §4/§6), a first-response checklist, a dedicated money/wallet-incident
  section (never hand-edit `Wallet.balance`; replay the real service
  function; reconcile before compensating), scenario playbooks (site down,
  orders stuck, deposits not crediting — correcting for this app's actual
  manual-approval deposit flow rather than assuming a payment webhook,
  security incident, Telegram bot unresponsive), a backup/restore reference
  tied to the still-untested Atlas restore procedure (§13), communication
  templates, and a postmortem template. Linked from `README.md`'s doc index
  and `docs/PRODUCTION_READINESS.md` §19 (now marked ✅ Done for the
  runbook itself, with the pre-existing alerting/backup-testing gaps called
  out as still open). Also preceded by a fresh full-codebase Code Review +
  Security Review sweep (not diff-scoped) covering auth/role checks on every
  `/api/admin/*` route, IDOR/ownership scoping on every user-facing `[id]`
  route, the `/api/v2` reseller endpoint's authorization model, secret
  hygiene, and common code-smell patterns — zero new findings, confirming
  the existing codebase's security posture.
- **Bulk actions on Orders/Users/Payments admin tables**
  (`docs/DASHBOARD_UPGRADE_PLAN.md` §2.3, the last item on that plan's
  backlog — delivered following the full ECC pipeline documented in
  `docs/ECC_SETUP.md`, plan at `.claude/plans/admin-bulk-actions.plan.md`):
  row checkboxes + "select all on page" on all three tables. Orders: new
  `PATCH /api/admin/orders/bulk` + `lib/services/admin-bulk.ts` support
  bulk status change restricted to `CANCELED`/`FAILED` only (enforced at
  both the zod schema and service layer — `REFUNDED`/`COMPLETED` remain
  single-item, individually-reviewed actions to protect the wallet-crediting
  refund transaction and the refill-eligibility `completedAt` anchor), plus
  a client-side "Export selected CSV" reusing the existing `lib/csv.ts`.
  Payments bulk-approve and Users bulk-status-change compose the existing
  single-item routes via a client-side `Promise.allSettled` loop —
  deliberately no new bulk-transaction code path touches `approveDeposit()`.
  New `ORDER_BULK_STATUS_CHANGE` audit action (13 new unit + integration
  tests). A Security Review pass caught and fixed an information-disclosure
  finding: a malformed order id previously surfaced a raw Mongoose
  `CastError` message (with internal schema/model details) to API clients;
  now sanitized to a generic message, matching the project's existing
  single-item route convention, while the real error is still logged
  server-side.
- **Advanced filters & search on admin tables** (`docs/DASHBOARD_UPGRADE_PLAN.md`
  §2.4): shared `AdminFilterBar` (text search, status multi-select pills,
  date range) and `AdminPagination` components, all URL-query-string
  persisted, reused across `/admin/orders`, `/admin/users`,
  `/admin/payments`, `/admin/support`. New shared `lib/admin-query.ts`
  parses `page`/`limit`/`status`/`search`/`from`/`to` identically on both
  the server-component pages and their backing `/api/admin/*` routes
  (19 new unit tests).
- **Financial reports & CSV export** (`docs/DASHBOARD_UPGRADE_PLAN.md`
  §2.5): new `/admin/reports` page (custom date-range revenue/orders/
  refunds/deposits summary, backed by a new `getFinancialReportRows()` in
  `lib/services/analytics.ts`) plus three new CSV export routes —
  `GET /api/admin/export/{orders|payments|transactions}` — via a new
  generic, OWASP-formula-injection-safe `lib/csv.ts` (11 new unit tests).
  New `DATA_EXPORTED` audit action.
- **Provider health monitoring** (`docs/DASHBOARD_UPGRADE_PLAN.md` §2.6):
  new `ProviderHealthPanel` on `/admin/providers` surfacing per-provider
  24h dispatch count, cached balance with a stale-after-24h warning, and
  the most recent fulfillment error — wires up the previously-unused
  `getProviderHealthSummary()` aggregation from an earlier session.
- **Admin command palette** (`docs/DASHBOARD_UPGRADE_PLAN.md` §2.7):
  Ctrl/Cmd+K quick-open across the whole admin panel (plus a visible
  "Quick search" header button) to jump to any admin section or a
  specific order/user/payment by id/email/target/reference, backed by a
  new `GET /api/admin/search` route.
- **Profile & security settings page** (`/dashboard/settings`,
  `docs/DASHBOARD_UPGRADE_PLAN.md` §3.3): edit display name
  (`PATCH /api/account`), change password with current-password
  re-verification (`POST /api/account/change-password`, reuses the same
  strength rules as registration), and a read-only account-info panel
  surfacing `lastLoginAt`/`lastLoginIp` and Telegram-link status — all
  previously invisible in the UI despite already being stored. New
  `ACCOUNT_UPDATED`/`PASSWORD_CHANGED_BY_USER` audit actions.
- **Saved/favorite services** (`docs/DASHBOARD_UPGRADE_PLAN.md` §3.6): a
  star toggle on the order-placement service selector
  (`/dashboard/services`), backed by a new `favoriteServiceIds` array on
  `User` and `GET/POST/DELETE /api/favorites`. Favorited services sort to
  the top of the service dropdown. New `FAVORITE_SERVICE_ADDED`/
  `FAVORITE_SERVICE_REMOVED` audit actions. Both this and the settings
  page above are fully localized (`en`/`bn`) and covered by 5 new
  route-auth-boundary unit tests (135 → 140 total).
- Structured logging via Pino (`lib/logger.ts`), replacing every
  `console.log`/`console.error`/`console.warn` call site across
  `app/api/**`, `lib/**` (excluding `lib/__tests__/**`), and
  `lib/telegram/**` (`scripts/**` deliberately left as plain `console.*`
  — see `lib/logger.ts`'s doc comment). Emits newline-delimited JSON in
  production (what every log aggregator expects) and human-readable
  `pino-pretty` output in development; a per-request correlation id
  (`reqId`, generated once in `proxy.ts` via the new
  `lib/security/request-id.ts`) is threaded onto every log line a route
  handler emits (via `requestLogger(request)`) and returned to the
  browser as a response header, so a user-reported error can be
  correlated against server-side logs. Redacts common secret-shaped
  fields (`password`, `authorization`, cookies, `apiKey`, `token`)
  defensively. Closes `docs/PRODUCTION_READINESS.md` §3 — see that
  section for the full design writeup and a real bug this change's own
  verification found and fixed (below).

### Fixed
- **`/admin/orders` and `/admin/payments` logged a React dev-mode "Only
  plain objects can be passed to Client Components" warning on every
  render** (pre-existing since the original commit, found during the
  §2.4/2.5/2.6/2.7 verification pass) — populated Mongoose sub-documents
  (`.lean()` does not deep-plain-ify populated refs, so `_id` remained a
  real `ObjectId` with a `toJSON` method) were passed straight through as
  props into `OrdersTable`/`PaymentsTable`. Fixed by explicitly plucking
  only the rendered fields into new plain objects before mapping into the
  row shape.
- **`proxy.ts` 500'd every request in a real production server** (i.e.
  exactly what the Playwright e2e suite exercises, unlike `next dev`) —
  introduced by an early draft of the logging change's request-id
  threading, and caught before merge by the project's own e2e suite,
  not shipped. Root cause: `withHeaders()` was called twice against the
  *same original* incoming `NextRequest` (once for the request-id
  header, again independently for the CSP nonce header); constructing a
  `NextRequest` from another `Request` consumes that instance's body
  stream, so the second construction from the same already-consumed
  original threw `TypeError: Cannot construct a Request with a Request
  object that has already been used.` Fixed by chaining the second
  `withHeaders()` call off the already-rewrapped request instead of the
  original. Full verification gate (tsc, lint, 135/135 unit tests,
  22/22 integration tests, production build, all 8 e2e specs) green
  after the fix.
- End-to-end test suite (`@playwright/test`, `playwright.config.ts`,
  `e2e/*.e2e.ts`, 8 tests): drives a real, headless Chromium browser
  against the actual, already-built production server (`next start`) and
  a real, ephemeral MongoDB replica set. Covers the two highest-value
  happy paths — `auth.e2e.ts` (register → login → follow the real
  verification link from the server's dev-mode no-SMTP console-log
  fallback → verify; wrong-password rejection) and `order-flow.e2e.ts`
  (deposit submission → admin approval via the real UI, including its
  native `confirm()` dialog → wallet credited; funded-customer order
  placement → appears in order history) — driving the real UI end-to-end
  rather than calling service functions directly, complementing (not
  duplicating) the existing integration suite. Run via `npm run test:e2e`
  (builds first, then runs Playwright) or `npx playwright test` against an
  existing build. Wired into CI as a new step after the build job. Closes
  item 4 (the last item) of `docs/PRODUCTION_READINESS.md` §15's
  remaining-work list — see that section for two real bugs found and
  fixed while building this suite (a database-name mismatch between the
  suite's seed connection and the app's own connection, and an orphaned
  `next-server` process surviving cleanup when spawned via `npm run
  start` instead of the `next` binary directly).
- Route-handler auth/authorization boundary test suite
  (`lib/__tests__/api-auth-boundary.test.ts`, 61 tests): imports every real
  route module under `app/api/**` (44 files) and exercises their actual
  auth/role/ownership gates with `@/auth`'s session mocked — unauthenticated
  → 401 (19 session-gated routes) or 403 (30 admin-only routes, matching
  this project's deliberate combined session+role check), wrong-role → 403
  (sampled), an admin session passing the gate itself, support-ticket
  ownership rejection, and a regression guard confirming the 6 intentionally
  public/differently-authed routes never call the session-based `auth()`.
  Closes item 3 of `docs/PRODUCTION_READINESS.md` §15's remaining-work list.
- Unit test suite for the login/credentials-authorization logic
  (`lib/__tests__/auth-authorize.test.ts`, 11 tests), covering malformed
  input, unknown accounts, wrong-password + failed-attempt tracking, the
  5-failure account lockout and its rejection window, non-`ACTIVE`-account
  rejection, successful login, and (against the real, unmocked
  `lib/rate-limit.ts`) the IP-based login rate limit itself — both that it
  rejects the attempt past the configured per-IP limit and that a
  different IP is unaffected.

### Fixed
- **Login had no IP-based rate limiting at all**, despite `lib/rate-limit.ts`
  already defining a `login` config entry — every other sensitive action
  (register, password reset, order creation, payment submission, etc.)
  called `rateLimit(...)`, but the Credentials provider's `authorize()` in
  `auth.ts` never did, meaning a single IP could attempt unlimited logins
  across unlimited accounts (credential stuffing) with no throttling; the
  pre-existing per-account lockout only stops repeated failures against
  one specific account, not high-volume attempts spread across many
  accounts. Fixed by extracting the provider's logic into a directly
  unit-testable `authorizeCredentials()` (`lib/auth/authorize.ts`) and
  calling `rateLimit("login", ip)` at its entry point.
- **Tuned the new login rate limit after it broke a legitimate use case**:
  the initial, textbook-reasonable `[5, 60]` (5 attempts/60s per IP) value
  caused the real Playwright e2e suite (`e2e/order-flow.e2e.ts`) to fail,
  because that suite legitimately logs in as three different seeded
  accounts from one IP within one run — a realistic stand-in for
  legitimate shared-IP traffic (office/university NAT, a household, a VPN
  exit node). Since per-account lockout already handles single-account
  brute force independently, the IP-level limit only needs to catch
  high-volume multi-account credential-stuffing floods and can afford
  much more headroom; raised to `[20, 300]` (20 attempts per 5 minutes per
  IP) in `lib/rate-limit.ts`, with unit tests updated to match (including
  explicit per-test timeouts, since looping 20+ real bcrypt cost-12
  compares exceeds Vitest's 5s default). Full unit, integration, and e2e
  suites re-verified green after the change. See
  `docs/PRODUCTION_READINESS.md` §12 for the full rationale.

## [0.1.0] — 2026-09-09

Initial tracked release — git history begins here. Everything below was
already built prior to this version number meaning anything; this entry
exists to give the `0.1.0` tag a concrete, dated feature snapshot rather
than an arbitrary starting point.

### Added
- Core platform: user auth (Auth.js v5, credentials + bcrypt, account
  lockout), wallet/order/deposit/refund transactional core with
  Decimal128 money math and optimistic-concurrency wallet updates.
- Three customer-facing entry surfaces sharing the same `lib/services/*`
  business logic: the Next.js website, a Telegram bot (grammY), and a
  reseller HTTP API (`/api/v2`) with per-key auth and independent rate
  limits.
- Admin panel: analytics dashboards, audit log, order/payment/provider/
  user/support management, in-app notifications.
- Customer dashboard: orders (with refill requests), wallet, services
  catalog, support tickets, API key self-service, in-app notifications.
- Multi-provider fulfillment with per-service priority fallback,
  automatic partial-delivery refunds, and self-service order refills.
- i18n (`next-intl`), public service catalog, `ServiceGroup` taxonomy.
- Security: CSP (nonce + `strict-dynamic`), full HTTP security header
  set, cross-origin enforcement for `/api/**`, rate limiting on every
  sensitive action, encrypted-at-rest provider secrets, Telegram webhook
  signature verification.
- Testing: unit suite (`vitest`, pure logic in `lib/**`) and a DB-backed
  integration suite (`mongodb-memory-server`) exercising the real
  transactional order/deposit/refund service functions, including
  concurrency-race tests for every optimistic-locking guard.
- CI (`.github/workflows/ci.yml`): typecheck, lint, `npm audit`, unit
  tests, integration tests, production build — all required on every
  push/PR to `main`.
- Dependabot config for npm and GitHub Actions dependency updates.
- Everything Claude Code (ECC) v2.2.1 vendored into `.claude/` (68
  agents, 286 skills, 94 commands) via the official installer — see
  `docs/ECC_SETUP.md`.
- Extensive documentation: `docs/ARCHITECTURE.md`, `docs/API.md`,
  `docs/DATABASE.md`, `docs/PRODUCTION_READINESS.md`,
  `docs/COMPETITIVE_ANALYSIS_AND_ROADMAP.md`,
  `docs/IMPLEMENTATION_PLAN.md`, `docs/I18N_PLAN.md`,
  `docs/DASHBOARD_UPGRADE_PLAN.md`, `docs/WORKFLOWS.md`.

### Fixed
- `approveDeposit`/`rejectDeposit` (`lib/services/admin-payments.ts`)
  returned a stale, pre-update `Payment` document (still showing
  `status: "PENDING"`) immediately after a successful approval/rejection,
  even though the database itself was correctly updated. Found while
  writing the new integration test suite. The admin approve/reject API
  routes and the Telegram bot's equivalent inline-button handlers both
  consume this return value directly, so this meant an admin's own
  immediate UI feedback after clicking Approve/Reject could incorrectly
  show the payment as still pending. Fixed by mutating the in-memory
  document to match what was actually persisted, reusing the same
  `reviewedAt` timestamp for both the DB write and the in-memory patch.
