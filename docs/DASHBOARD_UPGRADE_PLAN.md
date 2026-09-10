# Dashboard Upgrade Plan — Admin Panel & Customer Dashboard (Phase 5)

This is a dedicated planning doc for a dashboard-focused improvement pass,
requested directly by the project owner: "advanced, all-in-one" admin
dashboard/panel, plus a richer post-login customer dashboard. It follows the
same phased structure as `docs/IMPLEMENTATION_PLAN.md` (Phases 0–4, all
shipped) — this is **Phase 5**, purely additive on top of that work. No
existing money-movement logic (`lib/services/*`, `lib/money.ts`) is touched;
every item here is presentation/aggregation/new-surface work that reads from
or lightly extends the existing schema.

**Scope confirmed with the project owner:** cover analytics/charts, deeper
admin operations, and a richer customer experience, and include an in-app
notification system touching both dashboards. Plan first, then implement the
highest-priority items in the same session.

## 0. Current State (baseline, verified by reading the code)

- **Admin (`/admin/**`, English-only, no `next-intl`):** a single overview
  page with 4 raw count `StatCard`s (users/orders/pending payments/open
  tickets), plus CRUD-style list pages for users, service groups,
  categories, services, providers, service-provider links, orders, payments,
  settings, and support. No charts, no date-range filtering, no bulk
  actions, no audit-log viewer UI (even though `AuditLog` already records
  30+ action types), no financial reporting/export, no provider health
  monitoring beyond a manually-displayed cached `balance` string.
- **Customer (`/[locale]/dashboard/**`, `en`/`bn` via next-intl):** a home
  page with 3 stat cards (wallet balance, total orders, active orders), plus
  services/orders/wallet/support/telegram/api-keys pages. No order-status
  timeline UI (even though `Order.statusHistory` already stores one), no
  notifications, no profile/security settings page, no spending
  chart/insights, no referral system.
- **Shared infrastructure already in place that this plan reuses rather than
  rebuilds:** `getDisplayMoney`/`getDisplayMoneyBatch` (dual-currency
  display), `StatusBadge`, `recordAudit`/`AuditLog`, the
  `Sidebar`/`MobileNav`/`useDashboardNavItems` pattern (customer side) and
  `AdminSidebar` (admin side), `lib/telegram/notify.ts` (existing Telegram
  push notifications — the new in-app notification system is a
  complementary in-app inbox, not a replacement).

## 1. New shared building blocks (build once, used everywhere)

These are prerequisites several items below depend on — sequencing them
first avoids rework.

### 1.1 Charting library

**Decision: `recharts`** (peer-compatible with React 19, MIT license, no
extra CSS/theme system to fight with Tailwind, works fine as a Client
Component island inside Server Component pages). Added as a normal
dependency, used only inside small `"use client"` chart wrapper components
so the surrounding pages stay Server Components fetching data server-side
and passing plain serializable arrays as props (matching this project's
existing convention everywhere else — see `OrdersTable`, `UsersTable`,
etc.).

### 1.2 Aggregation query layer

New `lib/services/analytics.ts` (server-only, mirrors the existing
`lib/services/*` module style) with small, purpose-built Mongo aggregation
functions — deliberately NOT a generic "reporting engine," just the exact
queries the dashboards below need:

- `getRevenueSeries(days)` — daily revenue (`Transaction` type
  `ORDER_PAYMENT`, summed) and daily new-order count, for the last N days,
  using `$group` on a truncated `createdAt` day boundary.
- `getUserGrowthSeries(days)` — daily new-user signups.
- `getOrderStatusBreakdown()` — count of orders per `OrderStatus`, for a
  donut/bar chart.
- `getTopServices(limit)` — top services by order count and by revenue in
  the last 30 days (two small aggregations, or one with `$facet`).
- `getProviderHealthSummary()` — per-provider: active service count, orders
  in the last 24h, last dispatch error (`lastError`) if any, cached
  `balance`/`lastBalanceSyncAt`.
- `getUserSpendingSeries(userId, days)` — the customer-dashboard analog of
  `getRevenueSeries`, scoped to one user, for the new "Spending Insights"
  card.

All Decimal128 money values are converted to plain numbers via
`decimalToNumber()` (already in `lib/money.ts`) before being handed to a
chart component — charts never need currency-safe arithmetic, only display.

### 1.3 In-app notification system

New `models/Notification.ts`:

