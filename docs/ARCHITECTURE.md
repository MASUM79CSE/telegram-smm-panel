# Architecture

This document describes how the system is structured internally: layers, module boundaries, request/data flow, auth, background processing, error handling, and the key design decisions behind them.

For setup/run instructions see [`../README.md`](../README.md). For schema detail see [`DATABASE.md`](DATABASE.md). For step-by-step request lifecycles see [`WORKFLOWS.md`](WORKFLOWS.md).

## 1. Deployment Topology

This is a **single Next.js application** (App Router) that serves four logical surfaces from one codebase and one deployable artifact:

1. **Customer-facing web app** (`app/(no group)`, `app/dashboard/**`) — server-rendered React pages.
2. **Admin web app** (`app/admin/**`) — same app, gated by `role === "ADMIN"`.
3. **Telegram bot** — driven by an inbound webhook route (`app/api/telegram/webhook/route.ts`) in production, or a standalone long-polling process (`scripts/run-bot-polling.ts`) for local/sandboxed development.
4. **Reseller API** (`POST /api/v2`, shipped in Phase 2.2 of [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md)) — a stateless, API-key-authenticated HTTP endpoint for third-party resellers, documented in full in [`API.md`](API.md). No session/cookie auth, no UI of its own beyond the key-management page at `/dashboard/api-keys`.

Additionally, there is **one required separate long-running process**, outside the Next.js server: `scripts/process-orders.ts`, a background worker. It is not part of request/response handling — see §6.

```
                     ┌───────────────────────────────┐
 Browser  ─HTTPS──▶  │        Next.js server          │
                     │  (pages + /api/* route handlers)│ ──▶ Supabase (PostgreSQL,
 Telegram ─Webhook─▶ │  (also mounts the bot at        │      pooled connection)
   servers            │   /api/telegram/webhook)        │
                     └───────────────────────────────┘
                                    ▲
                                    │ shares the same cached Prisma
                                    │ Client instance (module cache)
                     ┌───────────────────────────────┐
                     │ scripts/process-orders.ts       │ ──▶ Supabase (PostgreSQL,
                     │ (separate OS process, --loop)   │      same project)
                     └───────────────────────────────┘
```

Why one codebase for web + bot instead of two services: the money-moving logic (wallet debits/credits, order creation, deposit approval) must behave **identically** regardless of which surface triggered it. Colocating them lets both surfaces call the exact same `lib/services/*` functions rather than reimplementing (and risking divergent) business rules over an internal API.

## 2. Layers & Module Boundaries

```
app/                    Presentation layer: React Server Components (pages) +
                        Route Handlers (app/api/**/route.ts, thin HTTP adapters)
  └── calls ──▶
components/             Client-side interactive UI (forms, tables); no direct
                        DB access — always goes through app/api/* fetch calls
lib/services/*          Business/domain logic layer — the ONLY place that
                        performs multi-step, transactional operations
                        (place an order, approve a deposit, refund an order,
                        create a support ticket, link a Telegram account).
                        Used identically by app/api/* routes AND lib/telegram/bot.ts.
  └── calls ──▶
prisma/schema.prisma    Data access layer — a single Prisma schema file
                        declaring every table/model, replacing the original
                        one-Mongoose-model-per-file convention. No business
                        rules here beyond schema-level validation/defaults
                        (required fields, enums, `@db.Decimal` precision,
                        real foreign-key constraints — see DATABASE.md §4).
  └── uses ──▶
lib/db.ts               Connection layer — cached Prisma Client instance
                        (`global.prisma`, survives hot reloads/serverless
                        invocations), generated into lib/generated/prisma.
```

Supporting cross-cutting modules (used from any layer above):

