# Database Design

**Technology:** PostgreSQL (Supabase in production; a local Postgres install or a dedicated Supabase project for local dev — see [`../README.md`](../README.md#7-local-development)), accessed via [Prisma](https://www.prisma.io) 6. The schema itself lives in one file, [`../prisma/schema.prisma`](../prisma/schema.prisma) — treat that file as the authoritative source of truth for field names/types/indexes; this document explains the *why*, not a duplicate field-by-field listing that can drift out of sync with it.

> **Migration history note:** this project originally ran on MongoDB Atlas via Mongoose (one model per file under a `models/` directory). It was fully migrated to Postgres/Prisma, driven by a general preference for Postgres rather than any specific MongoDB Atlas problem. Every behavioral property described below (transactions, optimistic concurrency, referential integrity discipline) was carried over 1:1 from the original design — only the storage engine and a handful of Mongo-specific workarounds (documented inline where relevant) changed. See `prisma/schema.prisma`'s own header comment for the full list of translation decisions.

This document covers schema structure, relationships, indexing, transactions, data lifecycle, and backup/recovery. For *why* the app is shaped this way, see [`ARCHITECTURE.md`](ARCHITECTURE.md). For step-by-step operations that touch these tables, see [`WORKFLOWS.md`](WORKFLOWS.md).

## 1. Design Approach

- **One Prisma model per Postgres table**, all declared in the single `prisma/schema.prisma` file (Prisma's convention — unlike Mongoose, there's no per-model file to maintain separately from a shared registry).
- **Money fields use Prisma's `Decimal` type** (`@db.Decimal(18, 4)`, the same 4-decimal-place fixed-point convention as before) end-to-end — never a native JS `number` — to avoid floating-point rounding errors; all arithmetic goes through `lib/money.ts` helpers, never native `+`/`-` on decimals. Under the hood this is `decimal.js`, which has real arithmetic methods (unlike MongoDB's `Decimal128`, which required this project's original `lib/money.ts` to hand-roll fixed-point math via `BigInt`).
- **Referential integrity is enforced by the database itself** — every foreign-key column (e.g. `Order.serviceId`, `Wallet.userId`) is a real Postgres foreign-key constraint with an explicit `onDelete` behavior, not just an application-layer convention. This is strictly stronger than the original MongoDB design, where `ObjectId` + Mongoose `ref` was advisory only (nothing in the database prevented an orphaned reference) and the service layer had to check existence before every use. The service layer still checks existence for good error messages (e.g. `placeOrder` returns a clean `AppError("SERVICE_NOT_FOUND", ...)` rather than letting a raw FK-violation error surface), but the database is now a second, independent line of defense against a bug ever creating an orphaned row.
- **Soft state over hard deletes** where it matters for business/audit reasons: `Order`/`Payment` records are never deleted, only transitioned through a `status` enum with a `statusHistory`/audit trail; `User.status` (`ACTIVE`/`SUSPENDED`/`BANNED`) is used instead of deleting user accounts.

## 2. Tables (Models) & Responsibilities

| Table (Model) | Responsibility |
|---|---|
| `User` | Account identity, credentials, role (`USER`/`ADMIN`), status, Telegram link, login-security state (lockout counters), 2FA fields (schema present, **not currently wired into the login flow** — see §7). |
| `Wallet` | One-per-user running balance (`Decimal`) plus an optimistic-concurrency `version` counter. |
| `Transaction` | Immutable ledger: every balance-affecting event (`DEPOSIT`, `ORDER_PAYMENT`, `ORDER_REFUND`, `ADJUSTMENT`) with `balanceBefore`/`balanceAfter` snapshots and an optional `idempotencyKey`. |
| `Order` | A customer's purchase of a `Service`: quantity, charge, fulfillment status (`statusHistory` stored as a `Json` array — see §3), links to the dispatched `Provider`, retry bookkeeping (`attempts`, `lastError`), `completedAt`, refill request state (`refillStatus`/`refillRequestedAt`/`providerRefillId`), `partialRefundIssuedAt` (guards against double-refunding the same detected shortfall), `lastStatusCheckAt` (candidate-query index for `scripts/poll-order-status.ts`). |
| `Payment` | A customer's deposit submission (bKash/Nagad/SSLCommerz/manual/crypto reference), pending admin review, becomes a `Transaction` once approved. |
| `Provider` | An upstream fulfillment source (`API`/`MANUAL`/`INTERNAL`), including encrypted-at-rest API credentials for `API`-type providers. |
| `Service` | A sellable catalog item: category, price per 1000 units, min/max order quantity, and (optionally, now deprecated-but-kept — see `ServiceProvider` below) a single legacy `Provider`/upstream service id that fulfills it. `refillDays` (`Int?` — how many days after `Order.completedAt` a customer may self-request a refill; `null` means refills aren't offered) and `estimatedDeliveryMinutes` (`Int?` — median observed completion time, recomputed periodically by `scripts/compute-delivery-estimates.ts`; `null` until at least one real completion exists). |
| `ServiceProvider` | Links one `Service` to one or more `Provider`s with a fallback `priority` order, so dispatch can automatically try a second provider within the same attempt if the first fails. `Service.providerId`/`providerServiceId`/`providerRate` are kept as a zero-migration fallback for any service that hasn't been backfilled into this table yet (`scripts/backfill-service-providers.ts`) — `lib/fulfillment.ts` prefers `ServiceProvider` rows when they exist. |
| `Category` | Grouping/display bucket for `Service` rows. Optionally belongs to a `ServiceGroup` via `groupId` (nullable). |
| `ServiceGroup` | Optional top-level grouping tier above `Category` (e.g. "🚀 Telegram Boost" containing "1 Day"/"7 Days"/"30 Days" categories) — lets the catalog scale past a flat category list; additive, so pre-existing categories with no `groupId` continue to function identically. |
| `SupportTicket` / `TicketMessage` | A customer support thread and its messages. **Unlike the original MongoDB design** (which embedded messages as sub-documents inside the ticket, since MongoDB has no join-free way to model "usually read together" data other than embedding), Postgres/Prisma models `TicketMessage` as its own table with a `ticketId` foreign key — a real join is cheap in Postgres, and a separate table means messages are independently indexable/insertable rows rather than being bounded by a single-document size ceiling. See §3 for the full rationale. |
| `Settings` | Singleton (`key: "global"`) row holding site-wide admin-configurable values (deposit limits, registration toggle, maintenance mode). |
| `VerificationToken` | One-time-use hashed tokens for email verification, password reset, and Telegram account linking. **Unlike MongoDB** (which auto-expired these via a native TTL index), Postgres has no equivalent — see §7 for how expiry cleanup actually works now. |
| `AuditLog` | Append-only record of sensitive/admin actions (logins, role/status changes, payment/order decisions, Telegram-bot-originated admin actions) for compliance/incident response. |
| `ApiKey` | A customer-issued key authenticating requests to the reseller endpoint (`POST /api/v2`, documented in [`API.md`](API.md)). Same "hash-only storage, raw value shown once" convention as `VerificationToken.tokenHash` — the raw key is never persisted, only its SHA-256 hash. One user may hold multiple active keys. |
| `Notification`, `FavoriteService`, `ExchangeRateCache`, `TelegramBotSession` | Supporting tables: in-app notifications, a user's saved/favorite services, an hourly-refreshed USD→BDT exchange-rate cache for the currency-display layer, and grammY's own conversation/session storage (replaces `@grammyjs/storage-mongodb`, see `lib/telegram/`). |

## 3. Relationships & Cardinality

```
User (1) ────── (1) Wallet                       [unique FK on Wallet.userId]
User (1) ────── (N) Order
User (1) ────── (N) Payment
User (1) ────── (N) SupportTicket
User (1) ────── (N) TicketMessage
User (1) ────── (N) Transaction
User (1) ────── (N) VerificationToken
User (1) ────── (N) AuditLog                       [actorId, optional — null for system actions]
User (1) ────── (N) ApiKey
User (1) ────── (N) Notification
User (1) ────── (N) FavoriteService

ServiceGroup (1) ── (N) Category                   [optional — Category.groupId is nullable]
Category (1) ── (N) Service
Provider (1) ── (N) Service                        [optional legacy link — deprecated, see ServiceProvider]
Provider (1) ── (N) Order                          [optional, set at dispatch time to whichever provider actually fulfilled the order]
Service  (1) ── (N) Order
Service  (1) ── (N) ServiceProvider                [priority-ordered fallback links]
Provider (1) ── (N) ServiceProvider                 [unique compound {serviceId, providerId} — a provider links to a service at most once]

Order (1) ────── (0..1) Transaction (ORDER_PAYMENT) [relatedOrderId]
Order (1) ────── (0..1) Transaction (ORDER_REFUND)  [relatedOrderId — an order can have both]
Payment (1) ──── (0..1) Transaction (DEPOSIT)       [relatedPaymentId]
Wallet (1) ────── (N) Transaction                  [walletId]

SupportTicket (1) ── (N) TicketMessage             [real foreign-key table, not embedded — see below]
```

Every cross-table relationship is modeled as a plain `String` foreign-key column with a real Postgres constraint (`@relation(fields: [...], references: [...])` in `schema.prisma`), joined via Prisma's `include`/`select` (e.g. `prisma.order.findMany({ include: { service: { select: { name: true } } } })`) rather than Mongoose's `.populate()`.

**Why `TicketMessage` is its own table (unlike the original embedded-sub-document design):** the original MongoDB schema embedded ticket messages directly inside the parent `SupportTicket` document, since message counts were small and always read/written together with their parent, and embedding avoided an extra collection/round-trip. That reasoning was itself already bounded by MongoDB's 16MB single-document size limit — not a practical concern at expected ticket-thread lengths, but a constraint that doesn't exist in relational modeling at all. Postgres has no equivalent embedding mechanism (no schemaless nested-array column with query support comparable to MongoDB's), and a real foreign-key join in Postgres is cheap enough that there's no good reason to reach for a `Json` column here instead — so `TicketMessage` became a proper table. (Contrast this with `Order.statusHistory`, which *is* a `Json` column — a small, append-only, display-only array that's never independently queried, exactly the shape `Json` is the right fit for; see `schema.prisma`'s own per-field comments for this distinction applied consistently across the schema.)

## 4. Primary Keys, Foreign Keys, Constraints

- **Primary key:** every table uses `id String @id @default(uuid())` — Prisma/Postgres has no native equivalent of MongoDB's auto-generated `ObjectId`, so every model generates a random UUID (v4) client-side via Prisma's `uuid()` default instead.
- **Foreign keys are real Postgres constraints**, not just an application convention — see §1. Every `@relation` field declares an explicit `onDelete` behavior (mostly `Cascade` for strictly-owned child rows like `Wallet`/`Transaction`/`TicketMessage`, since those have no meaning without their parent).
- **Uniqueness constraints** (enforced via Postgres unique indexes, not just application checks):
  - `User.email` — unique.
  - `User.telegramId` — unique.
  - `Wallet.userId` — unique (one wallet per user).
  - `Category.name`, `Category.slug` — unique.
  - `Provider.name` — unique.
  - `Payment.transactionRef` — unique (prevents the same deposit reference being submitted twice).
  - `VerificationToken.tokenHash` — unique.
  - `ApiKey.keyHash` — unique.
  - `Transaction.idempotencyKey` — unique.
  - `ServiceProvider.{serviceId, providerId}` — unique compound (a provider can only be linked to a given service once; re-link by editing the existing row's `priority`/`active`/rate fields instead).

  > **Why the old "sparse unique index" callout no longer applies:** the original MongoDB schema needed a `unique: true, sparse: true` index (plus a documented convention of never writing an explicit `default: null`) for every optional-unique field above (`User.telegramId`, `Transaction.idempotencyKey`, `Payment.transactionRef`) — a MongoDB sparse index only excludes documents where the field is entirely *missing*; if two documents both explicitly stored `null`, they'd collide on the unique index as duplicates. **This exact bug actually happened in production** on `Transaction.idempotencyKey` (the field had a `default: null`, so the second `ORDER_PAYMENT`/`ORDER_REFUND` transaction in the system's history collided on the sparse index and aborted — every order after the very first one failed with an unhandled 500 until it was fixed). **Postgres unique constraints have no such footgun**: every `NULL` in a unique column is natively treated as distinct from every other `NULL` (per the SQL standard), so any number of rows can have a `NULL` value in a `@unique` Prisma field simultaneously with zero special-casing required. This entire class of bug is structurally impossible in the current schema — noted here so the lesson isn't lost, not because it's still a live risk.

- **Schema-level validation:** required fields, enums (e.g. `Order.status`, `User.role`), and precision (`@db.Decimal(18, 4)`) are declared directly on the Prisma schema and enforced by Postgres itself at the database level — in addition to (not instead of) the Zod validation applied to incoming API request bodies (`lib/validation.ts`). This is actually a strictly stronger guarantee than the original Mongoose setup: Mongoose's schema-level `required`/`maxlength`/`min` validation only runs when a document is saved *through Mongoose*, whereas a Postgres `NOT NULL`/`CHECK`/enum constraint is enforced by the database itself regardless of which client or code path performs the write.

## 5. Indexing Strategy

| Table | Index | Purpose |
|---|---|---|
| `User` | `email` (unique) | Login lookup, registration duplicate-check. |
| `User` | `telegramId` (unique) | Bot's per-message "who is this" lookup. |
| `User` | `role`, `status` | Admin user-management filtering. |
| `User` | `createdAt` (desc) | Admin user list, newest first. |
| `Wallet` | `userId` (unique) | One-wallet-per-user lookup/enforcement. |
| `Order` | `userId` | Customer's own order list. |
| `Order` | `serviceId` | Reporting/joins. |
| `Order` | `status` | Admin filtering; background worker's candidate query. |
| `Order` | `providerOrderId` | Looking up an order by the upstream provider's own order id (e.g. webhook/status-sync scenarios). |
| `Order` | compound `{ userId, createdAt desc }` | Paginated "my orders", newest first — the app's most frequent read. |
| `Order` | compound `{ status, createdAt }` | Background worker's candidate-selection query (oldest pending/processing first). |
| `Order` | compound `{ status, lastStatusCheckAt }` | `scripts/poll-order-status.ts` candidate-selection query — active (`PROCESSING`/`IN_PROGRESS`) orders least-recently polled first. Postgres sorts `NULL`s last by default in ascending order (unlike MongoDB, which sorts them first) — the actual query uses `nulls: "first"` to restore the original "never-checked orders first" ordering; see `lib/services/jobs.ts`. |
| `Payment` | `userId` | Customer's own deposit history. |
| `Payment` | `status` | Admin pending-deposits queue. |
| `Payment` | compound `{ userId, createdAt desc }` | Paginated deposit history. |
| `Provider` | `status` | Filtering active providers. |
| `Service` | `categoryId` | Catalog browsing by category. |
| `Service` | `active` | Hiding inactive services from the catalog. |
| `Service` | compound `{ categoryId, active }` | The actual catalog page query. |
| `ServiceProvider` | compound `{ serviceId, active, priority }` | Dispatch's candidate-lookup query (`lib/fulfillment.ts`) — active links for a service, tried lowest-priority-number first. |
| `ServiceProvider` | compound `{ serviceId, providerId }` (unique) | Prevents duplicate links; admin CRUD duplicate-check. |
| `Category` | `slug` (unique) | URL-based category lookup. |
| `Category` | `groupId` | Fetching all categories belonging to a `ServiceGroup` (public/admin catalog rendering). |
| `ServiceGroup` | `name` (unique), `slug` (unique) | Duplicate-name prevention; URL-based lookup. |
| `ServiceGroup` | `active` | Hiding inactive groups from the catalog. |
| `SupportTicket` | `userId`, `status` | Customer's tickets; admin's open-tickets queue. |
| `SupportTicket` | compound `{ userId, updatedAt desc }` | "My tickets", most recently active first. |
| `TicketMessage` | compound `{ ticketId, createdAt }` | Fetching a ticket's messages in order. |
| `Transaction` | `userId`, `walletId` | Ledger queries by user/wallet. |
| `Transaction` | `relatedOrderId`, `relatedPaymentId` | Tracing a ledger entry back to its trigger. |
| `Transaction` | compound `{ userId, createdAt desc }` | Paginated transaction history. |
| `VerificationToken` | `tokenHash` (unique) | Token lookup on verify/reset/link. |
| `VerificationToken` | `expiresAt` | Candidate-selection query for the scheduled cleanup job (see §7) — no native TTL in Postgres, so this index backs an explicit `deleteMany({ where: { expiresAt: { lt: cutoff } } })` instead of a background monitor. |
| `ApiKey` | `keyHash` (unique) | Lookup on every `/api/v2` request. |
| `ApiKey` | compound `{ userId, createdAt desc }` | Dashboard's "your API keys" list. |
| `Notification` | compound `{ userId, read, createdAt desc }`, `{ userId, createdAt desc }` | Unread-count/list queries for the in-app notification bell. |
| `AuditLog` | `action`, `targetId` | Filtering the audit trail by action/target. |
| `AuditLog` | `createdAt` (desc) | Chronological audit review. |

All of the above are declared directly in `prisma/schema.prisma` via `@@index(...)`/`@@unique(...)`/`@unique` — there is no separate migration file that creates them (see §8 on why). `npx prisma db push` applies the current schema (including every index) directly against the target database; there is no separate "build indexes" step distinct from applying the schema itself, unlike the old Mongoose `autoIndex`/`syncIndexes()` distinction.

## 6. Transactions

Three service-layer operations use `prisma.$transaction(async (tx) => ...)` — Prisma's interactive transaction API, the direct equivalent of Mongoose's `session.withTransaction()` — to guarantee atomicity across multiple tables:

1. **`placeOrder`** (`lib/services/orders.ts`) — debit `Wallet`, create `Order`, create `Transaction`, all-or-nothing.
2. **`approveDeposit`** (`lib/services/admin-payments.ts`) — atomically claim the `Payment` (PENDING → COMPLETED guard), credit `Wallet`, create `Transaction`.
3. **`refundOrder`** (`lib/services/admin-orders.ts`) — atomically claim the `Order` (guard against double-refund), credit `Wallet`, create `Transaction`.

Each of these additionally uses an **optimistic-concurrency check** on `Wallet.version` *inside* the transaction — the direct Postgres translation of the original Mongoose `updateOne({_id, version: N}, {$set balance, $inc version})` + `modifiedCount === 1` check: `tx.wallet.updateMany({ where: { id, version: N }, data: { balance, version: { increment: 1 } } })`, checking `result.count === 1`. `updateMany` (not `update`) is used deliberately: it returns a `{ count }` result without throwing when zero rows match, which is exactly the "did this actually apply" signal needed — Prisma's singular `update` would instead throw a generic `RecordNotFound` error that can't distinguish "wallet doesn't exist" from "version mismatch, a concurrent request raced us" without an extra read. This protects against two concurrent transactions both reading the same starting balance and both succeeding with a stale value, which a transaction alone does not prevent unless combined with a row-level write-conflict guard like this. If the guard fails (`count !== 1`), the operation throws `AppError("CONCURRENT_MODIFICATION")` and the whole transaction rolls back automatically (standard Postgres transaction semantics) — no partial state (e.g. an `Order` with no matching debit) can ever be left behind; the caller can safely retry.

**Non-transactional writes are used deliberately elsewhere** (e.g. `changeOrderStatus`, `rejectDeposit`, `createTicket`) because they involve a single row with no linked money movement — adding transaction overhead there would be unjustified complexity.

Unlike MongoDB (which required a replica set — even a single-node one — purely to unlock multi-document transactions, forcing this project's original local-dev setup to run `mongodb-memory-server` in replica-set mode specifically for this reason), every standalone Postgres instance supports transactions natively. There is no equivalent "must be a replica set" operational requirement for local development or self-hosting a database.

## 7. Data Lifecycle, Retention, and Cleanup

- **`VerificationToken`** — the only table needing scheduled cleanup. MongoDB's original design used a **native TTL index** on `expiresAt` (`expireAfterSeconds: 0`), which deleted documents automatically once expired, handled entirely by MongoDB's own background TTL monitor — no application code involved. **Postgres has no native TTL mechanism**, so this project replaces it with an explicit scheduled job: `runCleanupExpiredTokensJob()` (`lib/services/jobs.ts`), reachable both as `npm run cleanup-expired-tokens` (a long-lived-process deployment) and `GET /api/cron/cleanup-expired-tokens` (a serverless/Vercel deployment, invoked on a daily schedule by `.github/workflows/cron.yml` — see `README.md` §11 item 7). It deletes rows whose `expiresAt` is more than a short grace period (`EXPIRED_TOKEN_RETENTION_DAYS`, currently 7 days) in the past, rather than the instant they expire, so a recently-expired token can still be inspected if a user reports an issue. This is purely a storage-hygiene measure, not a correctness dependency: every code path that reads a `VerificationToken` already checks `expiresAt`/`usedAt` before trusting it, exactly as before.
- **`Order`, `Payment`, `Transaction`, `AuditLog`** — retained indefinitely; no retention/archival policy or deletion job exists today. For a real production deployment handling regulated financial data, a retention policy (e.g. archive-and-purge after N years, subject to applicable financial record-keeping law in the operator's jurisdiction) should be defined — this is a known gap, not an implemented feature; see [`PRODUCTION_READINESS.md`](PRODUCTION_READINESS.md).
- **`AuditLog` is designed to be append-only** — nothing in the codebase updates or deletes an `AuditLog` row after creation; this is a documented convention (see the comment on that model in `schema.prisma`), not a database-level enforcement (there is no generic Postgres "immutable row" flag either, though a `REVOKE UPDATE, DELETE` grant on the audit-log table for the app's own database role would be a stronger enforcement mechanism worth adding — see `PRODUCTION_READINESS.md`).
- **`User` accounts are never hard-deleted** by any code path today — `status` transitions (`SUSPENDED`/`BANNED`) are the only lifecycle mechanism. There is no account-deletion/data-erasure flow implemented (relevant if operating under GDPR/CCPA-style right-to-erasure obligations) — noted as a gap in [`PRODUCTION_READINESS.md`](PRODUCTION_READINESS.md).

## 8. Migration Strategy

**There is no separate schema-migration-file history in this codebase** (no `prisma/migrations/` directory, no `prisma migrate`) — `npx prisma db push` is used instead, which diffs the current `schema.prisma` against the target database and applies the difference directly, with no migration-file history recorded. This is a deliberate choice appropriate for this project's current size/team (a single schema file, applied directly), not an oversight — see the trade-off callout below for exactly when to switch to `prisma migrate` instead.

**The actual convention used for schema changes going forward:**

1. **Edit `prisma/schema.prisma` directly**, then run `npx prisma db push` against the target database (local dev, then production once verified). New fields should default to optional/nullable with a sensible default where practical, for the same reason as before: application code and any not-yet-redeployed process should keep working gracefully against rows written before the field existed.
2. **Backfilling existing rows, when needed, is done via a one-off script under `scripts/`** (following the existing pattern of `scripts/seed.ts`/`scripts/backfill-service-providers.ts`), run manually once via `tsx scripts/<name>.ts`, not automatically on deploy. **Any backfill script must be idempotent** (safe to re-run) — the same idempotency discipline already used for money-moving operations elsewhere in this codebase (e.g. deposit approval's `idempotencyKey`), applied here to one-time data migrations instead of runtime actions.
3. **Removing or renaming a field is never done in the same change as adding its replacement.** The convention is: add the new field, backfill it, update all application code to read/write the new field, deploy and verify in production, and only *then* — in a later, separate change — drop the old column. This is the same reasoning already applied to `Service.providerId`/`providerServiceId`/`providerRate`: kept deprecated-but-present after the `ServiceProvider` linking table was introduced, not dropped.
4. **Index changes** take effect immediately as part of the same `npx prisma db push` that applies any other schema change — there is no separate `autoIndex`/`syncIndexes()` step to remember, unlike the original Mongoose setup. `CREATE INDEX` on a large existing Postgres table can still take a lock and briefly block writes, though — for a table expected to have significant production data, consider running the equivalent `CREATE INDEX CONCURRENTLY` by hand during a maintenance window instead of relying on `db push`'s default behavior, once table sizes actually warrant that caution (not a concern yet at this project's current scale).
5. **There is still no destructive-rollback mechanism** beyond "add another additive change that reverts the behavior" — the same accepted trade-off as before, now for the same reason: additive-only discipline means a "rollback" in practice is redeploying the previous application code (which simply ignores the new field), not undoing a destructive schema change.

**When to introduce `prisma migrate` (a real migration-file history) instead of `db push`:** once more than one person needs to coordinate schema changes without direct access to the same `db push` run, or once a genuinely destructive change (dropping a column/table, changing a column's type) needs to happen with a reviewable, revertible history — `db push` has no concept of a migration file, so there's nothing to review or roll back beyond re-editing the schema and re-running it. This project hasn't reached that point yet; introduce it when it does, rather than pre-emptively.

## 9. Backup & Recovery

- **No backup automation exists in this codebase, and none is needed as application code** — backups are configured at the Supabase project level (Supabase offers automatic daily backups on paid tiers, with point-in-time recovery on Pro and above; the free tier has more limited backup retention and should not be relied on for anything beyond development). This is a genuine, permanent architectural boundary, not a gap waiting on more code — no amount of code in this repo can enable a per-project Supabase console setting.
- **Documented, concrete steps for enabling and verifying it** exist in [`PRODUCTION_READINESS.md` §13](PRODUCTION_READINESS.md#13-database-backup--recovery--disaster-recovery), plus `scripts/verify-restore.ts` — a script that compares a live database against a restored one (per-table row-count comparison for every Prisma model, a `Wallet.balance` grand-total consistency check, and a concrete data-loss-window report) instead of an ad-hoc manual spot-check. Usage: `npx tsx scripts/verify-restore.ts --live "<LIVE_DATABASE_URL>" --restored "<RESTORED_DATABASE_URL>"`. `docs/INCIDENT_RESPONSE.md` §7 has the operational restore runbook (who restores, from where, how `DATABASE_URL`/`DIRECT_URL` are repointed at a restored database).
- **Still genuinely open**: the actual Supabase backup enablement/verification and a real restore-to-a-new-project drill are per-project operational actions in the Supabase console tied to your billing tier — no one has performed them for this project's current Supabase project yet. `verify-restore.ts` itself has been exercised against local test databases and against this project's real Supabase database, but not yet against a genuine Supabase-restored snapshot.

## 10. Performance & Scalability Notes

- Every list-view query used by the UI is backed by a matching compound index (§5) — this was verified by cross-referencing each `.findMany({ orderBy, skip, take })` call against the declared indexes while writing this document, not assumed.
- `Decimal` fields are slightly heavier to index/compare than native numbers, but were chosen deliberately for correctness (see `ARCHITECTURE.md` §11) — this is an accepted, intentional tradeoff at the current scale, unchanged from the original design's rationale for `Decimal128`.
- **Connection pooling is the single most important operational difference from MongoDB Atlas for a serverless deployment.** A serverless function opens a fresh process (and thus a fresh database connection) per invocation; Postgres has a hard connection-count ceiling per instance, unlike MongoDB Atlas's driver-level connection pool, which was shared per long-lived server process and comfortably absorbed serverless cold starts. `lib/db.ts` therefore requires `DATABASE_URL` to be Supabase's **pooled** ("Transaction mode", port `6543`, `?pgbouncer=true`) connection string at request time — `DIRECT_URL` (the non-pooled, direct connection) is reserved for `prisma db push`/`prisma migrate`, which need a real session for DDL and Prisma's own advisory locks and would defeat the point of a transaction-mode pooler. See `README.md` §6 and `lib/db.ts`'s own header comment for the full explanation, including what breaks (rapid connection exhaustion) if this is misconfigured.

## 11. Design Decisions & Rationale (summary)

| Decision | Rationale |
|---|---|
| Prisma `Decimal(18,4)` over native `number` for all money fields | Prevents floating-point rounding errors in financial calculations — the same rationale that motivated `Decimal128` in the original MongoDB design, now backed by decimal.js's real arithmetic methods instead of a hand-rolled `BigInt` implementation. |
| Database-enforced referential integrity (real Postgres FKs) | A strict improvement over the original MongoDB design's application-only enforcement — an entire class of "orphaned reference due to a missed check" bug is now structurally impossible, not just guarded against in code. |
| Optimistic concurrency (`Wallet.version`) inside transactions, not just transactions alone | A transaction guarantees atomicity/isolation of the writes it contains, but does not by itself prevent two transactions from both reading the same stale balance before either commits; the version-guarded `updateMany` closes that gap — unchanged reasoning from the original design. |
| Scheduled cleanup job instead of a TTL index for `VerificationToken` | Postgres has no native TTL mechanism (MongoDB's was a genuine one-line convenience that has no direct equivalent) — replaced with an explicit, tested, scheduled job (`lib/services/jobs.ts#runCleanupExpiredTokensJob`) rather than leaving expired rows to accumulate forever. |
| `TicketMessage` as its own table instead of an embedded array | The original embedding decision was itself partly a MongoDB-specific workaround (avoiding a join, bounded by the 16MB document-size ceiling) — neither constraint applies in Postgres, where a real foreign-key join is the natural, cheap default. |
| `db push` (schema-diffing) instead of `prisma migrate` (migration-file history) | Appropriate for this project's current size/team — a single schema file applied directly, with the same additive-only discipline as before standing in for a formal migration/rollback history. Revisit once multiple contributors need to coordinate concurrent schema changes (§8). |
| No hard deletes on money/audit-relevant tables | Compliance and incident-response requirement — an admin or attacker action must remain reconstructable after the fact. Unchanged from the original design. |
