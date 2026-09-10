# Database Design

**Technology:** MongoDB (Atlas in production; an in-memory replica set for local dev — see [`../README.md`](../README.md#7-local-development)), accessed via Mongoose 9.

**Why a replica set, always:** several write paths (order placement, deposit approval, order refund) use `mongoose.startSession().withTransaction()` for multi-document ACID transactions. MongoDB only supports multi-document transactions on a replica set (or sharded cluster), never on a standalone `mongod`. Atlas clusters — including the free M0 tier — are provisioned as replica sets by default, and local development deliberately uses `MongoMemoryReplSet` (not `MongoMemoryServer`) for the same reason (`scripts/start-dev-db.ts`).

This document covers schema structure, relationships, indexing, transactions, data lifecycle, and backup/recovery. For *why* the app is shaped this way, see [`ARCHITECTURE.md`](ARCHITECTURE.md). For step-by-step operations that touch these collections, see [`WORKFLOWS.md`](WORKFLOWS.md).

## 1. Design Approach

- **One Mongoose model per MongoDB collection**, one file per model under `models/`, all registered on the shared connection via `models/index.ts` (imported once, as a side effect, by `lib/db.ts`).
- **Money fields use `mongodb`'s `Decimal128`** type end-to-end (never `Number`) to avoid floating-point rounding errors; all arithmetic goes through `lib/money.ts` helpers, never native `+`/`-` on decimals.
- **Referential integrity is application-enforced, not database-enforced** — MongoDB has no native foreign-key constraints. Every `ObjectId` reference field declares `ref: "ModelName"` for Mongoose's `.populate()` convenience, but nothing in the database itself prevents an orphaned reference; the service layer is responsible for checking existence before use (e.g. `placeOrder` verifies the `Service` exists and is active before creating an `Order`).
- **Soft state over hard deletes** where it matters for business/audit reasons: `Order`/`Payment` records are never deleted, only transitioned through a `status` enum with a `statusHistory`/audit trail; `User.status` (`ACTIVE`/`SUSPENDED`/`BANNED`) is used instead of deleting user accounts.

## 2. Collections (Entities) & Responsibilities

| Collection (Model) | Responsibility |
|---|---|
| `User` | Account identity, credentials, role (`USER`/`ADMIN`), status, Telegram link, login-security state (lockout counters), 2FA fields (schema present, **not currently wired into the login flow** — see §7). |
| `Wallet` | One-per-user running balance (`Decimal128`) plus an optimistic-concurrency `version` counter. |
| `Transaction` | Immutable ledger: every balance-affecting event (`DEPOSIT`, `ORDER_PAYMENT`, `ORDER_REFUND`, `ADJUSTMENT`) with `balanceBefore`/`balanceAfter` snapshots and an optional `idempotencyKey`. |
| `Order` | A customer's purchase of a `Service`: quantity, charge, fulfillment status (`statusHistory` array), links to the dispatched `Provider`, retry bookkeeping (`attempts`, `lastError`). Added in `docs/IMPLEMENTATION_PLAN.md` Phase 3: `completedAt` (set the moment `status` first reaches `COMPLETED`); `refillStatus` (`NONE`/`REQUESTED`/`COMPLETED`/`REJECTED`), `refillRequestedAt`, `providerRefillId` — self-service refill request state (§3.1); `partialRefundIssuedAt` — set once a status-poll-detected partial delivery has been refunded, to guard against double-refunding the same shortfall (§3.2); `lastStatusCheckAt` — timestamp of the most recent provider status poll, used both for polling-schedule bookkeeping and as the candidate-query index for `scripts/poll-order-status.ts` (§3.2). |
| `Payment` | A customer's deposit submission (bKash/Nagad/SSLCommerz/manual/crypto reference), pending admin review, becomes a `Transaction` once approved. |
| `Provider` | An upstream fulfillment source (`API`/`MANUAL`/`INTERNAL`), including encrypted-at-rest API credentials for `API`-type providers. |
| `Service` | A sellable catalog item: category, price per 1000 units, min/max order quantity, and (optionally, now deprecated-but-kept — see `ServiceProvider` below) a single legacy `Provider`/upstream service id that fulfills it. Added in `docs/IMPLEMENTATION_PLAN.md` Phase 3: `refillDays` (`number \| null` — how many days after `Order.completedAt` a customer may self-request a refill on an order for this service; `null` means refills are not offered, §3.1); `estimatedDeliveryMinutes` (`number \| null` — median observed completion time across the service's own recent `COMPLETED` orders, recomputed periodically by `scripts/compute-delivery-estimates.ts`; `null` until at least one real completion exists, §3.3). |
| `ServiceProvider` | Added in `docs/IMPLEMENTATION_PLAN.md` Phase 2.1: links one `Service` to one or more `Provider`s with a fallback `priority` order, so dispatch can automatically try a second provider within the same attempt if the first fails. `Service.providerId`/`providerServiceId`/`providerRate` are kept as a zero-migration fallback for any service that hasn't been backfilled into this table yet (`scripts/backfill-service-providers.ts`) — `lib/fulfillment.ts` prefers `ServiceProvider` rows when they exist. |
| `Category` | Grouping/display bucket for `Service` documents. Optionally belongs to a `ServiceGroup` via `groupId` (nullable — see below). |
| `ServiceGroup` | Optional top-level grouping tier above `Category` (e.g. "🚀 Telegram Boost" containing "1 Day"/"7 Days"/"30 Days" categories), added in `docs/IMPLEMENTATION_PLAN.md` Phase 1.1 to let the catalog scale past a flat category list without restructuring existing data — additive, so pre-existing categories with no `groupId` continue to function identically. |
| `SupportTicket` | A customer support thread; embeds its own `messages` sub-documents rather than a separate collection (see §3). |
| `Settings` | Singleton (`key: "global"`) document holding site-wide admin-configurable values (deposit limits, registration toggle, maintenance mode). |
| `VerificationToken` | One-time-use hashed tokens for email verification, password reset, and Telegram account linking; self-expiring via a TTL index. |
| `AuditLog` | Append-only record of sensitive/admin actions (logins, role/status changes, payment/order decisions, Telegram-bot-originated admin actions) for compliance/incident response. |
| `ApiKey` | Added in `docs/IMPLEMENTATION_PLAN.md` Phase 2.2: a customer-issued key authenticating requests to the reseller endpoint (`POST /api/v2`, documented in [`API.md`](API.md)). Same "hash-only storage, raw value shown once" convention as `VerificationToken.tokenHash` — the raw key is never persisted, only its SHA-256 hash. One user may hold multiple active keys. |

## 3. Relationships & Cardinality

```
User (1) ────── (1) Wallet                       [unique index on Wallet.userId]
User (1) ────── (N) Order
User (1) ────── (N) Payment
User (1) ────── (N) SupportTicket
User (1) ────── (N) Transaction
User (1) ────── (N) VerificationToken
User (1) ────── (N) AuditLog                       [actorId, optional — null for system actions]
User (1) ────── (N) ApiKey

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

SupportTicket (1) ── (N) embedded ITicketMessage    [not a separate collection]
```

All cross-collection relationships are modeled as `Schema.Types.ObjectId` fields with a Mongoose `ref`, resolved via `.populate()` where the UI needs joined data (e.g. `Order.find().populate("serviceId", "name")`) rather than manual multi-query joins.

**Why `SupportTicket` embeds messages instead of a separate `Message` collection:** ticket message counts are small and always read/written together with their parent ticket (no independent query pattern over messages exists), so embedding avoids an extra collection and an extra round-trip for the ticket detail view, at the cost of a per-document size ceiling (MongoDB's 16MB document limit) that is not a practical concern at expected ticket-thread lengths.

## 4. Primary Keys, Foreign Keys, Constraints

- **Primary key:** every document uses MongoDB's default `_id: ObjectId`, auto-generated — no custom PK fields.
- **"Foreign keys"** are `ObjectId` fields with `ref: <Model>` — enforced at the **application layer** (service functions check existence before use), not by the database (see §1).
- **Uniqueness constraints** (enforced via MongoDB unique indexes, not just application checks):
  - `User.email` — unique.
  - `User.telegramId` — unique **and sparse** (see callout below).
  - `Wallet.userId` — unique (one wallet per user).
  - `Category.name`, `Category.slug` — unique.
  - `Provider.name` — unique.
  - `Payment.transactionRef` — unique and sparse (prevents the same deposit reference being submitted twice).
  - `VerificationToken.tokenHash` — unique.
  - `ApiKey.keyHash` — unique.
  - `Transaction.idempotencyKey` — unique and sparse.
  - `ServiceProvider.{serviceId, providerId}` — unique compound (a provider can only be linked to a given service once; re-link by editing the existing row's `priority`/`active`/rate fields instead).

  > **Sparse-index callout (`User.telegramId`):** the schema deliberately does **not** set `default: null` on `telegramId`. A sparse unique index only excludes documents where the field is *missing* — if every unlinked user instead stored an explicit `telegramId: null`, they would all collide on that same null value and the second user registration would fail with a duplicate-key error. This is documented directly in `models/User.ts` and is the kind of subtle correctness detail future contributors must preserve if they ever touch that field.
  >
  > **The same bug actually happened to `Transaction.idempotencyKey` in production (Phase 2.1, discovered and fixed during live verification of the `ServiceProvider` feature — see `docs/IMPLEMENTATION_PLAN.md` §2.1 and `MEMORY.md` §7 for the full incident writeup).** The field previously had `default: null`, which explicitly wrote `null` onto every `ORDER_PAYMENT`/`ORDER_REFUND` transaction; the *second* such transaction in the system's history collided on the sparse unique index and aborted its transaction, meaning **every order placed after the very first one in the system's entire history failed with an unhandled 500.** Fixed by removing the `default: null`. This is now the second time this exact class of bug has been found in this codebase — treat any `unique: true, sparse: true` field with deep suspicion if it also has `default: null` anywhere nearby.

- **Schema-level validation:** required fields, string length limits (`maxlength`), numeric bounds (`min`), and enums (e.g. `Order.status`, `User.role`) are declared directly on the Mongoose schema, in addition to (not instead of) the Zod validation applied to incoming API request bodies (`lib/validation.ts`) — two layers, request-shape validation at the edge and persistence-shape validation at the model.

## 5. Indexing Strategy

| Collection | Index | Purpose |
|---|---|---|
| `User` | `email` (unique) | Login lookup, registration duplicate-check. |
| `User` | `telegramId` (unique, sparse) | Bot's per-message "who is this" lookup. |
| `User` | `role`, `status` | Admin user-management filtering. |
| `User` | `createdAt` (desc) | Admin user list, newest first. |
| `Wallet` | `userId` (unique) | One-wallet-per-user lookup/enforcement. |
| `Order` | `userId` | Customer's own order list. |
| `Order` | `serviceId` | Reporting/joins. |
| `Order` | `status` | Admin filtering; background worker's candidate query. |
| `Order` | `providerOrderId` | Looking up an order by the upstream provider's own order id (e.g. webhook/status-sync scenarios). |
| `Order` | compound `{ userId: 1, createdAt: -1 }` | Paginated "my orders", newest first — the app's most frequent read. |
| `Order` | compound `{ status: 1, createdAt: 1 }` | Background worker's candidate-selection query (oldest pending/processing first). |
| `Order` | compound `{ status: 1, lastStatusCheckAt: 1 }` | `scripts/poll-order-status.ts` (Phase 3.2) candidate-selection query — active (`PROCESSING`/`IN_PROGRESS`) orders least-recently polled first. |
| `Payment` | `userId` | Customer's own deposit history. |
| `Payment` | `status` | Admin pending-deposits queue. |
| `Payment` | compound `{ userId: 1, createdAt: -1 }` | Paginated deposit history. |
| `Provider` | `status` | Filtering active providers. |
| `Service` | `categoryId` | Catalog browsing by category. |
| `Service` | `active` | Hiding inactive services from the catalog. |
| `Service` | compound `{ categoryId: 1, active: 1 }` | The actual catalog page query. |
| `ServiceProvider` | compound `{ serviceId: 1, active: 1, priority: 1 }` | Dispatch's candidate-lookup query (`lib/fulfillment.ts`) — active links for a service, tried lowest-priority-number first. |
| `ServiceProvider` | compound `{ serviceId: 1, providerId: 1 }` (unique) | Prevents duplicate links; admin CRUD duplicate-check. |
| `Category` | `slug` (unique) | URL-based category lookup. |
| `Category` | `groupId` | Fetching all categories belonging to a `ServiceGroup` (public/admin catalog rendering). |
| `ServiceGroup` | `name` (unique), `slug` (unique) | Duplicate-name prevention; URL-based lookup. |
| `ServiceGroup` | `active` | Hiding inactive groups from the catalog. |
| `SupportTicket` | `userId`, `status` | Customer's tickets; admin's open-tickets queue. |
| `SupportTicket` | compound `{ userId: 1, updatedAt: -1 }` | "My tickets", most recently active first. |
| `Transaction` | `userId`, `walletId` | Ledger queries by user/wallet. |
| `Transaction` | `relatedOrderId`, `relatedPaymentId` | Tracing a ledger entry back to its trigger. |
| `Transaction` | compound `{ userId: 1, createdAt: -1 }` | Paginated transaction history. |
| `VerificationToken` | `tokenHash` (unique) | Token lookup on verify/reset/link. |
| `VerificationToken` | `expiresAt` (TTL, `expireAfterSeconds: 0`) | Automatic cleanup — see §7. |
| `ApiKey` | `keyHash` (unique) | Lookup on every `/api/v2` request. |
| `ApiKey` | `{userId, createdAt}` | Dashboard's "your API keys" list. |
| `AuditLog` | `actorId`, `action`, `targetId` | Filtering the audit trail by actor/action/target. |
| `AuditLog` | `createdAt` (desc) | Chronological audit review. |

All of the above are declared directly in the relevant `models/*.ts` file (either inline on a field or via an explicit `schema.index(...)` call) — there is no separate migration file that creates them. In development, Mongoose creates them automatically the first time a model is used against a live connection (`autoIndex: true`); in production this is now disabled (`autoIndex: false` — see §8 Migration Strategy) and indexes must be applied explicitly via `Model.syncIndexes()` during a deploy/maintenance window.

## 6. Transactions

Three service-layer operations use `mongoose.startSession()` + `withTransaction()` to guarantee atomicity across multiple documents/collections:

1. **`placeOrder`** (`lib/services/orders.ts`) — debit `Wallet`, create `Order`, create `Transaction`, all-or-nothing.
2. **`approveDeposit`** (`lib/services/admin-payments.ts`) — atomically claim the `Payment` (PENDING → COMPLETED guard), credit `Wallet`, create `Transaction`.
3. **`refundOrder`** (`lib/services/admin-orders.ts`) — atomically claim the `Order` (guard against double-refund), credit `Wallet`, create `Transaction`.

Each of these additionally uses an **optimistic-concurrency check** on `Wallet.version` (`updateOne({_id, version: N}, {$set balance, $inc version})`, checking `modifiedCount === 1`) *inside* the transaction — this protects against two concurrent transactions both reading the same starting balance and both succeeding with a stale value, which a transaction alone does not prevent unless combined with a document-level write-conflict guard like this. If the guard fails, the operation throws `AppError("CONCURRENT_MODIFICATION")` and the transaction aborts; the caller can safely retry.

**Non-transactional writes are used deliberately elsewhere** (e.g. `changeOrderStatus`, `rejectDeposit`, `createTicket`) because they involve a single document with no linked money movement — adding transaction overhead there would be unjustified complexity.

## 7. Data Lifecycle, Retention, and TTL Indexes

- **`VerificationToken`** — the only collection with automatic expiry: a MongoDB TTL index on `expiresAt` (`expireAfterSeconds: 0`) deletes documents once their `expiresAt` timestamp has passed, handled entirely by MongoDB's background TTL monitor (runs approximately every 60 seconds) — no application cleanup job is needed or exists.
- **`Order`, `Payment`, `Transaction`, `AuditLog`** — retained indefinitely; no retention/archival policy or deletion job exists today. For a real production deployment handling regulated financial data, a retention policy (e.g. archive-and-purge after N years, subject to applicable financial record-keeping law in the operator's jurisdiction) should be defined — this is a known gap, not an implemented feature; see [`PRODUCTION_READINESS.md`](PRODUCTION_READINESS.md).
- **`AuditLog` is designed to be append-only** — nothing in the codebase updates or deletes an `AuditLog` document after creation; this is a documented convention (see the comment in `models/AuditLog.ts`), not a database-level enforcement (MongoDB has no field/collection-level immutability flag) — access control at the database-user level should additionally restrict update/delete on this collection in production.
- **`User` accounts are never hard-deleted** by any code path today — `status` transitions (`SUSPENDED`/`BANNED`) are the only lifecycle mechanism. There is no account-deletion/data-erasure flow implemented (relevant if operating under GDPR/CCPA-style right-to-erasure obligations) — noted as a gap in [`PRODUCTION_READINESS.md`](PRODUCTION_READINESS.md).

## 8. Migration Strategy

**There is no formal schema-migration runner/tool in this codebase** (no Prisma-style `migrate`, no `migrate-mongo`, no custom migration CLI) — this is a deliberate, documented convention, not an oversight, and it's important that anyone changing a Mongoose schema understands and follows it rather than assuming a migration framework exists.

**The actual convention used throughout this project's history (verified against every schema change made so far, e.g. `AUTH_TRUST_HOST`, `Category.groupId` if/when added per `docs/IMPLEMENTATION_PLAN.md` Phase 1.1):**

1. **New fields are always added as optional/nullable with a sensible default**, never as a new `required: true` field on an existing collection. Mongoose does not enforce a schema against documents already in the database until they're next read/written and re-validated — a newly `required` field with no default would not retroactively invalidate existing documents, but application code that assumes the field is always present would break the moment it reads an old document that predates the change. Making new fields optional/defaulted sidesteps this class of bug entirely, at the cost of every consumer needing to handle the "field is absent/null" case (which TypeScript's strict null checks already force you to do, since the model's TypeScript interface should mark the field `| null` or `?:` to match).
2. **Backfilling existing documents, when needed, is done via a one-off script under `scripts/`** (following the existing pattern of `scripts/seed.ts`), run manually once via `tsx scripts/<name>.ts`, not via an automatic migration that runs on deploy. This is a conscious tradeoff: it requires a human to remember to run the backfill, but avoids the operational risk of an automatic migration running against production data unattended and requires no new tooling/dependency. **Any backfill script must be idempotent** (safe to re-run, e.g. by checking `if (doc.newField != null) return` before writing) — the same idempotency discipline already used for money-moving operations elsewhere in this codebase (e.g. deposit approval's `idempotencyKey`), applied here to one-time data migrations instead of runtime actions.
3. **Removing or renaming a field is never done in the same change as adding its replacement.** The convention is: add the new field (optional), backfill it, update all application code to read/write the new field, deploy and verify in production, and only *then* — in a later, separate change — stop writing the old field. The old field can usually be left in place indefinitely (MongoDB does not charge a meaningful cost for an unused field on existing documents, and Mongoose simply ignores schema fields not present in the model definition) rather than requiring a cleanup migration at all. This is the same reasoning documented in `docs/IMPLEMENTATION_PLAN.md` Phase 2.1 for `Service.providerId`/`providerServiceId`/`providerRate`: recommended to be kept deprecated-but-present after a `ServiceProvider` linking model backfill, not removed.
4. **Index changes** (adding/changing a compound index in a Mongoose schema) take effect the next time Mongoose's `autoIndex` behavior runs (development) or must be applied explicitly in production — **`autoIndex` should be disabled in production** (building an index synchronously on app startup against a large production collection is a real operational risk: it can hold a lock and cause timeouts) in favor of running `Model.syncIndexes()` or the equivalent `createIndex` command manually/via a deploy-time script during a maintenance window. **This is a currently-undocumented-until-now operational step** — verify `lib/db.ts`'s Mongoose connection options before a production deploy that changes any index, and add an explicit index-application step to the deployment checklist in `PRODUCTION_READINESS.md` if one doesn't already cover it.
5. **There is no rollback mechanism beyond "add another additive change that reverts the behavior."** Because changes are additive-only by convention, a "rollback" in practice means redeploying the previous application code (which simply ignores the new field) rather than un-doing a destructive schema change — this is a direct benefit of the additive-only discipline above, not a separate mechanism that needed building.

**When this convention would need to change:** if the collection sizes ever grow large enough that manual backfill scripts become impractically slow (i.e. minutes-to-hours instead of seconds), or if the team grows past a size where "remember to run the backfill script" is a reliable process, introduce a proper migration tool (e.g. `migrate-mongo`) at that point — there is no need to add that complexity pre-emptively at the current scale.

## 9. Backup & Recovery

- **No backup automation exists in this codebase, and none is needed as application code** — backups are configured at the MongoDB Atlas project level (Atlas offers continuous/cloud backups with point-in-time recovery on paid tiers, M10 and above; the free M0 tier has more limited backup options and should not be relied on for anything beyond development). This is a genuine, permanent architectural boundary, not a gap waiting on more code — no amount of code in this repo can enable a per-cluster Atlas console setting.
- **Documented, concrete steps for enabling and verifying it** now exist in [`PRODUCTION_READINESS.md` §13](PRODUCTION_READINESS.md#13-database-backup--recovery--disaster-recovery): exact Atlas console steps to enable Cloud Backup + point-in-time recovery with a retention policy, plus `scripts/verify-restore.ts` — a script that compares a live database against a restored one (per-collection document counts, a `Wallet.balance` grand-total consistency check, and a concrete data-loss-window report) instead of an ad-hoc manual spot-check. `docs/INCIDENT_RESPONSE.md` §7 has the operational restore runbook (who restores, from where, how `MONGODB_URI` is repointed at a restored cluster).
- **Still genuinely open** (see `PRODUCTION_READINESS.md` §13's own honest callout): the actual Atlas Cloud Backup enablement and a real restore-to-a-new-cluster drill are per-project operational actions in the Atlas console tied to your billing tier — no one has performed them for this project yet. `verify-restore.ts` itself has been verified against both local test databases and this project's real production Atlas data, but not yet against a genuine Atlas-restored snapshot.

## 10. Performance & Scalability Notes

- Every list-view query used by the UI is backed by a matching compound index (§5) — this was verified by cross-referencing each `.find().sort().skip().limit()` call against the declared indexes while writing this document, not assumed.
- `Decimal128` fields are slightly heavier to index/compare than native numbers, but were chosen deliberately for correctness (see `ARCHITECTURE.md` §11) — this is an accepted, intentional tradeoff at the current scale.
- MongoDB Atlas connection pooling is capped client-side at `maxPoolSize: 10` (`lib/db.ts`) — appropriate for a small-to-medium serverless/traditional deployment; revisit if horizontally scaling to many server instances simultaneously (each instance holds its own pool up to this cap).

## 11. Design Decisions & Rationale (summary)

| Decision | Rationale |
|---|---|
| `Decimal128` over `Number` for all money fields | Prevents floating-point rounding errors in financial calculations; carried over as an explicit lesson from the project's original (abandoned) Prisma/PostgreSQL `Decimal` design. |
| Application-enforced referential integrity | MongoDB has no native FK constraints; acceptable tradeoff given the service layer already centralizes all writes and can enforce existence checks consistently. |
| Optimistic concurrency (`Wallet.version`) inside transactions, not just transactions alone | A transaction guarantees atomicity/isolation of the writes it contains, but does not by itself prevent two transactions from both reading the same stale balance before either commits; the version-guarded update closes that gap. |
| TTL index instead of a scheduled cleanup job for `VerificationToken` | Native MongoDB feature, zero additional operational surface (no cron job to fail or forget to run). |
| Embedded `messages` array on `SupportTicket` instead of a `Message` collection | Messages are always read/written with their parent ticket; embedding avoids a join for the single access pattern that exists. |
| No hard deletes on money/audit-relevant collections | Compliance and incident-response requirement — an admin or attacker action must remain reconstructable after the fact. |