```ts
interface INotification {
  _id: ObjectId;
  userId: ObjectId;       // recipient — admins get their own rows too
  type: NotificationType; // e.g. "ORDER_STATUS_CHANGED", "DEPOSIT_APPROVED",
                           //      "TICKET_REPLIED", "NEW_ORDER" (admin),
                           //      "NEW_DEPOSIT" (admin), "NEW_TICKET" (admin)
  title: string;
  body: string;
  href: string | null;     // where clicking it should navigate
  read: boolean;
  readAt: Date | null;
  createdAt: Date;
}
```

Indexes: `{ userId: 1, read: 1, createdAt: -1 }` (unread-count query + list
query), `{ userId: 1, createdAt: -1 }`.

New `lib/services/notifications.ts`: `createNotification()`,
`markAsRead(id, userId)`, `markAllAsRead(userId)`,
`getUnreadCount(userId)`, `getRecentNotifications(userId, limit)`. Called
from the exact same call sites that already call `lib/telegram/notify.ts`
functions (order placed/status changed, deposit submitted/approved/rejected,
ticket created/replied) — one new `createNotification(...)` call
alongside each existing `notifyX(...).catch(...)` call, same
fire-and-forget, never-throws pattern (wrapped internally, consistent with
`recordAudit`'s own established convention).

UI: a shared `<NotificationBell>` client component (badge with unread
count, dropdown panel listing recent notifications, "mark all read"), added
to both `DashboardHeader` (customer) and `AdminHeader` (admin). Polls
`GET /api/notifications?unread=true&limit=1` for the count every ~30s
(simple `setInterval` + `fetch`, no WebSocket infra needed for this
project's scale — consistent with the project's existing no-extra-infra
philosophy; a true real-time push (SSE/WebSocket) is called out as a
future upgrade in §5, not part of this pass).

New routes: `GET /api/notifications` (list, paginated),
`PATCH /api/notifications/[id]` (mark one read),
`POST /api/notifications/read-all`.

## 2. Admin Panel — "Advanced" Feature Additions

### 2.1 Overview page → real analytics dashboard

Replace the 4 flat `StatCard`s on `/admin` with:
- The same 4 stat cards, now with a small trend delta (e.g. "+12% vs. last
  7 days") computed from `getRevenueSeries`/`getUserGrowthSeries`.
- A revenue + order-count dual-axis line/area chart (last 30 days, `recharts`
  `<ComposedChart>`), with a period selector (7/30/90 days) that
  re-fetches via a small client wrapper (`"use client"` chart component +
  a `GET /api/admin/analytics/revenue?days=N` route).
- An order-status donut chart (`getOrderStatusBreakdown`).
- A "Top Services" table (order count + revenue, last 30 days).
- A "Recent Activity" feed pulling the latest 10 `AuditLog` rows (see 2.2 —
  this reuses that same query/formatting).

### 2.2 Audit log viewer (net-new page, `/admin/audit-log`)

`AuditLog` already records 30+ action types with actor/target/metadata but
has **zero UI** to view it today — the only way to inspect it is a raw DB
query. New page:
- Paginated table: timestamp, actor (email), action (human-readable label,
  color-coded by category: security/financial/content/telegram), target
  type + id (linked where a corresponding admin page exists, e.g. an
  `Order` target links to that order), and an expandable metadata JSON
  view.
- Filters: action type (dropdown grouped by category), actor email search,
  date range.
- New `GET /api/admin/audit-log` route (paginated, filtered), reusing the
  exact same auth-guard pattern as every other `/api/admin/*` route.
- Add "Audit Log" to `AdminSidebar`.

### 2.3 Bulk actions on Orders/Users/Payments tables

Current admin tables (`OrdersTable`, `UsersTable`, `PaymentsTable`) only
support one-row-at-a-time actions. Add:
- Row checkboxes + "select all on page."
- Orders: bulk status transition (e.g. bulk-cancel a batch of stuck
  `PENDING` orders), bulk export-selected-to-CSV.
- Payments: bulk-approve a batch of pending deposits (still goes through
  the existing single-payment `approveDeposit()` transaction function per
  row — bulk here means "loop client-side calls, show per-row
  success/failure," NOT a new bulk-transaction code path, to avoid touching
  the money-movement invariants documented in `MEMORY.md`).
- Users: bulk status change (e.g. suspend a batch).
New small `lib/services/admin-bulk.ts` only where a genuinely new
server-side batch operation is warranted (e.g. bulk order cancel, which
doesn't already exist as a single-row admin action either); everything
else composes existing single-item functions.

### 2.4 Advanced filters & search across admin list pages

Orders/Users/Payments/Support currently only support status filtering (or
none at all client-visibly). Add a consistent `AdminFilterBar` component:
- Text search (order target / user email-name / payment ref).
- Date range picker.
- Status multi-select.
- Persisted in the URL query string (so a filtered view is shareable/
  bookmarkable and survives a page refresh) — extends the existing
  `?page=&limit=&status=` pattern already used by `/api/admin/orders`.

### 2.5 Financial reports & CSV export

New `/admin/reports` page:
- Date-range revenue/deposit/refund summary (reuses `getRevenueSeries` plus
  new small aggregations for deposits and refunds in the same style).
- "Export CSV" buttons for orders, transactions, and payments within a
  chosen date range — a `GET /api/admin/export/{orders|transactions|payments}
  ?from=&to=&format=csv` route that streams a CSV response (no new
  dependency needed — hand-rolled CSV serialization of already-`.lean()`ed
  documents is trivial and avoids pulling in a CSV library for ~5 columns).

### 2.6 Provider health monitoring

New `/admin/providers` page section (extends `providers-manager.tsx`, not a
new page) showing, per provider: cached `balance` + `lastBalanceSyncAt` age
(with a visual "stale" warning if > 24h old), orders dispatched in the last
24h, and the most recent `lastError` string across any of its dispatched
orders (`Order.find({ providerId, lastError: { $ne: null } })
.sort({ lastAttemptAt: -1 }).limit(1)`). Read-only surfacing of data that
already exists on `Order`/`Provider` — no new balance-sync mechanism is
built in this pass (a real balance-sync-from-provider-API job is called out
as a future item in §5, since it requires per-provider-type API work that's
its own scoped effort).

### 2.7 Admin quick-actions / command palette (nice-to-have polish)

A `Cmd/Ctrl+K` quick-open palette (client-only, no server dependency) for
jumping to any admin section or a specific order/user/payment by
ID/email — small, self-contained, high perceived-"advanced" value for
low effort.

## 3. Customer Dashboard — Richer Post-Login Experience

### 3.1 Order tracking timeline (uses already-stored data, currently unused)

`Order.statusHistory` (array of `{status, note, at}`) is written on every
transition today but **never rendered anywhere**. Add an expandable
timeline view per order on `/dashboard/orders` (click a row → inline
expand or a `/dashboard/orders/[id]` detail page) showing each history
entry as a vertical stepper (icon + status + note + relative timestamp),
using the existing `StatusBadge` styling language for consistency.

### 3.2 Dashboard home → richer overview

Extend the current 3-stat-card home page with:
- A personal spending chart (last 30/90 days, `getUserSpendingSeries`),
  small `recharts` area chart.
- "Recent Orders" mini-list (last 5, with `StatusBadge` and a "View all"
  link) — currently the home page has zero order visibility beyond counts.
- "Recent Activity" mini-feed (own order status changes + deposit
  approvals), reusing the new notification feed component in read-only
  compact mode.

### 3.3 Profile & security settings page (net-new, `/dashboard/settings`)

Nothing like this exists today (no way to change name, change password, or
review one's own login history from the UI). Add:
- Edit display name.
- Change password (current + new, re-validated against the existing
  `passwordSchema` from `lib/validation.ts`).
- Show `lastLoginAt`/`lastLoginIp` (already stored on `User`, currently
  invisible to the user).
- Show linked Telegram status (links to the existing `/dashboard/telegram`
  page rather than duplicating it).
New `PATCH /api/account` route (name update) and
`POST /api/account/change-password` route (current-password re-check +
`passwordSchema` validation + bcrypt rehash), both audited
(`recordAudit`) with a new `ACCOUNT_UPDATED`/`PASSWORD_CHANGED_BY_USER`
`AuditAction`.

### 3.4 Notifications (shared with §1.3, customer-facing surface)

Bell icon in `DashboardHeader`; notification center covers: order placed/
status changed/completed, deposit approved/rejected, refill
resolved, support ticket replied. This is the customer half of the
shared system built in §1.3.

### 3.5 Referral / affiliate program (larger, separate scope decision)

Flagged as valuable but **intentionally scoped as a future phase, not
built in this pass** — it needs new schema (`ReferralCode`, referral
attribution on `User`/`Order`, a commission/payout model) and product
decisions (commission %, payout mechanism, fraud guards) that go well
beyond a dashboard UI upgrade. Recommendation: revisit as its own
dedicated planning doc (`docs/REFERRAL_PLAN.md`) once/if prioritized,
following this same pattern.

### 3.6 Saved/favorite services (small, low-risk addition)

New `favoriteServiceIds: ObjectId[]` field on `User` (or a small join
collection if we want per-favorite timestamps — a plain array on `User` is
simpler and sufficient at this scale), a star toggle on the service catalog
(`/dashboard/services`), and a "Favorites" filter/section there. Small,
self-contained, no money/ledger implications.

## 4. Sequencing & Priority

```
Priority 1 (highest value, do first):
  1.1 recharts dependency + 1.2 lib/services/analytics.ts   ── prerequisite for 2.1, 3.2
  2.1 Admin overview → analytics dashboard                  ── biggest "advanced/all-in-one" visual win
  3.1 Order tracking timeline                                ── uses data already collected, zero new schema
  3.2 Customer dashboard home upgrade                        ── depends on 1.2

Priority 2 (high value, moderate effort):
  1.3 Notification system (schema + service + bell UI, both dashboards)
  2.2 Audit log viewer                                       ── AuditLog data already exists, pure UI+route gap
  2.4 Advanced filters & search on admin tables

Priority 3 (valuable, do after the above are verified):
  2.3 Bulk actions
  2.5 Financial reports & CSV export
  2.6 Provider health monitoring
  3.3 Profile & security settings page

Priority 4 (polish / smaller wins):
  2.7 Admin command palette
  3.6 Saved/favorite services

Deferred to a future dedicated plan (not in this pass):
  3.5 Referral/affiliate program
  Real-time push (SSE/WebSocket) upgrade to the notification system (§1.3 uses polling for now)
  Automated provider-balance-sync job (§2.6 is read-only surfacing only)
```

**This session's build target:** all of Priority 1, plus as much of
Priority 2 as time allows (notification system end-to-end, audit log
viewer) — verified with `npm run typecheck`/`lint`/`test`/`build` after
each major addition, consistent with this project's established
verification discipline.

**Status as of this session's end:**
- ✅ **Priority 1 — fully delivered and live-verified:** `lib/services/analytics.ts`,
  admin overview (`/admin`) analytics dashboard (revenue/order chart,
  order-status donut, top-services table, recent-activity feed), order
  tracking timeline on `/dashboard/orders` (renders `Order.statusHistory`
  via `OrderTimelineToggle`), and the customer dashboard home upgrade
  (`/dashboard`: wallet/orders/active stat cards, `SpendingChart` fed by
  `getUserSpendingSeries`, "Recent Orders" mini-list). All confirmed
  working against the real dev server with a real login session (not just
  typecheck/build) — see the two bugs found and fixed during that
  verification pass below.
- ✅ **Priority 2 (partial) — notification system + audit log viewer fully
  delivered and live-verified:** `models/Notification.ts`,
  `lib/services/notifications.ts`, `GET/PATCH /api/notifications*` routes,
  shared `<NotificationBell>` in both admin and customer headers, and
  fan-out/creation wired into every event site (order placed, deposit
  submitted/approved/rejected, admin order status/refund/refill actions,
  support ticket created, support ticket replied — in both directions:
  customer→admin fan-out and admin-reply→customer). Verified end-to-end
  live: created a real ticket as a test customer → confirmed the admin
  account received a `NEW_TICKET` notification via `GET /api/notifications`;
  replied as admin → confirmed the customer received `TICKET_REPLIED`.
  `/admin/audit-log` (page + `AuditLogViewer` + backing route) also
  confirmed rendering live with real data.
- ✅ **Priority 2 item 2.4 (Advanced filters & search on admin tables) —
  delivered and live-verified in a later session** (see `MEMORY.md` §7h).
  New shared `lib/admin-query.ts` (`parseListQuery`/`parseStatusList`/
  `parseDateRange`/`escapeRegExp`, unit-tested — 19 tests) used by both the
  server-component list pages (`/admin/orders`, `/admin/users`,
  `/admin/payments`, `/admin/support`) and their backing `/api/admin/*`
  routes, so filter semantics can never drift between the two. New shared
  `AdminFilterBar` (text search + status multi-select pills + date range,
  all URL-query-string-persisted, extending the pre-existing
  `?page=&limit=&status=` pattern) and `AdminPagination` components, reused
  identically across all four admin list pages. Search matches
  case-insensitively against the natural free-text field per table
  (order target, user name/email, payment reference, ticket subject) OR
  the linked user's name/email where applicable, with regex-injection-safe
  escaping. Live-verified against the real MongoDB Atlas data: status-pill
  filtering, text search, and pagination all confirmed working via direct
  API calls and full-page Playwright screenshots.
- ✅ **Priority 3 item 3.3 (Profile & security settings page) and Priority 4
  item 3.6 (Saved/favorite services) — delivered and live-verified in a
  later session** (following an explicit user pivot away from further
  security/authorization work toward new features + UI/UX polish; see
  `MEMORY.md` §7g for the full session record). New `/dashboard/settings`
  page (`AccountSettingsPanel`) with three sections: profile (display-name
  edit via `PATCH /api/account`), password change (current-password-gated,
  reuses `passwordSchema`, via `POST /api/account/change-password`), and a
  read-only account-info panel finally surfacing `lastLoginAt`/
  `lastLoginIp` and Telegram-link status — both fields already existed on
  `User` but had no UI anywhere before this. New `favoriteServiceIds`
  array field on `User`, a `GET/POST/DELETE /api/favorites` toggle route,
  and a star-icon toggle button next to the service selector on
  `/dashboard/services` (`OrderForm`) that also sorts favorited services
  to the top of the dropdown. New `AuditAction`s: `ACCOUNT_UPDATED`,
  `PASSWORD_CHANGED_BY_USER`, `FAVORITE_SERVICE_ADDED`,
  `FAVORITE_SERVICE_REMOVED` (all wired into `lib/audit-labels.ts` and the
  admin audit-log viewer's filter list). Both features localized (`en`/
  `bn`). Live-verified with a real login session against the real
  MongoDB Atlas connection (not just typecheck/build): profile update,
  password-change form rendering, and the favorite star toggle's
  persistence (add → appears in `GET /api/favorites` → remove → gone)
  were all confirmed working, plus a full-page screenshot of the new
  settings page and the favorited-service dropdown state.
- ✅ **Priority 3 item 2.5 (Financial reports & CSV export) — delivered and
  live-verified in the same later session.** New `getFinancialReportRows(from, to)`
  in `lib/services/analytics.ts` (per-day revenue/order-count/refund
  aggregation for an arbitrary custom date range, distinct from
  `getRevenueSeries`'s rolling-window shape) backs a new `/admin/reports`
  page (`ReportsPanel`: date-range picker, revenue/orders/refunds/deposits
  summary cards, per-day table). New generic `lib/csv.ts` (`toCsv`/
  `escapeCsvField`, unit-tested — 11 tests, OWASP CSV-formula-injection
  safe, mirrors the escaping rules already established in
  `lib/services/financial-report.ts`) backs three new streaming CSV export
  routes — `GET /api/admin/export/{orders|payments|transactions}?from=&to=`
  — each capped at 10,000 rows and audited via a new `DATA_EXPORTED`
  `AuditAction`. Live-verified: exported real CSVs from all three routes
  against the live MongoDB Atlas data and confirmed correct headers/rows.
- ✅ **Priority 3 item 2.6 (Provider health monitoring) — delivered and
  live-verified in the same later session.** `getProviderHealthSummary()`
  already existed in `lib/services/analytics.ts` from an earlier session
  but was never wired into any page — closed that gap with a new
  `ProviderHealthPanel` (server component) rendering per-provider cards on
  `/admin/providers`: type, 24h dispatch count, cached balance with a
  stale-after-24h warning icon, and the most recent `lastError` (or a
  green "None" state). Purely read-only surfacing of existing
  `Order`/`Provider` fields — no new balance-sync mechanism, per the
  plan's own scope note. Live-verified via Playwright screenshot with a
  real seeded provider showing the balance-stale warning correctly.
- ✅ **Priority 4 item 2.7 (Admin command palette) — delivered and
  live-verified in the same later session.** New `CommandPalette` client
  component (Ctrl/Cmd+K global shortcut, plus a visible "Quick search"
  button in `AdminHeader` for discoverability) mounted once in
  `AdminLayout`. Two result sources: an instant client-side filter over
  the static admin section list, and a new `GET /api/admin/search?q=`
  route (small, capped-at-5-per-type lookup across Users by name/email,
  Orders by target/exact id, Payments by reference/exact id) for jumping
  straight to a specific record. Selecting a remote result navigates to
  the corresponding list page pre-filtered via the new `?search=` param
  from §2.4's `AdminFilterBar`, so the two features compose naturally.
  Live-verified via Playwright screenshot: opened via keyboard shortcut,
  typed a query, saw the matching user result render correctly.
- ✅ **2.3 bulk actions on Orders/Users/Payments tables** — delivered
  following the full ECC pipeline (Plan → TDD → Implement → Code Review →
  Security Review → Repair → Ship; see `.claude/plans/admin-bulk-actions.plan.md`
  and `MEMORY.md` for the per-stage record). Row checkboxes + "select all
  on page" on all three tables. Orders: bulk status change restricted to
  `CANCELED`/`FAILED` only (enforced at both the zod schema and service
  layer — `REFUNDED`/`COMPLETED` stay single-item, individually-reviewed
  actions, per this section's original scope note) via a new
  `PATCH /api/admin/orders/bulk` route + `lib/services/admin-bulk.ts`, plus
  a client-side "Export selected CSV" (reuses `lib/csv.ts`, no new network
  call). Payments bulk-approve and Users bulk-status-change compose the
  *existing* single-item routes via a client-side loop (`Promise.allSettled`)
  exactly as scoped below — no new bulk-transaction code path touches
  `approveDeposit()`. New `ORDER_BULK_STATUS_CHANGE` audit action. A
  Security Review finding (raw Mongoose `CastError` messages leaking
  internal schema/model details to API clients on a malformed id) was
  caught and repaired before shipping — see `lib/services/admin-bulk.ts`'s
  `OrderNotFoundError` marker-class pattern. Live-verified against the
  real dev server + real Atlas DB: real login, real bulk-cancel of two
  seeded orders, 400 on an unsafe status, 403 unauthenticated, audit-log
  entry confirmed, and a Playwright screenshot of the bulk action bar with
  2 rows selected. Test suite grew 182 unit / 29 integration (from 174/22).
  Everything else in Priority 2/3/4 was already delivered.

**Bugs found and fixed during live verification (not caught by
typecheck/lint/build, only surfaced by actually loading the pages with
real data):**
1. `/dashboard/orders` 500'd on any order created before the
   `refillStatus` field existed on the `Order` schema — Mongoose schema
   defaults only apply at document-creation time, not retroactively to
   older `.lean()`-fetched documents, so `order.refillStatus` was
   `undefined` for legacy rows and `next-intl` threw trying to look up a
   translation key from `undefined`. Fixed by defaulting to `"NONE"`
   defensively in the page component.
2. The new `OrderTimelineToggle` (a `"use client"` component) was
   originally given a `statusLabel` function prop from the server
   component — functions cannot cross the server/client boundary in RSC.
   Fixed by resolving each event's status label server-side into a plain
   string field (`TimelineEvent.statusLabel`) before passing the array of
   plain objects down, instead of passing a formatter function.
3. (Found during the §2.4/2.5/2.6/2.7 session's own verification pass,
   pre-existing since the original commit, not introduced by that work)
   `/admin/orders` and `/admin/payments` were passing populated Mongoose
   sub-documents (`order.userId`, `order.serviceId`, `payment.userId` —
   `.lean()` does not deep-plain-ify populated refs) straight through as
   props into `OrdersTable`/`PaymentsTable` (`"use client"` components).
   This silently worked at runtime (React tolerates it and renders
   correctly) but logs a dev-mode "Only plain objects can be passed to
   Client Components" console warning on every render, and is technically
   unsupported per React's own docs (an object with a `toJSON` method,
   like `ObjectId`, is not a plain object). Fixed by explicitly plucking
   only the rendered fields (`{ name, email }` / `{ name }`) into new
   plain objects before mapping into the row shape, in both page
   components — confirmed the warning is gone via a fresh dev-server
   console check post-fix.

## 5. Explicitly Out of Scope for This Pass

- No changes to money-movement transaction functions
  (`placeOrder`/`approveDeposit`/`refundOrder`/`issuePartialRefund`) — this
  is a dashboard/UI/reporting pass, not a ledger change.
- No real-time WebSocket/SSE infrastructure — polling is sufficient at this
  project's current scale and avoids a new infra dependency.
- No referral/affiliate system (separate future plan, see §3.5).
- No automated provider-balance API sync (separate future plan, see §2.6).
- No 2FA (pre-existing, separately tracked gap — see `MEMORY.md` §5).
