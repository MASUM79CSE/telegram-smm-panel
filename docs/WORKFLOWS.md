# End-to-End Working Process

This document traces concrete request/data lifecycles through the system, from app startup through to persistence and side effects, including error paths. For the "why" behind the design, see [`ARCHITECTURE.md`](ARCHITECTURE.md); for schema detail, see [`DATABASE.md`](DATABASE.md).

## 1. Application Startup

1. `next dev` / `next start` boots the Next.js server.
2. On the **first** module that imports `lib/env.ts`'s `env` proxy (or calls `getEnv()` directly), the full `process.env` is parsed against a Zod schema. If any required variable is missing/invalid, or `NODE_ENV=production` and `AUTH_SECRET` still contains the example placeholder string, the process throws immediately with a formatted list of every failing field — this happens **before** the app serves any request, by design (fail fast, not on the first user's request). A related but non-fatal check also warns at this point if `NODE_ENV=production` and `AUTH_TRUST_HOST` isn't `true` — this doesn't stop startup (unlike the checks above) because it depends on the deployment's networking setup, but every auth-related request will fail with `UntrustedHost` until it's set; see [`../README.md` §11](../README.md#11-production-setup--operational-requirements).
3. `lib/db.ts` does **not** connect eagerly at import time — `connectDB()` is called lazily on the first request/script that needs the database (e.g. inside a route handler, inside `auth()`'s `authorize` callback, or explicitly at the top of every `scripts/*.ts` entry point). The resulting connection is cached on `global.__mongooseCache` so subsequent calls (including across Next.js dev-mode hot reloads and serverless re-invocations) reuse it instead of opening a new connection each time.
4. `connectDB()` imports `models/index.ts` as a side effect the first time it's called, which registers every Mongoose model (`User`, `Order`, `Wallet`, ...) on the shared connection — this exists so that a route which only directly imports, say, `models/Order.ts` but `.populate("serviceId")` (a ref to `Service`) doesn't hit Mongoose's "Schema hasn't been registered for model Service" error just because it never explicitly imported `models/Service.ts` itself.
5. If the Telegram bot integration is enabled (`TELEGRAM_BOT_TOKEN` set), the bot instance itself is **also** lazily constructed — the first inbound webhook request (or the explicit `scripts/run-bot-polling.ts` script) triggers `getBot()`, which connects to MongoDB (reusing the same cached connection), sets up grammY session storage backed by a `telegram_bot_sessions` collection, and registers command handlers exactly once per server process (`registered` flag guard in `lib/telegram/bot.ts`).
6. The background order processor (`scripts/process-orders.ts`) is a **separate OS process**, started independently (not by the Next.js server) — see [`../README.md`](../README.md#11-production-setup--operational-requirements).

## 2. Request Lifecycle: Web (representative pattern, all API routes follow this shape)

```
0. proxy.ts (runs before the route handler is ever invoked) — for /api/**
   requests, reject with 403 if an Origin header is present and not in
   ALLOWED_ORIGINS (see ARCHITECTURE.md §10); /api/auth/** and
   /api/telegram/webhook are exempted from this check
1. Route Handler receives request (app/api/**/route.ts)
2. auth() — resolve session from the request's JWT cookie (skip for public routes)
3. Authorization check — reject 401 if no session; reject 403 if role requirement not met
4. Rate limit check (lib/rate-limit.ts) — reject 429 if the caller's bucket is exhausted
5. connectDB() — ensure a live MongoDB connection (usually already cached)
6. Parse & validate request body/query params with a Zod schema (lib/validation.ts)
7. Call the relevant lib/services/* function — this is where business logic and
   any required transaction happens
8. Fire-and-forget side effects (Telegram notification, audit log) — do not
   block the response on these
9. Return JSON response; map AppError codes to specific HTTP statuses,
   anything unexpected to a generic 500 with server-side logging
```

Every route in `app/api/**` (see the route table in `README.md`'s project structure, or grep `app/api` directly) follows this shape with route-specific variations in steps 2–4 (e.g. public routes like `/api/register` skip the session check but still rate-limit by IP). Step 0 applies uniformly and is enforced once, centrally, rather than per-route.

## 3. Business Workflow: Placing an Order (Web & Telegram Bot)

Both entry points below converge on the exact same `placeOrder()` function (`lib/services/orders.ts`) — see [`ARCHITECTURE.md` §4](ARCHITECTURE.md#4-request--data-flow-representative-placing-an-order) for the internal transaction detail. This section focuses on the surface-specific request lifecycle and edge cases.

**Web:** `POST /api/orders` (`app/api/orders/route.ts`)
1. Require an authenticated session.
2. Rate-limit key: `orderCreate` bucket, keyed by `userId:ip` (20/min).
3. Validate body against `orderSchema` (service id, target string, quantity).
4. Call `placeOrder({ userId, userStatus, serviceId, target, quantity })`.
5. On success: fire `notifyOrderPlaced(order)` (admin Telegram alert) without awaiting it; return `201` with the created order.
6. On `AppError`: map to the appropriate status (`ACCOUNT_NOT_ACTIVE` → 403, `SERVICE_NOT_FOUND` → 404, `INVALID_QUANTITY`/`INSUFFICIENT_BALANCE` → 400, `WALLET_NOT_FOUND` → 404, `CONCURRENT_MODIFICATION` → 409).

**Telegram bot:** `/order` conversation (`lib/telegram/bot.ts`)
1. `requireLinked()` wrapper: verify the chat is linked to a panel `User` (via `telegramId` lookup); if not, reply with instructions to run `/link CODE` and stop.
2. Rate-limit key: `telegramBotAction` bucket, keyed by the Telegram user id (30/min) — this is a coarser, per-action-type-agnostic limit than the web's `orderCreate` bucket, since the bot conversation covers several distinct commands under one budget.
3. Conversation steps: present categories → services within the chosen category → prompt for target (link/username) → prompt for quantity.
4. Call the identical `placeOrder(...)`.
5. On success: reply with an order confirmation message; the same `notifyOrderPlaced` fires for the admin alert.
6. On `AppError`: reply with `error.message` directly as a chat message (no HTTP status mapping needed in this surface).

**Edge cases handled by `placeOrder` regardless of entry point:**
- Ordering a `Service` that has been deactivated since the catalog was last fetched → `SERVICE_NOT_FOUND`.
- Quantity outside the service's configured `[minQuantity, maxQuantity]` → `INVALID_QUANTITY` with the exact allowed range in the message.
- Insufficient wallet balance → `INSUFFICIENT_BALANCE`, no partial charge ever occurs (checked before any write).
- Two concurrent order/refund/deposit operations racing on the same wallet → the losing request receives `CONCURRENT_MODIFICATION` and must be retried by the caller (neither the web UI nor the bot currently auto-retries this — it surfaces as a user-visible "please try again" message).
- Order dispatch to the provider fails immediately after creation → the order is still created and charged (irreversible from the customer's perspective at this point by design — the charge already succeeded), but is left in a retryable state (`PROCESSING`) for the background worker rather than being marked `FAILED` outright.

## 4. Business Workflow: Deposit Submission & Approval

**Submission** (`submitDeposit`, `lib/services/payments.ts`) — used by `POST /api/payments` (web) and the bot's `/deposit` conversation:
1. Load current `Settings` (site-wide min/max deposit bounds).
2. Reject if amount is outside `[minDeposit, maxDeposit]`.
3. Reject if `transactionRef` has already been submitted (unique index + explicit existence check) — prevents a customer resubmitting the same payment reference to be credited twice.
4. Create a `Payment` document with `status: PENDING` — **no wallet credit happens yet**.
5. Fire `notifyAdminNewDeposit(payment)` with inline Approve/Reject buttons (bot) / a dashboard link (web notification).

**Approval** (`approveDeposit`, `lib/services/admin-payments.ts`) — triggered from the admin dashboard (`PATCH .../approve`) or the bot's inline "✅ Approve" button:
1. Atomically claim the payment: `updateOne({_id, status: "PENDING"}, {$set: {status: "COMPLETED", ...}})` — if `modifiedCount !== 1`, someone already processed it (`ALREADY_PROCESSED`), which structurally prevents a double-click or a race between the web admin and a bot admin action from double-crediting the same deposit.
2. Inside the same transaction: credit the user's `Wallet` (optimistic-concurrency guarded, per [`DATABASE.md` §6](DATABASE.md#6-transactions)) and write a `Transaction` (`type: DEPOSIT`) with a deterministic `idempotencyKey: payment-approval:<paymentId>`.
3. Fire `notifyUserDepositReviewed(userId, approved=true, amount)` — informs the customer via their linked Telegram account, if any (no-op if they're not linked).

**Rejection** (`rejectDeposit`) — single-document update, no wallet/transaction involvement, same atomic PENDING-guard pattern to prevent double-processing; records a `rejectionReason`.

## 5. Business Workflow: Support Tickets

1. **Creation** (`createTicket`) — either surface calls the same function; creates a `SupportTicket` with an embedded first message, `status: OPEN`, then fires `notifyAdminNewTicket`.
2. **Reply** (`replyToTicket`) — appends a message to the embedded `messages` array; if the ticket is already `CLOSED`, returns a sentinel (`"CLOSED"`) instead of accepting the reply, so both the web form and the bot conversation can show "this ticket is closed" without duplicating that check. A customer reply flips status to `OPEN`; an admin reply flips it to `ANSWERED`. `notifyTicketReply` alerts whichever party didn't just send the message (admin gets alerted on customer replies, customer gets alerted via Telegram on admin replies, if linked).

## 6. Business Workflow: Telegram Account Linking

1. **Web side:** an authenticated user visits `/dashboard/telegram` and requests a link code (`POST /api/telegram/link-code`, rate-limited `telegramLink` bucket, 5/10min per user+IP). `createTelegramLinkCode()` invalidates any previous unused code for that user (marks it used), then creates a fresh `VerificationToken` (`purpose: TELEGRAM_LINK`) with an 8-character uppercase code as its (low-entropy, short-lived-by-design) `tokenHash` field, expiring in 15 minutes.
2. **Bot side:** the user sends `/link CODE` to the bot. `linkTelegramAccount()` looks up an unused, unexpired token matching that code; if found, checks the Telegram id isn't already linked to a *different* panel account (`ALREADY_LINKED` if so); if clear, sets `telegramId`/`telegramUsername` on the `User` document and marks the token used.
3. From this point, `getLinkedUser(ctx)` in every subsequent bot interaction resolves the calling `User` by `telegramId` — there is no separate bot-specific credential.
4. **Unlinking** (`unlinkTelegramAccount`) simply clears `telegramId`/`telegramUsername` back to `null`.

## 7. Registration, Email Verification, and Password Reset

**Registration** (`POST /api/register`):
1. Rate-limited by IP (`register` bucket, 3/10min).
2. Reject if `Settings.registrationEnabled` is `false` (admin-controlled kill switch).
3. Validate against `registerSchema` (name, email, strong-password policy — see `lib/validation.ts`'s `passwordSchema`: min 10 chars, upper+lower+digit+special character).
4. Reject duplicate email with a deliberately vague `409` message ("Unable to register with these details") rather than "email already exists", to avoid confirming account existence to an attacker.
5. Hash password (`bcrypt`, cost 12), create `User` + an empty `Wallet` (`balance: 0`).
6. Create a `VerificationToken` (`purpose: EMAIL_VERIFY`, 24h expiry) and send a verification email with the raw token embedded in the link — only the hash is stored.

**Verification** (`POST /api/verify-email`) and **password reset** (`POST /api/forgot-password` → email link → `POST /api/reset-password`) follow the same shape: look up by `tokenHash = hashToken(rawTokenFromRequest)`, check `usedAt IS NULL AND expiresAt > now`, apply the effect, mark the token used. The forgot-password endpoint **always returns the same success message regardless of whether the email exists**, to prevent user enumeration — this is enforced in code, not just documented as an intention.

## 8. Admin Order Management

`PATCH /api/admin/orders/[id]` (`role: ADMIN` required):
- If the requested new status is `REFUNDED`, delegates to `refundOrder()` (money-moving, transactional, atomic-claim-guarded — see [`DATABASE.md` §6](DATABASE.md#6-transactions)).
- Any other status transition delegates to `changeOrderStatus()` (simple status/history update, no money movement).
- Every successful change writes an `AuditLog` entry (`ORDER_REFUNDED` or `ORDER_STATUS_CHANGE`) and fires `notifyOrderStatusChanged` to the customer's linked Telegram account (best-effort, non-blocking).
- The exact same refund action is also exposed as an inline "Refund" button in the bot's admin flow, calling the identical `refundOrder()` service function.

## 9. Error & Failure Handling Flow (cross-cutting)

See [`ARCHITECTURE.md` §8](ARCHITECTURE.md#8-error-handling-strategy) for the general strategy; concretely, for a failing request:

1. A known business-rule violation raises `AppError(code, message)` from within a `lib/services/*` function.
2. The calling route handler catches it specifically, maps `code` to an HTTP status via a local `errorStatusMap`, and returns `{ error: message }` — the bot instead sends `message` as a plain chat reply.
3. Any other thrown error (a bug, a network failure talking to MongoDB, an unexpected exception) is caught by the route's outer try/catch, logged via `console.error` with context, and converted to a generic `{ error: "Internal server error" }` / `500` — no internal detail (stack trace, MongoDB error text) is ever returned to the client.
4. Failures in **non-critical side effects** (Telegram notifications, audit log writes, email sending) are caught internally by those functions themselves and logged — they never bubble up to fail the primary operation that triggered them. A failed order-placement notification, for example, still leaves the customer with a successfully created, charged order; only the admin's alert is missing (and would need to be recovered by checking the dashboard).
5. Failures during **order fulfillment dispatch** specifically are treated as retryable, not terminal — see [`ARCHITECTURE.md` §5](ARCHITECTURE.md#5-fulfillment-dispatch) and the background worker in §10 below.

## 10. Background/Scheduled Process Flow

`scripts/process-orders.ts`, run continuously in production (see [`../README.md`](../README.md#11-production-setup--operational-requirements)):

```
loop (every 30s if run with --loop, otherwise a single pass):
  1. connectDB()
  2. Find up to 25 Orders where status IN (PENDING, PROCESSING)
     AND attempts < 5 AND providerId IS NOT NULL, oldest createdAt first
  3. For each candidate, sequentially:
       call dispatchOrderToProvider(orderId)
       on error: log it, move to the next candidate (one bad order never
                 halts the batch or the loop)
  4. Sleep 30s (loop mode) or exit (single-pass mode)
```

This is the **only** scheduled/background process in the system today — there is no separate job for, e.g., syncing provider balances, cleaning up old sessions, or archiving old records (`VerificationToken` cleanup is instead handled passively by MongoDB's TTL index, per [`DATABASE.md` §7](DATABASE.md#7-data-lifecycle-retention-and-ttl-indexes)).

## 11. External Integrations Summary

| Integration | Used for | Failure behavior |
|---|---|---|
| MongoDB Atlas | All persistent state | App cannot function without it; `connectDB()` failures propagate as request-level 500s (or process-crash for scripts). `GET /api/health` surfaces connectivity as a 503. |
| Telegram Bot API | Bot commands/conversations, admin/customer notifications | Fully optional — every code path checks for `TELEGRAM_BOT_TOKEN` and no-ops if absent. Individual send failures are caught and logged, never thrown to the caller. |
| SMTP provider (via Nodemailer) | Verification/reset emails | If unconfigured, emails are logged to console instead of sent (dev-friendly, **not acceptable in production** — see [`PRODUCTION_READINESS.md`](PRODUCTION_READINESS.md)). |
| Upstash Redis | Distributed rate limiting | If unconfigured, silently falls back to an in-memory limiter (logged as a warning when `NODE_ENV=production`), which does not coordinate across multiple server instances. |
| Upstream SMM-panel-style provider APIs (per-`Provider`, `type: API`) | Actual service fulfillment | Timeouts/errors leave the order in `PROCESSING` for retry by the background worker (see §10) rather than failing the order outright. |