- `lib/env.ts` — validated environment config (Zod), fail-fast at startup.
- `lib/errors.ts` — `AppError` (code + message) used by the service layer so both the HTTP routes and the bot can map the same error to their own presentation (HTTP status/JSON vs. a chat message) without duplicating validation logic.
- `lib/money.ts` — fixed-point (Prisma `Decimal`, backed by `decimal.js`) arithmetic helpers for all monetary math; deliberately avoids floating point.
- `lib/crypto.ts` — AES-256-GCM encrypt/decrypt for provider API keys at rest, SHA-256 token hashing for email-verification/password-reset/Telegram-link tokens.
- `lib/audit.ts` — best-effort, non-throwing audit-log writer for sensitive/admin actions.
- `lib/rate-limit.ts` — named rate-limit buckets (login, register, orderCreate, etc.), Upstash Redis-backed with an in-memory fallback.
- `lib/validation.ts` — Zod schemas for request bodies (registration, login, orders, services, categories, etc.), shared between route handlers and (where applicable) the bot's conversation input parsing.
- `lib/telegram/*` — bot-specific: `client.ts` (lazy singleton `Bot` instance + session storage), `bot.ts` (command/conversation handlers), `notify.ts` (outbound notifications to admin/users), `format.ts` (HTML-escaping for Telegram messages), `types.ts` (bot context typing).

**Why a `lib/services` layer instead of putting logic directly in route handlers:** it is the single place where the Telegram bot and the website converge, so the same Postgres transaction/validation runs no matter which surface a user acted from. It also keeps route handlers as thin HTTP-protocol adapters (auth check → rate limit → parse input → call service → map result/errors to a response).

## 3. Authentication & Authorization Flow

