# Incident Response Runbook

This is the one-page-to-a-few-pages incident-response process that
[`PRODUCTION_READINESS.md` §19](PRODUCTION_READINESS.md#19-production-troubleshooting--incident-response)
flags as a gap: a formal process for *"something is actively broken in
production and real money/data is at stake,"* as opposed to
[`README.md` §13 Troubleshooting](../README.md#13-troubleshooting), which is
the developer-facing "how do I fix X" reference for known failure modes.

Use this document when you are the person who noticed (or was told) that
something is wrong in production **right now**. It assumes a small team /
single on-call person, not a large SRE org with a dedicated incident
commander rotation — scale the roles section up if the team grows.

---

## 1. Severity levels

Assign a severity the moment you start responding — even a rough guess.
It sets response urgency and who needs to know. Re-classify later if wrong.

| Sev | Definition | Examples in this app | Target response |
|---|---|---|---|
| **SEV-1 — Critical** | Site down, money is being lost/miscounted, or a security breach is in progress or confirmed. | Site returns 500s for all users; wallet balances double-debited or double-credited; database unreachable; auth bypass discovered; secrets leaked; a deposit approved twice crediting a wallet twice. | Drop everything, respond immediately, notify stakeholders within 15 min. |
| **SEV-2 — Major** | A core flow is broken for a large fraction of users, but the site is up and money isn't actively being miscounted. | Orders stuck in `PENDING` for everyone (fulfillment worker down); deposits not crediting wallets; login broken for all users; Telegram bot fully unresponsive. | Respond within 30 min, keep working until mitigated. |
| **SEV-3 — Minor** | Degraded but workable; affects a subset of users or a non-critical feature. | One provider's orders failing (others fine); email notifications delayed; admin dashboard chart broken; rate limiting misfiring for one route. | Respond same business day. |
| **SEV-4 — Low** | Cosmetic or edge-case issue, no user-facing harm. | Currency formatting glitch on one locale; a non-blocking console warning. | Fix in normal course of work, no incident process needed. |

When in doubt between two levels, pick the higher one — you can always
downgrade once you understand impact better, but under-reacting to a
money-related bug is the expensive mistake to avoid in an app that moves
real wallet balances (see [`ARCHITECTURE.md`](ARCHITECTURE.md) for how
wallet/order transactions are structured, and
[`DATABASE.md`](DATABASE.md) for the transactional guarantees involved).

---

## 2. Roles (single-person or small-team version)

There is no dedicated on-call rotation in this project today. Until there
is, whoever notices/receives the report plays all of these roles, but it
helps to consciously context-switch between them rather than only firefighting:

- **Responder** — actually investigates and mitigates.
- **Communicator** — posts status updates (even if it's just "investigating,
  update in 30 min" to yourself/a status doc) so nobody else duplicates work
  or panics from silence.
- **Scribe** — timestamps what was tried and observed, in real time, not
  reconstructed afterward. This becomes the postmortem's timeline for free.

If/when a real team exists, split these across people for SEV-1/SEV-2 so
the responder isn't also context-switching into writing updates.

---

## 3. Detection

Sentry (error tracking + performance monitoring, see
[`PRODUCTION_READINESS.md` §4](PRODUCTION_READINESS.md#4-error-tracking)
and [§6](PRODUCTION_READINESS.md#6-metrics--alerting)) is wired into the
codebase and is the primary automated detection surface once a real
`SENTRY_DSN` is configured — it is a safe no-op until then, so don't assume
it's actually catching anything in an environment where that env var was
never set. Alert rules (issue-frequency spikes, new-issue-type alerts,
performance/latency thresholds) still need to be configured by hand in the
Sentry dashboard — that one-time setup step is not itself part of this
codebase and is not yet confirmed done. A post-deploy smoke test
(`.github/workflows/post-deploy-smoke-test.yml`) also runs automatically
after every production deploy and fails loudly if `GET /api/health`
doesn't return 200. Until Sentry alerting is actually configured, treat
these as your detection surfaces:

- **`GET /api/health`** (`app/api/health/route.ts`) — liveness/readiness
  probe; returns `503` when Postgres/Supabase is unreachable. Point an external
  uptime monitor (even a free one) at this today — it costs nothing and
  closes the biggest gap (finding out the site is down from a user
  complaint instead of a monitor). Already checked automatically
  post-deploy by `.github/workflows/post-deploy-smoke-test.yml`, but that
  only covers the moment right after a deploy, not ongoing uptime.
- **Structured logs** (`lib/logger.ts`, pino-based) — every API route logs
  errors with request context. If deployed somewhere with log aggregation
  (even just `docker logs` / platform log viewer), `grep`/filter for
  `"level":50` (error) or `"level":60` (fatal).
- **User/support reports** — support tickets (`SupportTicket` model,
  `/admin/support`) and direct reports are, realistically, the primary
  detection method today. Take a cluster of similar reports in a short
  window seriously even before you've reproduced it yourself.
- **`AuditLog` table** (`prisma/schema.prisma`) — for "did an admin
  action cause this," check recent entries for the affected resource
  (e.g. `targetType: "Order"`, `targetId: <id>`) before assuming it's a
  code bug.
- **Background job output** — `process-orders`, `poll-order-status`, and
  `compute-delivery-estimates` (`scripts/*.ts`, run via cron/scheduler in
  production) log to stdout/the same structured logger; if orders are
  stuck, check whether these are actually running, not just whether the
  web process is up.

---

## 4. First response checklist (any SEV-1/SEV-2)

Work through this before diving into root-causing — the goal in the first
few minutes is *triage and stop the bleeding*, not necessarily a full fix.

1. **Note the start time.** You'll need it for the postmortem timeline and
   to bound "how far back do I need to check/restore."
2. **Check `GET /api/health`.** Is the process up? Is the DB reachable?
   This alone separates "app bug" from "infra outage."
3. **Check Supabase project status** (Database → Reports / the project's health metrics in the Supabase Dashboard) — connection pool exhaustion (check active connections against the pooler's limit), disk space, and CPU spikes show up there before they show up as app errors.
4. **Check recent deploys.** Did this start right after a deploy? If yes,
   the fastest mitigation for SEV-1 is usually **rollback**, not a forward
   fix under pressure — root-cause afterward with time pressure removed.
5. **Check recent admin actions** via `AuditLog` if the report is about a
   specific order/user/wallet — rule out "this was an intentional admin
   action, not a bug" first.
6. **If money/wallet integrity is in question**, stop and read
   [§5 below](#5-money--wallet-incidents-treat-as-sev-1) before taking any
   corrective action — wallet/order writes are transactional
   (see [`DATABASE.md`](DATABASE.md#6-transactions) for exactly which
   operations are wrapped in a `prisma.$transaction`) and the safe
   fix is almost always "credit/debit a compensating entry," never
   "directly edit a balance field."
7. **Communicate status** — even a one-line "investigating a SEV-1, orders
   not processing, update in 30 min" prevents duplicate effort and panic.
8. **Mitigate before root-causing** where possible: rollback a bad deploy,
   restart a wedged background worker, temporarily pause a misbehaving
   `ServiceProvider` from the admin dashboard (see §6.2 below), or flip
   `Settings.registrationEnabled`/similar admin kill switches — anything
   that stops user-facing harm buys time to find the real fix safely.

---

## 5. Money / wallet incidents: treat as SEV-1

This app moves real money (wallet top-ups, order charges, refunds), so
incidents touching `Wallet`, `Payment`, or `Order.charge`/`refund` fields
deserve extra care:

- **Never hand-edit a wallet balance directly in the database.** Every
  legitimate balance change already goes through a service function that
  writes a corresponding ledger-style record and uses a Postgres transaction
  (`prisma.$transaction`; `lib/services/payments.ts`, `lib/services/admin-payments.ts`,
  `lib/services/refunds.ts`, `lib/services/orders.ts` — see
  [`DATABASE.md` §6](DATABASE.md#6-transactions)).
  If a balance is wrong, the fix is to run/replay the correct service
  function (or write a one-off script that calls it) so the audit trail
  stays consistent — not a manual `$set`.
- **Reconcile before compensating.** Before crediting/debiting anyone,
  confirm the actual discrepancy by comparing `Wallet.balance` against the
  sum of related `Payment`/`Order` records for that user — see the
  reconciliation approach already described in
  [`DATABASE.md`](DATABASE.md) for the wallet/payment relationship.
- **Deposits in this app are manual-submission + admin-approval, not an
  automated payment-provider webhook** (see
  [`WORKFLOWS.md` §4](WORKFLOWS.md#4-business-workflow-deposit-submission--approval)):
  a customer submits a `transactionRef` (`submitDeposit`,
  `lib/services/payments.ts`) which sits as `Payment.status: PENDING`
  with **no wallet credit yet**, until an admin explicitly approves it
  (`approveDeposit`, `lib/services/admin-payments.ts`). A "deposit not
  crediting" report is therefore almost always either (a) it's still
  genuinely awaiting admin approval — check the admin deposits queue
  first, this is not a bug — or (b) the approval action itself is
  erroring; check logs around `approveDeposit`'s atomic claim
  (`updateMany({ where: { id, status: "PENDING" }, ... })`), which fails closed with
  `ALREADY_PROCESSED` if the payment was already actioned by someone else.
- **Duplicate-credit reports**: `submitDeposit` rejects a resubmitted
  `transactionRef` outright (unique index + explicit existence check,
  `DUPLICATE_REFERENCE`), and `approveDeposit`'s atomic
  `status: PENDING` claim structurally prevents the same payment being
  approved twice (double-click, or a race between a web admin and a bot
  admin action) — see [`WORKFLOWS.md` §4](WORKFLOWS.md#4-business-workflow-deposit-submission--approval).
  A duplicate wallet credit observed in practice is therefore a real bug
  in one of those two guards — root-cause it there, don't just debit the
  difference back and move on without finding out how the guard was
  bypassed.

---

## 6. Common scenario playbooks

### 6.1 Site fully down (SEV-1)
1. `GET /api/health` — if it 503s or times out, this is likely
   DB-connectivity or the process itself, not application logic.
2. Check the hosting platform's status page (Vercel) and your deploy's
   build/runtime logs for crash loops. If `.github/workflows/post-deploy-
   smoke-test.yml` failed on the most recent deploy, that's your fastest
   signal — check the Actions tab before digging elsewhere.
3. Check the Supabase project's status/health metrics for an outage or maintenance window, and confirm `DATABASE_URL`/`DIRECT_URL` still resolve (a common self-inflicted cause: a rotated Supabase database password, or `DATABASE_URL` accidentally pointing at the non-pooled direct connection string under serverless traffic — see [`DATABASE.md` §10](DATABASE.md#10-performance--scalability-notes)).
4. **If caused by a recent deploy, roll back immediately.** If the
   `AUTO_ROLLBACK_ENABLED` repository variable is turned on (see
   [`PRODUCTION_READINESS.md` §14](PRODUCTION_READINESS.md#14-cicd-pipeline-readiness)),
   a failed post-deploy smoke test already attempted this automatically —
   check the Actions run log for whether it succeeded before doing
   anything else. Otherwise (or if the automated attempt itself failed),
   roll back manually: Vercel dashboard → Deployments → find the last
   known-good deployment → "Promote to Production". This takes effect
   immediately without a rebuild. Do this before investigating root cause
   if the site is fully down — restore service first, debug second.

### 6.2 Orders stuck in PENDING/PROCESSING for everyone (SEV-2)
1. **Check for an automated alert first**: `GET /api/cron/process-orders` now runs a built-in queue-depth check after every invocation (`lib/services/jobs.ts#checkQueueDepth`, see `docs/PRODUCTION_READINESS.md` §6) and responds `503` — failing that scheduled GitHub Actions run — if either too many orders are stuck in `PROCESSING` past 15 minutes, or the `PENDING` backlog exceeds 20. If `.github/workflows/cron.yml`'s `process-orders` job failed with this alert, the response body (visible in the workflow run log) already tells you `staleProcessingCount`/`pendingBacklogCount` — skip straight to step 3 (provider outage) below if `staleProcessingCount > 0`, or step 2 (confirm the scheduler is actually running) if `pendingBacklogCount` is the one that's elevated.
2. Confirm the background jobs are actually running. On this project's
   actual deployment target (Vercel), that means `GET /api/cron/process-
   orders` and `/api/cron/poll-order-status` (backed by
   `lib/services/jobs.ts`, same logic as the original
   `scripts/process-orders.ts`/`scripts/poll-order-status.ts`) are being
   invoked on schedule by `.github/workflows/cron.yml` (GitHub Actions) —
   check that workflow's run history in the Actions tab for recent
   successful runs, not just whether the web app is up. A run failing
   with a 401/403 usually means `CRON_SECRET` drifted out of sync between
   the Vercel project env var and the `CRON_SECRET` GitHub Actions
   repository secret. If instead you're running the original long-lived
   CLI scripts (non-Vercel deployment), check that process's own
   logs/uptime.
3. Check `lib/fulfillment.ts` logs for repeated errors calling out to a
   specific provider — a single provider outage can look like "everything
   is stuck" if that provider handles most volume.
4. If one provider is down, consider temporarily pausing new orders routed
   to it (`ServiceProvider` admin toggle) while it recovers, rather than
   letting orders queue up and retry indefinitely.

### 6.3 Deposits not crediting wallets (SEV-1 — money-adjacent)
Remember deposits here are manual-approval, not an automated webhook (see
§5 above) — start by ruling out "it's just sitting in the queue":
1. Check the admin deposits queue for `Payment` documents still
   `PENDING` — if a real backlog has built up, this may just be an
   admin-side process gap, not a code bug.
2. If a specific deposit was approved (admin confirms clicking Approve)
   but the wallet wasn't credited, check logs around `approveDeposit`
   (`lib/services/admin-payments.ts`) for the transaction failing/rolling
   back after the status flip — that would leave `Payment.status:
   COMPLETED` with no matching `Wallet` credit, an inconsistent state
   worth checking for directly.
3. Follow §5 above for any compensating action — replay the real
   `approveDeposit` logic for the specific affected payment id; do not
   hand-edit `Wallet.balance`.

### 6.4 Suspected security incident (auth bypass, leaked secret, data exposure) — SEV-1
1. **Contain first.** If a secret leaked (API key, `AUTH_SECRET`, DB
   credentials), rotate it immediately — containment beats analysis here.
   Rotating `AUTH_SECRET` invalidates all existing sessions; that's an
   acceptable, expected cost.
2. If it's a code-level auth bypass, the fastest containment is often
   disabling the affected route/feature (feature-flag or quick deploy)
   while the real fix is prepared and reviewed properly — do not skip
   the Security Review stage (peer code review focused on
   auth/authz/injection/secrets handling)
   for the actual fix just because it's urgent; a rushed, unreviewed
   security patch is how second bugs get introduced.
3. Check `AuditLog` and any available request logs for the actual extent
   of exploitation (what was accessed/changed, by whom, in what window)
   before deciding what user-facing disclosure is needed.
4. Preserve logs/evidence before they roll off retention — copy relevant
   log windows out of the aggregator before acting further, if there's
   any chance you'll need them later.

### 6.5 Telegram bot unresponsive (SEV-2/3 depending on how central bot ordering is for your users)
1. Check `scripts/run-bot-polling.ts` (or the webhook path if
   `telegram:webhook` mode is used instead — see
   `scripts/setup-telegram-webhook.ts`) is actually running.
2. Check Telegram's own status page — bot API outages happen independently
   of this app.
3. Confirm `TELEGRAM_BOT_TOKEN`/`TELEGRAM_WEBHOOK_SECRET` haven't been
   rotated/invalidated on Telegram's side without updating the app's env.

---

## 7. Backup & restore reference

There is **no backup automation in this codebase** — see
[`DATABASE.md` §9](DATABASE.md#9-backup--recovery) and
[`PRODUCTION_READINESS.md` §13](PRODUCTION_READINESS.md#13-database-backup--recovery--disaster-recovery).
Restore relies entirely on whatever the production Supabase project's
plan provides:

1. **Before touching anything destructive**, confirm your Supabase project
   is actually on a plan with backups enabled (Pro and above — the free
   plan has no dashboard-managed backups at all). If you don't know, check
   the Dashboard's **Database → Backups** page *before* you need it,
   not during an incident.
2. **Restoring**: from the Dashboard, **Database → Backups** → select a
   daily backup (or, with the Point-in-Time Recovery add-on enabled, the
   **Point in Time** tab's date/time picker) → **Restore to a New Project**.
   Prefer restoring to a **new project** and verifying data there before
   cutting the app over — an in-place restore makes the live project itself
   inaccessible for the duration and is not reversible.
3. **After any restore**, re-run this project's health check
   (`GET /api/health`) and run
   `npm run verify-restore -- --live "<LIVE_DATABASE_URL>" --restored "<RESTORED_DATABASE_URL>"`
   (`scripts/verify-restore.ts`) before declaring the incident resolved —
   it replaces an ad-hoc manual spot-check with a concrete per-table
   row-count comparison, a `Wallet.balance` grand-total consistency check
   (flags a restored total that's impossible under a genuine point-in-time
   restore), and a report of exactly how many minutes of `Order`/`Payment`
   history the restore lost relative to the live database. A restore can
   succeed technically while still landing on a snapshot that predates the
   last known-good state, silently losing recent writes — this script is
   meant to catch that instead of a hopeful eyeball check.
4. **`verify-restore.ts` itself has been verified twice** — mechanically against local test databases, and for real against this project's actual production Supabase database's live data (confirmed correct row counts, a matching real `Wallet.balance` Postgres `Decimal` total, and a correctly-reported 0-minute data-loss window when compared against itself as the closest available proxy without Supabase restore-creation access). **What has NOT been tested end-to-end is the actual Supabase Dashboard restore-to-a-new-project step**, which requires a paid Supabase plan — see the standing gap in `PRODUCTION_READINESS.md` §13. Do a real dry-run restore via the Supabase Dashboard, then run `verify-restore.ts` against its output, before relying on this in a real incident — an untested backup is not a backup.

---

## 8. Communication templates

Adjust the audience (internal team vs. public status page vs. individual
affected users) to fit whatever channels actually exist for this project
today; the content below is what matters regardless of channel.

**Initial notification (within the target response time for the severity):**
> **[SEV-<N>] <one-line description>**
> Started: `<time>` · Status: Investigating
> Impact: `<who/what is affected>`
> Next update: `<time>`

**Status update (every 30–60 min while active, or on material change):**
> **[SEV-<N> update] <one-line description>**
> Status: `<Investigating / Mitigating / Monitoring>`
> What we know: `<...>`
> What we're doing: `<...>`
> Next update: `<time>`

**Resolution:**
> **[SEV-<N> resolved] <one-line description>**
> Duration: `<start>`–`<end>`
> Root cause (brief): `<...>`
> Fix: `<what changed>`
> Follow-up: postmortem to follow for SEV-1/SEV-2.

**User-facing (if customers were directly affected, e.g. a stuck order or
wallet discrepancy):** be specific and concrete — what happened, what you
did about their specific account, and what (if anything) they need to do.
Vague "we experienced an issue" messages erode trust faster than a precise
explanation of a real bug.

---

## 9. Postmortem (required for SEV-1, recommended for SEV-2)

Write this within a few days while details are fresh, blameless in tone
(the goal is fixing the system, not finding who to blame):

1. **Summary** — one paragraph, what happened and impact.
2. **Timeline** — timestamped, from detection through resolution (this is
   why the Scribe role in §2 matters — reconstructing this from memory
   days later loses the details that actually prevent recurrence).
3. **Root cause** — the actual mechanism, not just "a bug in X" — trace it
   to the specific code path/config/assumption that was wrong.
4. **What went well / what didn't** — including detection speed; if
   detection was "a user complained" for a SEV-1, that's itself a finding
   (see §3 — this is the argument for prioritizing the
   `PRODUCTION_READINESS.md` §4/§6 error-tracking and alerting gaps).
5. **Action items** — concrete, owned, with a rough timeframe. Link the
   follow-up PR/commit once filed. An incident without at least one
   action item that changes the system (not just "be more careful next
   time") wasn't fully learned from.

---

## 10. Related documents

- [`README.md` §13 Troubleshooting](../README.md#13-troubleshooting) — developer-facing common failure modes, use alongside this doc during investigation.
- [`PRODUCTION_READINESS.md`](PRODUCTION_READINESS.md) — full production-readiness checklist. Error tracking (§4), metrics/alerting (§6), backup/DR (§13), and CI/CD (§14) are now implemented/partial rather than open gaps as of this doc's last update — automated rollback (§14) is now implemented but off by default and unverified against a real Vercel account; the remaining honestly-open items are: Sentry alert-rule configuration and a real end-to-end restore drill. Check that section directly rather than assuming this bullet stays current.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — system layers, auth, background jobs, security architecture.
- [`DATABASE.md`](DATABASE.md) — schema, transactions, backup/recovery detail.
- [`WORKFLOWS.md`](WORKFLOWS.md) — end-to-end request lifecycles (order, deposit, support, Telegram linking) and their documented edge-case handling.