- **Library:** Auth.js (NextAuth) v5, **Credentials provider only** (email + password) — no OAuth providers are wired up.
- **Session strategy:** JWT (not database-backed sessions), 30-day max age (`auth.config.ts`).
- **Password checks:** `bcryptjs`, cost factor 12. Failed-login tracking with a 5-attempt threshold triggering a 15-minute lockout (`auth.ts`), stored on the `User` document (`failedLoginAttempts`, `lockedUntil`). A dummy `compare()` call runs even when no user is found, to reduce timing-based user-enumeration signal.
- **Route protection:** `proxy.ts` (Next.js 16's renamed `middleware.ts`) wraps every request through `authConfig.callbacks.authorized`, which:
  - requires a valid session for any `/dashboard/*` path;
  - requires a valid session **and** `role === "ADMIN"` for any `/admin/*` path;
  - allows everything else through unauthenticated.
- **Split config rationale:** `auth.config.ts` contains only Edge-safe logic (no bcrypt/Prisma imports) so `proxy.ts` can run without pulling in Node-only APIs; `auth.ts` extends it with the actual `Credentials` provider (which does need bcrypt + Prisma) and is only imported by server-side code (route handlers, server components) — never by `proxy.ts`.
- **API route auth:** each `app/api/**/route.ts` handler calls `auth()` itself and checks `session.user.id` (and `role` for admin-only routes) — proxy-level protection covers *pages*, but API routes re-check independently since they can be called directly.
- **Telegram bot auth:** the bot has no separate login. A logged-in web user generates a short-lived, single-use link code from the dashboard (`createTelegramLinkCode`), sends `/link CODE` to the bot, and the bot associates `telegramId` with that `User` document (`linkTelegramAccount`). All subsequent bot actions look up the caller by `telegramId` (`getLinkedUser` in `lib/telegram/bot.ts`) — there is no separate credential for the bot surface.
- **Reseller API-key auth:** `POST /api/v2` has neither a session cookie nor a Telegram identity — it authenticates purely via a per-user `ApiKey` (raw value supplied as a `key` body field or an `X-Api-Key` header, hashed and looked up via `resolveApiKey()` in `lib/services/api-keys.ts`; see [`API.md`](API.md) for the full contract and `DATABASE.md` for the schema). A resolved key's `userId` is treated exactly like an authenticated session's user for every downstream service call (`placeOrder`, `refundOrder`, wallet reads), and every response is additionally scoped by `{_id, userId}` so one key can never observe or affect another user's data — live-verified with two separate real accounts during Phase 2.2. Rate limiting for this surface is keyed by the API key's id (`lib/rate-limit.ts`'s `apiV2` config), not by IP, since a single reseller server is expected to make many rapid calls from one IP.
- **Deliberately public routes:** `/services` (page) and `GET /api/public/services` (its data source) are the first genuinely public, unauthenticated, data-serving surfaces in this project (shipped in Phase 1.2 of [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md)). They fall outside `/dashboard/*` and `/admin/*`, so `authConfig.callbacks.authorized` passes them through unauthenticated by default — this is intentional, not an oversight (verified by reading that callback before building the route). Both share their DB query and customer-safe field projection via `lib/services/catalog.ts#getPublicCatalog()` (excludes `providerId`/`providerServiceId`/`providerRate`), which the authenticated `/api/services` route also now calls, so the exclusion list only needs to be maintained in one place. `GET /api/public/services` is left subject to the default same-origin policy in `lib/security/origin.ts` (not added to its exemption list) since there's no current cross-origin use case (e.g. an embeddable widget) — revisit explicitly if one appears. It returns `Cache-Control: public, max-age=60, stale-while-revalidate=300` rather than `no-store`: chosen because this project has no CDN/edge cache layer in front of it yet, so a short server-side-friendly cache window reduces DB load from repeated public catalog views without meaningfully staling prices; revisit this choice if/when a CDN is introduced in front of the app.

## 4. Request / Data Flow (representative: placing an order)

```
Web:      Browser → POST /api/orders → auth() check → rate limit
                   → Zod validate body → placeOrder() [lib/services/orders.ts]
Bot:      Telegram → webhook → grammY conversation → requireLinked() check
                   → rate limit → placeOrder() [same function, same file]
Reseller: HTTP client → POST /api/v2 (action=add) → resolveApiKey() check
                   → rate limit (per-key) → placeOrder() [same function, same file]

placeOrder():
  1. Validate user.status === "ACTIVE"
  2. Load the active Service, validate quantity within [min,max]
  3. Compute charge = rate * quantity / 1000 (lib/money.ts, Decimal-safe)
  4. prisma.$transaction(async (tx) => { ... }):
       a. Load Wallet, check balance >= charge
       b. Optimistic-concurrency update: tx.wallet.updateMany({where: {id, version: N}, data: {balance, version: {increment: 1}}})
          — if result.count !== 1, another concurrent write already changed
            the wallet; abort with CONCURRENT_MODIFICATION (caller can retry)
       c. Create Order (status PENDING) and a matching Transaction (ledger row)
          atomically, in the same transaction as the wallet debit
  5. Outside the transaction (fire-and-forget, does not block the response):
       - dispatchOrderToProvider(orderId) — first fulfillment attempt
       - notifyOrderPlaced(order) — admin Telegram alert
  6. Return the created Order to the caller (HTTP JSON or a bot chat message)
```

This same "shared service function, transactional core, fire-and-forget side effects" pattern applies to deposit approval (`approveDeposit`), order refund (`refundOrder`), and ticket creation/reply. See [`WORKFLOWS.md`](WORKFLOWS.md) for the full set with sequence-level detail and edge cases.

**Why side effects (dispatch, notifications) run outside the transaction and are fire-and-forget:** a slow/failed Telegram API call or upstream provider call must never roll back a wallet debit that already succeeded, and must never make the customer's HTTP request hang waiting on a third party. Errors from these are caught and logged (`.catch(console.error)`); the order itself is never lost because it starts in `PENDING`/`PROCESSING` and the background processor (`scripts/process-orders.ts`) retries it independently.

## 5. Fulfillment Dispatch

`lib/fulfillment.ts` — `dispatchOrderToProvider(orderId)` — is the single function that attempts to move an order forward. Each candidate provider it tries has one of three `Provider.type` values:

- **`MANUAL`** — no automated call is made; an admin fulfills the order by hand and manually changes its status via the admin dashboard/bot.
- **`INTERNAL`** — fulfilled by this platform's own bot/automation that the operator directly controls and is authorized to run.
- **`API`** — calls an upstream SMM-panel-style HTTP API (`action=add` contract, matching the common convention used by that class of reseller APIs) with a 15-second timeout (`AbortController`), decrypting the stored provider API key via `lib/crypto.ts` just before the call (never held decrypted longer than needed, never logged).

**Multi-provider fallback (added [`IMPLEMENTATION_PLAN.md` Phase 2.1](IMPLEMENTATION_PLAN.md)):** a `Service` can be linked to multiple `Provider`s via the `ServiceProvider` model, each with a `priority` (lower tried first). `dispatchOrderToProvider` resolves the ordered candidate list (`ServiceProvider` rows if any exist for the service, else falling back to the service's legacy single-provider fields) and tries each **within the same dispatch attempt**: if the highest-priority provider's call fails, the next is tried immediately, rather than waiting for the next scheduled worker pass against the same broken provider. `order.statusHistory` records which provider ultimately succeeded and lists every provider that failed first in that attempt (e.g. `"...provider: Test Provider A) (after 1 earlier provider failure(s) this attempt: Test Provider B: fetch failed)"`), so the audit trail isn't lost on eventual success. See [`DATABASE.md` §2](DATABASE.md#2-collections-entities--responsibilities) for the schema.

**Resilience design:** any error during a candidate's dispatch attempt (network failure, non-2xx response, timeout) is caught and recorded; if every candidate for an order fails, the order is **left in `PROCESSING`** (with `lastError` set to the joined failure reasons) rather than marked `FAILED` — this makes it a candidate for retry by the background processor on its next pass, up to `MAX_ATTEMPTS` (5). This is a deliberate "never silently lose money-backed state" decision: a customer has already been charged, so the system must keep trying rather than dropping the order.

**`PROCESSING` is overloaded, and the retry guard has to account for that:** an order reaches `PROCESSING` either because (a) it was successfully handed off to a `MANUAL` provider and is now awaiting a human (`lastError: null`), or (b) every candidate provider failed this attempt and it's awaiting the next scheduled retry (`lastError` set to the failure reasons). `dispatchOrderToProvider`'s entry guard distinguishes these: a fresh `PENDING` order or a `PROCESSING` order with a non-null `lastError` is retry-eligible; a `PROCESSING` order with `lastError: null` is left alone. **This distinction was itself a bug fix during Phase 2.1's live verification** — the original guard only accepted `status === "PENDING"`, which meant `scripts/process-orders.ts`'s candidate query (`status IN (PENDING, PROCESSING)`) was silently selecting failed orders that this function then did nothing with; no order that failed dispatch even once was ever actually retried by the worker, despite `MAX_ATTEMPTS` implying otherwise. Verified live (see `docs/IMPLEMENTATION_PLAN.md` §2.1 for the full before/after reproduction) before writing this paragraph.

## 6. Background Processing

There is **no message queue** (no SQS/BullMQ/etc.) — the "queue" is the `Order` collection itself, polled by `scripts/process-orders.ts`:

- Selects up to `BATCH_SIZE` (25) orders where `status IN (PENDING, PROCESSING)` and `attempts < MAX_ATTEMPTS` (5), oldest first, handing each to `dispatchOrderToProvider` which itself decides (via the `PROCESSING`+`lastError` distinction described above) whether an order is actually retry-eligible. **This query previously also filtered `providerId IS NOT NULL`** — removed during Phase 2.1, since `Order.providerId` is only set once a dispatch attempt *succeeds*, so that filter permanently excluded any order whose service is configured purely via `ServiceProvider` links (no legacy `Service.providerId`) and whose first attempt failed. See [`IMPLEMENTATION_PLAN.md` §2.1](IMPLEMENTATION_PLAN.md) for the live reproduction/fix.
- Calls `dispatchOrderToProvider()` for each, sequentially, catching and logging per-order errors so one bad order doesn't stop the batch.
- Runs once and exits (`npm run process-orders`) or loops every 30 seconds (`npm run process-orders -- --loop`).

This process **must run continuously in production**, independently of the web server (systemd/pm2/Docker service, or a scheduled job). Without it, orders with an `API`/`INTERNAL` provider will sit in `PENDING` indefinitely — see the [production readiness doc](PRODUCTION_READINESS.md) for deployment guidance and the honest caveat that this is a simple polling worker, not a fault-tolerant distributed queue (no visibility timeout, no dead-letter queue, no horizontal fan-out beyond running one instance).

**Dual invocation path (docs/PRODUCTION_READINESS.md §14):** the actual dispatch/poll/estimate logic for all three workers described in this section now lives in `lib/services/jobs.ts` (`runProcessOrdersJob`/`runPollOrderStatusJob`/`runComputeDeliveryEstimatesJob`), extracted so it's reachable two ways with byte-identical behavior:
1. The CLI scripts described below (`npm run process-orders`, etc.) — unchanged usage/output, for any deployment that runs a real long-lived process (systemd/pm2/Docker).
2. Authenticated `GET /api/cron/process-orders` / `/api/cron/poll-order-status` / `/api/cron/compute-delivery-estimates` routes — for a serverless deployment (this project's chosen target, Vercel) that cannot run a long-lived process at all. Auth is a `CRON_SECRET` shared secret (`lib/security/cron-auth.ts`, `timingSafeEqual`-compared, same shape as `TELEGRAM_WEBHOOK_SECRET`), invoked on a schedule by `.github/workflows/cron.yml` (GitHub Actions, chosen over Vercel's own native Cron Jobs since those require a paid Pro plan for anything more frequent than once/day — see `PRODUCTION_READINESS.md` §14 for the full trade-off). Both invocation paths are safe to run concurrently/overlapping with themselves, since each job re-queries "what's eligible right now" from the DB rather than holding in-process state between calls.

**Two more scheduled workers were added in Phase 3, following the exact same "separate OS process, run continuously or via cron" pattern:**

- **`scripts/poll-order-status.ts`** (Phase 3.2) — the prerequisite gap flagged in `docs/IMPLEMENTATION_PLAN.md` §3.2 before that phase started: `process-orders.ts` only ever dispatches new orders, it never re-checks an order already handed off to a provider. This worker selects `IN_PROGRESS` orders with an API-type provider not checked in the last 2 minutes (`lastStatusCheckAt`), calls `lib/fulfillment.ts#pollOrderStatus()` for each, which itself calls the provider's own `status` action and reconciles: `"Completed"` → transitions the order to `COMPLETED` via the same `changeOrderStatus()` used by admin actions (so `completedAt` is set identically regardless of which path completes an order — this is the anchor for Phase 3.1's refill-eligibility window, so it must be set consistently); `"Partial"` with a nonzero `remains` → calls `lib/services/refunds.ts#issuePartialRefund()`, which follows the same atomic-transaction + `Wallet.version` pattern as every other money-moving function in this codebase and is idempotency-guarded on `Order.partialRefundIssuedAt` so a retried/overlapping poll can never double-refund. Deliberately a *separate* script from `process-orders.ts` rather than folded in — dispatch and status-polling have different natural cadences and independent failure blast radii. Run via `npm run poll-order-status -- --loop`.
- **`scripts/compute-delivery-estimates.ts`** (Phase 3.3) — computes each `Service`'s median order-creation-to-`COMPLETED` time (from its most recent 50 completed orders; median rather than mean, since delivery times are typically right-skewed by occasional slow outliers) and caches the result on `Service.estimatedDeliveryMinutes`, displayed on the catalog UI as e.g. "~45 min." Deliberately precomputed on a schedule rather than calculated live per catalog request, the same reasoning as `getCheapestServices()`'s existing caching-friendly design (see §9). Run via `npm run compute-delivery-estimates -- --loop` (hourly).

There is a fourth scheduled job alongside these three workers: `scripts/cleanup-expired-tokens.ts` (`npm run cleanup-expired-tokens`, or `GET /api/cron/cleanup-expired-tokens` for the serverless invocation path), which deletes expired `VerificationToken` rows past a short retention grace period. Postgres has no native TTL-index mechanism equivalent to MongoDB's (which the original design relied on to self-expire these rows with zero application code); this explicit job replaces it — see [`DATABASE.md` §7](DATABASE.md#7-data-lifecycle-retention-and-cleanup) for the full reasoning.

## 7. Telegram Bot Integration Detail

- **Library:** grammY, with `@grammyjs/conversations` for multi-step flows (e.g. `/order` walks category → service → target → quantity) and a small custom Prisma-backed session storage adapter (`lib/telegram/client.ts`'s `prismaStorageAdapter`, implementing grammY's `StorageAdapter` interface against the `TelegramBotSession` table) for session persistence — replacing `@grammyjs/storage-mongodb`, since no first-party grammY Postgres/Prisma storage adapter exists. Same database, same connection pool — no second database.
- **Two run modes:**
  - **Webhook** (production): Telegram POSTs updates to `app/api/telegram/webhook/route.ts`, which verifies `X-Telegram-Bot-Api-Secret-Token` against `TELEGRAM_WEBHOOK_SECRET` (via grammY's `webhookCallback`) before processing. Registered once via `npm run telegram:webhook -- <url>`.
  - **Long polling** (local/sandbox dev): `scripts/run-bot-polling.ts` calls `bot.start()` directly — no public URL needed, but does not scale across multiple instances and keeps an open connection, so it's explicitly documented as dev-only.
- **Lazy singleton bot instance:** `lib/telegram/client.ts#getBot()` constructs the `Bot` at most once per server process (module-level cache) and returns `null` if `TELEGRAM_BOT_TOKEN` isn't set, so every caller can no-op instead of crashing when the bot isn't configured — the bot integration is fully optional.
- **Outbound notifications** (`lib/telegram/notify.ts`) are cross-cutting: both the website's route handlers and the bot's own conversations call the same `notifyAdminNewDeposit`/`notifyOrderPlaced`/etc. functions, so an admin gets the same alert whether an event originated from the web or the bot. All notification functions are best-effort and must never throw — a failed Telegram send must never break the underlying business operation.
- **HTML injection defense:** all user-controlled strings interpolated into Telegram messages (order targets, ticket subjects, rejection reasons) are passed through `escapeHtml()` before being sent with `parse_mode: "HTML"`.

## 8. Error Handling Strategy

- **Domain errors:** `AppError` (`code`, `message`) thrown by the service layer. Each HTTP route maps known `AppError.code` values to specific status codes (e.g. `INSUFFICIENT_BALANCE` → 400, `CONCURRENT_MODIFICATION` → 409, `NOT_FOUND` → 404) via a local `errorStatusMap`; unmapped codes default to 400. The bot instead renders `error.message` directly as a chat reply.
- **Unexpected errors:** every route handler wraps its body in try/catch, logs the error server-side (`console.error`), and returns a generic `{ error: "Internal server error" }` with **status 500** — internal details are never leaked to the client.
- **Transactional safety:** any error thrown inside a `prisma.$transaction(async (tx) => ...)` callback aborts the entire transaction (standard Postgres rollback semantics) — partial state changes (e.g. a wallet debit without a matching order) cannot occur.
- **Notification/audit failures never propagate:** `notify*()` and `recordAudit()` calls are either awaited-and-caught or deliberately fire-and-forget with `.catch(console.error)` — a broken email/Telegram/audit path must never block or fail the primary user-facing operation.
- **Structured logging** (`lib/logger.ts`, Pino-based) and **error tracking / performance monitoring** (`@sentry/nextjs`, all three Next.js runtimes) are both wired up — see [`PRODUCTION_READINESS.md` §3](PRODUCTION_READINESS.md#3-logging-strategy--log-levels) and [§4](PRODUCTION_READINESS.md#4-error-tracking)/[§6](PRODUCTION_READINESS.md#6-metrics--alerting) for the exact mechanism and what still needs a Sentry project/DSN to actually activate (both are safe no-ops until configured).

## 9. Scalability & Performance Considerations

- **Stateless web tier:** the Next.js app holds no meaningful in-process state other than the cached Prisma Client instance and (fallback-only) in-memory rate-limit counters — it can run as multiple horizontally-scaled instances, **except** that the in-memory rate-limit fallback and long-polling bot mode do not work correctly across multiple instances (use Upstash Redis + webhook mode in any multi-instance deployment).
- **Connection pooling:** `lib/db.ts` caches the Prisma Client instance across serverless invocations/hot reloads (`global.prisma`); the actual connection pooling happens at the Postgres level via Supabase's pooled `DATABASE_URL` (Supavisor in transaction mode, port `6543`), not a client-side `maxPoolSize` setting — see [`DATABASE.md` §10](DATABASE.md#10-performance--scalability-notes) for why this distinction matters for a serverless deployment and what breaks if `DATABASE_URL` is accidentally set to the non-pooled direct connection string instead.
- **Pagination:** list endpoints (orders, wallet transactions) accept `page`/`limit` query params, capped at `limit <= 50`.
- **Indexing:** see [`DATABASE.md` §5](DATABASE.md#5-indexing-strategy) for the full index list backing common query patterns (user's orders by recency, pending payments, etc.).
- **Known scaling limits (honest, current-state):** the order-processing "queue" is a single-consumer polling script/endpoint — running more than one instance/invocation of it concurrently is not safe against double-dispatch coordination in the general case (it has no distributed lock); today it's designed to run as effectively one active worker at a time. This is unchanged by the serverless `GET /api/cron/*` invocation path (`docs/PRODUCTION_READINESS.md` §14) — the external scheduler (GitHub Actions) is not expected to fire genuinely overlapping requests for the same job at the same time under normal operation, and each job's own DB queries (`where: { status: "PENDING", attempts: { lt: N } }` etc.) make a rare overlap degrade to redundant work on the same eligible orders rather than silent corruption, not a guarantee of exactly-once execution. This is documented as a limitation in [`PRODUCTION_READINESS.md`](PRODUCTION_READINESS.md), not silently glossed over.

## 10. Security Architecture Summary

(Full production checklist in [`PRODUCTION_READINESS.md`](PRODUCTION_READINESS.md); this section is the architectural "why".)

- **Defense in depth on money movement:** every balance change requires (a) an active Postgres transaction (`prisma.$transaction`), (b) an optimistic-concurrency version check on the `Wallet` row, and (c) an immutable `Transaction` ledger row — so double-spends and lost updates under concurrent requests are structurally prevented, not just discouraged by convention.
- **Secrets at rest:** provider API keys are AES-256-GCM encrypted (`lib/crypto.ts`) using a key derived from `AUTH_SECRET`. **Unlike the original Mongoose schema** (which could declare `select: false` once on the field itself, excluding it from every query by default unless explicitly re-included), Prisma has no column-level equivalent — every query that could expose `Provider.apiKeyEncrypted` must explicitly `omit: { apiKeyEncrypted: true }` (or a narrowing `select`) at the call site instead (see `prisma/schema.prisma`'s own comment on that field, and e.g. `app/api/admin/providers/route.ts`). This is a real, call-site-by-call-site discipline shift from the old design worth being deliberate about in any new code that reads `Provider` rows.
- **Tokens:** email verification, password reset, and Telegram-link codes are never stored raw — only their SHA-256 hash (`VerificationToken.tokenHash`) — and expire via the scheduled `cleanup-expired-tokens` job (Postgres has no native TTL-index mechanism — see [`DATABASE.md` §7](DATABASE.md#7-data-lifecycle-retention-and-cleanup)).
- **Idempotency:** deposit approval and order refund both write a deterministic `idempotencyKey` (e.g. `payment-approval:<id>`) on their `Transaction` row and use an atomic "claim" update (`updateMany` with a status guard — see [`DATABASE.md` §6](DATABASE.md#6-transactions) for why `updateMany` specifically, not `update`) before doing any money movement, preventing double-processing from a retried request or a double-click.
- **HTTP security headers** are set globally in `next.config.ts`: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, a restrictive `Permissions-Policy`, HSTS with `preload`, and `poweredByHeader: false`.
- **Rate limiting** is applied per-action (login, register, order creation, payment submission, ticket creation/reply, Telegram bot actions, Telegram link-code generation, API-key creation, and reseller API calls) with distinct limits per `lib/rate-limit.ts`'s `configs` map. The reseller API (`apiV2` config, `[120, 60]`) is the one config keyed by API-key id rather than by user/IP — see §3.
- **Cross-origin request enforcement** (`lib/security/origin.ts`, enforced in `proxy.ts`): browser requests to `/api/**` carrying an `Origin` header not present in `ALLOWED_ORIGINS` are rejected with `403` before reaching any route handler, closing what was previously a silently-inert env var (see [`PRODUCTION_READINESS.md` §9](PRODUCTION_READINESS.md#9-security-hardening) for the before/after detail). `/api/auth/**` and `/api/telegram/webhook` are deliberately exempted — see that section for why.
- **`proxy.ts` composition detail worth preserving:** because the origin check above requires passing a custom middleware function into `auth(...)`, and NextAuth only auto-applies `authConfig.callbacks.authorized`'s boolean result when `auth(...)` is called *without* a custom function, `proxy.ts` now calls `authorized()` itself and turns a `false` result into the same sign-in redirect NextAuth would otherwise have produced. This was verified against a live server (unauthenticated `/dashboard`/`/admin` requests, an authenticated admin session, and a cross-origin request were all tested against both `next dev` and a real `next build && next start` run) specifically because it's an easy place to accidentally disable route protection while adding an adjacent check — do not refactor `proxy.ts` without re-verifying this three-way interaction (origin check, page-route authorization, unrelated API routes).

## 11. Key Architectural Decisions & Rationale (summary)

| Decision | Rationale |
|---|---|
| PostgreSQL + Prisma (Supabase) | This project originally ran on MongoDB Atlas + Mongoose, then was fully migrated to Postgres/Prisma, driven by a general preference for Postgres/Supabase rather than a reaction to a specific MongoDB Atlas problem — see [`DATABASE.md`](DATABASE.md)'s own migration note for the full translation of every behavioral property (transactions, optimistic concurrency, referential integrity) carried over 1:1 across the migration. |
| One Next.js app for web + bot, not separate services | Guarantees the website and Telegram bot execute identical, non-duplicated business/transaction logic (see §1, §2). |
| `lib/services/*` layer between routes and models | Single source of truth for transactional business rules, callable from both HTTP handlers and bot conversations. |
| Prisma `Decimal` + custom fixed-point helpers (`lib/money.ts`) instead of native floats | Avoids floating-point rounding bugs in money math; `Decimal` (backed by `decimal.js`) has real arithmetic methods, a strict improvement over the original MongoDB design's `Decimal128`, which had no arithmetic methods at all and required `lib/money.ts` to hand-roll fixed-point math via `BigInt`. |
| Order fulfillment errors keep the order in `PROCESSING`, never silently `FAILED` | A charged customer's order must never be quietly abandoned; retry-by-default is the safer failure mode for a money-handling system. |
| Polling-based background worker instead of a message broker | Keeps infra minimal (no separate queue service to run/pay for) given current scale; explicitly documented as a scaling limit for future revisit. |
| Background workers exposed as authenticated HTTP endpoints (`/api/cron/*`), scheduled by GitHub Actions rather than Vercel's own native Cron Jobs | Vercel (the chosen deployment target) is serverless-only and cannot run the original long-lived worker scripts at all; its own Cron Jobs need a paid Pro plan for anything more frequent than once/day, so this project's existing GitHub Actions CI infrastructure is reused as a free external scheduler instead — see `docs/PRODUCTION_READINESS.md` §14 for the full trade-off analysis. |
| Sentry Performance Monitoring reused for §6 (Metrics & Alerting) instead of a separate metrics/APM vendor | Same SDK/account already being onboarded for §4 (Error Tracking) — avoids a second signup/dashboard for latency/throughput visibility and alerting; explicitly does not cover general-purpose custom business metrics (e.g. a Prometheus-style queue-depth gauge), which remains a distinct, larger, not-yet-requested piece of work if ever needed. |
| Webhook mode (prod) vs. long-polling (dev) for the Telegram bot | Webhooks scale and don't hold open connections; polling needs no public URL, which suits local/sandboxed development. |
| `ServiceProvider` links preferred over `Service`'s legacy single-provider fields, with the legacy fields kept as a zero-migration fallback rather than removed (Phase 2.1) | Lets multi-provider fallback ship without forcing every existing service through a migration before it dispatches correctly; `scripts/backfill-service-providers.ts` is available but optional. |
| Reseller API (`/api/v2`, Phase 2.2) reuses `getPublicCatalog()`/`placeOrder()`/`refundOrder()` unchanged rather than writing parallel reseller-specific logic | A fourth surface must never be able to drift from the website/bot's money-moving rules; the endpoint is a thin adapter translating the reseller HTTP contract to the same service-layer calls. |
| Reseller API always responds HTTP 200 with errors surfaced via a JSON `error` field, instead of this project's usual HTTP-status-per-error-type convention | Matches the de facto standard convention across the SMM-panel reseller ecosystem (integrators' existing code expects this), even though it differs from this project's own internal API conventions — a deliberate external-compatibility exception, confined to this one route. |
