<div align="center">

# 📲 SMM Panel

**A production-grade, multi-platform Social Media Marketing panel — web dashboard + Telegram bot, one shared backend.**

Customers top up a wallet and order services across Telegram, Instagram, TikTok, YouTube, and more. Admins manage the entire operation — catalog, providers, deposits, support — from a dashboard or straight from Telegram inline buttons.

[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue?logo=typescript)](https://www.typescriptlang.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Supabase-3ECF8E?logo=supabase&logoColor=white)](https://supabase.com)
[![Tests](https://img.shields.io/badge/tests-236%20passing-brightgreen)](#-testing)
[![License](https://img.shields.io/badge/license-MIT-informational)](LICENSE)

[Features](#-features) · [Tech Stack](#-tech-stack) · [Quick Start](#-quick-start) · [Architecture](#-architecture) · [Documentation](#-documentation) · [Deployment](#-deployment)

</div>

---

> **Compliance note:** the fulfillment layer is designed for legitimate, ToS-compliant services (content distribution to consenting audiences, channel/group management automation, ads assistance) — **not** fake engagement or platform-abuse automation. This is enforced at the product/service-catalog level; see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

<div align="center">
  <img src="docs/screenshots/settings-page-preview.png" alt="SMM Panel — customer dashboard settings page" width="850">
  <p><em>Customer dashboard — profile, password, and account security settings.</em></p>
</div>

## Table of Contents

1. [Features](#-features)
2. [Tech Stack](#-tech-stack)
3. [Architecture](#-architecture)
4. [Project Structure](#-project-structure)
5. [Quick Start](#-quick-start)
6. [Environment Variables](#-environment-variables)
7. [Development Workflow](#-development-workflow)
8. [Testing](#-testing)
9. [Production Deployment](#-deployment)
10. [Troubleshooting](#-troubleshooting)
11. [Documentation](#-documentation)
12. [License](#-license)

---

## ✨ Features

**Customer experience**
- Register/login (email + password via Auth.js/NextAuth), email verification, password reset
- Wallet with balance & full transaction history — every change is an immutable, auditable ledger row
- Browse a **public, unauthenticated** service catalog (`/services`) — no account needed to look around
- Place and track orders, request refills, open support tickets
- Full **Telegram bot** control surface — link an account, place orders, submit deposits, browse tickets, all from a chat
- **Bilingual UI** (English/Bengali) with live BDT currency-display conversion alongside USD pricing

**Admin operations**
- User, catalog (`ServiceGroup → Category → Service`), and provider management
- Deposit approval/rejection, order status/refund management, support replies, site settings
- Bulk actions across Orders/Users/Payments tables, advanced filters, a command palette
- Financial reporting with CSV export, provider health monitoring, audit log viewer

**Platform & fulfillment**
- **One codebase, four entry surfaces** (web, admin, Telegram bot, reseller API) all sharing the *exact same* `lib/services/*` business logic — money-handling logic exists in exactly one place
- **Multi-provider fulfillment dispatch** — `MANUAL`, `INTERNAL`, and upstream `API` provider types, with priority-ordered failover per service
- **Reseller HTTP API** (`POST /api/v2`) — industry-standard SMM-panel contract (`services`/`add`/`status`/`balance`/`cancel`), API-key authenticated
- Self-service order refills, automatic partial-delivery refunds, and real median delivery-time estimates computed from actual order history
- **Wallet ledger correctness** — Postgres transactions (`prisma.$transaction`) + optimistic concurrency (`Wallet.version`) so concurrent orders can never double-spend or leave a wallet negative
- **Scheduled housekeeping** — expired email-verification/password-reset tokens are swept up by a dedicated cleanup job (Postgres has no native TTL-index equivalent to what MongoDB offered, so this replaces that behavior explicitly)

**Security & production readiness**
- Fail-fast Zod-validated environment config, bcrypt + account lockout, AES-256-GCM encryption at rest for provider credentials
- HMAC-verified Telegram webhooks, rate limiting (Upstash Redis in production), full audit logging, security response headers
- Structured logging + Sentry error tracking, CI/CD pipeline with automated post-deploy smoke tests and opt-in automated rollback
- A written, honest [production-readiness checklist](docs/PRODUCTION_READINESS.md) and [incident-response runbook](docs/INCIDENT_RESPONSE.md) — not just a demo

## 🧱 Tech Stack

| Layer | Technology |
|---|---|
| Framework | [Next.js 16](https://nextjs.org) (App Router, Turbopack, React 19) |
| Language | TypeScript (strict mode) |
| Database | PostgreSQL ([Supabase](https://supabase.com) in production) via [Prisma](https://www.prisma.io) ORM |
| Auth | [Auth.js / NextAuth v5](https://authjs.dev) — Credentials provider, JWT sessions |
| Telegram bot | [grammY](https://grammy.dev) + `@grammyjs/conversations` + a Prisma-backed session storage adapter |
| Validation | [Zod](https://zod.dev) — request bodies and environment variables |
| Rate limiting | [Upstash Redis](https://upstash.com) (in-memory fallback for local dev) |
| Email | [Nodemailer](https://nodemailer.com) over generic SMTP |
| Error tracking | [Sentry](https://sentry.io) (`@sentry/nextjs`) |
| i18n | [next-intl](https://next-intl.dev) — `en`/`bn` locale routing |
| Styling | Tailwind CSS v4 |
| Testing | Vitest (unit + DB-backed integration), Playwright (e2e) |

Full dependency list: [`package.json`](package.json).

## 🏗 Architecture

```
┌──────────────────────┐        ┌───────────────────────┐
│     Web Browser       │        │     Telegram App       │
│  (dashboard / admin)   │        │      (bot chat)         │
└───────────┬────────────┘        └───────────┬─────────────┘
            │ HTTPS                           │ Telegram Bot API (webhook)
            ▼                                 ▼
┌──────────────────────────────────────────────────────────────┐
│                  Next.js App (single deployable)                │
│  ┌──────────────┐   ┌───────────────┐   ┌────────────────────┐  │
│  │ App Router    │   │ API Routes     │   │ /api/telegram/       │  │
│  │ pages (RSC)   │   │ (REST-ish)     │   │ webhook (grammY)      │  │
│  └───────┬───────┘   └───────┬───────┘   └──────────┬────────────┘  │
│          └───────────┬───────┴──────────────────────┘               │
│                       ▼                                             │
│           lib/services/*  — shared business logic                    │
│           (orders, payments, admin, tickets, telegram-link —          │
│            used by web, admin, bot, AND the reseller API alike)       │
│                       ▼                                             │
│              Prisma Client (lib/db.ts)                               │
└───────────────────────┬──────────────────────────────────────────┘
                        ▼
             PostgreSQL (Supabase in production — the pooled
             connection string is used at request time so a
             serverless deployment doesn't exhaust the connection
             limit; see docs/DATABASE.md)

Background jobs (process-orders, poll-order-status,
compute-delivery-estimates, cleanup-expired-tokens) share their logic
via lib/services/jobs.ts and are reachable two ways:
  - scripts/*.ts    — run as a long-lived process (VM/Docker/pm2
                       deployments), each with an optional --loop mode.
  - GET /api/cron/*  — the same logic exposed as authenticated HTTP
                       routes, for deployments (e.g. Vercel) that have
                       no long-lived worker process at all; invoked on
                       a schedule by an external scheduler
                       (.github/workflows/cron.yml).
```

Full detail — module boundaries, request/data flow, auth flow, error-handling strategy, and architectural rationale — is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## 📁 Project Structure

```
app/            Next.js App Router — pages, layouts, and API routes (app/api/**)
components/     React client/server components, grouped by feature area
lib/            Core logic: db connection, auth config, env validation, business
                services (lib/services/*), Telegram bot (lib/telegram/*), utilities
prisma/         prisma/schema.prisma — the single source of truth for the Postgres
                schema (all models, enums, indexes); lib/generated/prisma is the
                generated Prisma Client (not committed, regenerated on install)
scripts/        Operational scripts: seed, background workers (order processor,
                order-status poller, delivery-estimate computer, expired-token
                cleanup), Telegram webhook setup, local dev DB check, Telegram
                long-polling runner
docs/           Architecture, database, workflow, and production-readiness docs
types/          Ambient TypeScript module augmentations
```

## 🚀 Quick Start

### Prerequisites

- **Node.js 20+**
- A **PostgreSQL database** — [Supabase](https://supabase.com) (free tier works) is what this project targets in production, but any Postgres 14+ instance works. Local development can instead use a local PostgreSQL install (see below).
- *(Optional)* A **Telegram Bot token** from [@BotFather](https://t.me/BotFather) for the bot integration
- *(Optional, production)* An **SMTP provider** and an **Upstash Redis** database

### Installation

```bash
git clone https://github.com/MASUM79CSE/telegram-smm-panel.git
cd telegram-smm-panel
npm install
cp .env.example .env.local
```

Fill in `.env.local` — see [Environment Variables](#-environment-variables) below.

### Database

The app uses Prisma against a real PostgreSQL database — wallet/order operations use `prisma.$transaction` with an additional optimistic-concurrency guard on `Wallet.version` (see [`docs/DATABASE.md`](docs/DATABASE.md)). Supabase is the recommended/production target (free tier works fine), but any Postgres 14+ instance works equally well.

1. Create a free project at [supabase.com](https://supabase.com).
2. Under **Project Settings > Database > Connection string**, copy **two** connection strings:
   - The **pooled** ("Transaction mode", port `6543`, `?pgbouncer=true`) connection string — this is what the app uses at request time (`DATABASE_URL`). Required for a serverless deployment target (Vercel): serverless functions open a fresh connection per invocation, and without PgBouncer pooling in front, moderate traffic exhausts Postgres's direct connection limit almost immediately.
   - The **direct** (non-pooled, port `5432`) connection string — this is used only by `prisma db push`/`prisma migrate` at deploy/build time (`DIRECT_URL`), which needs a real session for DDL and Prisma's own advisory locks.
3. Set both in `.env.local`:
   ```
   DATABASE_URL="postgresql://postgres.xxxx:PASSWORD@aws-0-region.pooler.supabase.com:6543/postgres?pgbouncer=true"
   DIRECT_URL="postgresql://postgres.xxxx:PASSWORD@aws-0-region.pooler.supabase.com:5432/postgres"
   ```
4. Push the Prisma schema to create every table: `npx prisma db push`.

No Supabase account yet, or prefer a fully local setup? Install and run Postgres locally instead:

```bash
# Install and start a local Postgres server (one-time setup), e.g. on Debian/Ubuntu:
sudo apt-get install -y postgresql
sudo service postgresql start
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'postgres';"
createdb -U postgres -h localhost telegram_panel

# Point the app at it:
# DATABASE_URL="postgresql://postgres:postgres@localhost:5432/telegram_panel?schema=public"
# DIRECT_URL="postgresql://postgres:postgres@localhost:5432/telegram_panel?schema=public"

npx prisma db push
```

`npx tsx scripts/start-dev-db.ts` checks whether `DATABASE_URL` is reachable and prints setup guidance if it isn't — there is no lightweight embedded-Postgres equivalent to spin up an ephemeral database automatically, so use a real local install (above) or a dedicated Supabase project. Data in a local install persists across restarts (unlike the disposable in-memory database this project used before its MongoDB→Postgres migration).

### Run it

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The app fails fast with a clear error message if required env vars (`DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET`) are missing or invalid — see `lib/env.ts`. Then seed an initial admin account:

```bash
npm run seed
```

Creates an admin user from `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` (defaults: `admin@example.com` / `ChangeMe123!` — **change this immediately**) and default site settings. It does **not** create catalog data — add your `ServiceGroup`/`Category`/`Service`/`Provider` records from `/admin` afterward.

**Optional — run the Telegram bot locally** (long-polling, no public URL needed):

```bash
npm run telegram:poll
```

**Optional — run background workers locally** (needed to see orders actually move past `PENDING`):

```bash
npm run process-orders -- --loop            # dispatches new orders (every 30s)
npm run poll-order-status -- --loop         # reconciles IN_PROGRESS orders (every 120s)
npm run compute-delivery-estimates -- --loop   # refreshes catalog ETAs (hourly)
npm run cleanup-expired-tokens -- --loop    # deletes expired verification tokens
```

## 🔑 Environment Variables

All env vars are centrally validated at startup by `lib/env.ts` (Zod) — the app **fails fast with a clear error** on a missing/invalid required value. `.env.example` is the authoritative, fully-commented reference; the table below is a quick-reference summary.

| Variable | Required? | Purpose |
|---|---|---|
| `DATABASE_URL` | **Required** | Supabase (or local dev) **pooled** Postgres connection string — used by the app at request time. |
| `DIRECT_URL` | **Required** | Supabase (or local dev) **direct** (non-pooled) Postgres connection string — used only by `prisma db push`/`prisma migrate` at deploy/build time. |
| `AUTH_SECRET` | **Required** | Auth.js session/JWT signing secret. Min 32 chars. `openssl rand -base64 32` to generate one. |
| `AUTH_TRUST_HOST` | **Required in production** (`true`) | Without it, every auth request fails with `UntrustedHost` once `NODE_ENV=production`. See [Troubleshooting](#-troubleshooting). |
| `NEXT_PUBLIC_APP_URL` | Optional | Base URL used in emails and Telegram messages. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `EMAIL_FROM` | Optional | Outbound email. Unset → emails are logged to console (dev-only behavior). |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | Optional (recommended in prod) | Distributed rate limiting; falls back to a per-instance in-memory limiter otherwise. |
| `TELEGRAM_BOT_TOKEN` | Optional | Enables the Telegram bot integration end-to-end. |
| `TELEGRAM_ADMIN_CHAT_ID` | Optional | Chat that receives admin alerts (orders, deposits, tickets). |
| `TELEGRAM_WEBHOOK_SECRET` | Required for webhook mode in prod | Verifies inbound Telegram webhook requests. |
| `ALLOWED_ORIGINS` | Optional | Comma-separated origins allowed to call `/api/**` cross-origin. |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | Optional (recommended in prod) | Error tracking + performance monitoring. |
| `CRON_SECRET` | Required to use `/api/cron/*` | Authenticates the serverless background-job endpoints, including `/api/cron/cleanup-expired-tokens` (see [Deployment](#-deployment)). |

See `.env.example` for the complete list, including every optional variable and its default.

## 🛠 Development Workflow

```bash
npm run dev         # start the dev server (Turbopack, hot reload)
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
npm run test         # Vitest unit suite
npm run test:integration   # Vitest, real DB-backed transactional tests
npm run test:e2e     # Playwright end-to-end suite
npm run test:all     # unit + integration together
```

CI (`.github/workflows/ci.yml`) runs lint, typecheck, both test suites, and a full build on every push/PR to `main`.

## ✅ Testing

| Suite | Command | Coverage |
|---|---|---|
| **Unit** | `npm run test` | 201+ tests — money math, validation, auth logic, rate limiting, API route auth/authorization boundaries |
| **Integration** | `npm run test:integration` | Tests against a real, ephemeral PostgreSQL database — exercises the actual `prisma.$transaction` wallet-transaction and concurrency-safety code paths, including a genuine race-condition test, plus the expired-token cleanup job |
| **End-to-end** | `npm run test:e2e` | Playwright, real browser against a real ephemeral DB |

See [`docs/PRODUCTION_READINESS.md`](docs/PRODUCTION_READINESS.md) for full detail on what each suite covers and what's intentionally out of scope.

## 🌐 Deployment

This project targets **Vercel** by default (serverless, zero-config Next.js deploys), with background workers running as scheduled, authenticated HTTP endpoints instead of long-lived processes.

1. **Connect the repo** in the Vercel dashboard — Next.js is auto-detected, no `vercel.json` needed.
2. **Set environment variables** on the Vercel project (see [above](#-environment-variables) — at minimum `DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET`, `AUTH_TRUST_HOST=true`, `NEXT_PUBLIC_APP_URL`, `ALLOWED_ORIGINS`, `CRON_SECRET`).
3. **Push to `main`** — Vercel deploys automatically. Enable "Wait for CI to pass before deploying" so `ci.yml` gates production.
4. **Set GitHub Actions repository secrets** so the scheduler and health checks can reach your deployment:
   - `CRON_SECRET`, `PROD_URL` — drives `.github/workflows/cron.yml`, which calls `GET /api/cron/process-orders`, `/poll-order-status`, `/compute-delivery-estimates`, and `/cleanup-expired-tokens` on a schedule.
   - *(Optional)* `VERCEL_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID` + the `AUTO_ROLLBACK_ENABLED` repository variable — enables automated rollback to the last known-good deployment if the post-deploy smoke test fails.
5. **Register the Telegram webhook** (if the bot is enabled): `npm run telegram:webhook -- https://yourdomain.com`.
6. Confirm `.github/workflows/post-deploy-smoke-test.yml` runs green after your first deploy (Actions tab) — it fires automatically off Vercel's `deployment_status` event and curls `GET /api/health`.

Not on Vercel? Any platform that can run long-lived Node processes works too — run the four worker scripts (`process-orders`, `poll-order-status`, `compute-delivery-estimates`, `cleanup-expired-tokens`) with `-- --loop` under systemd/pm2/Docker instead of using the cron endpoints.

For the complete, no-shortcuts production checklist — secrets management, logging/monitoring, rate limiting, backup & disaster recovery, and an honest list of what's still a gap — see [`docs/PRODUCTION_READINESS.md`](docs/PRODUCTION_READINESS.md) and [`docs/INCIDENT_RESPONSE.md`](docs/INCIDENT_RESPONSE.md).

## 🩹 Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| App crashes on startup: "Invalid environment configuration" | A required env var (`DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET`) is missing or invalid — check against `.env.example`. |
| `UntrustedHost` error on every login (fine locally, breaks after deploy) | Set `AUTH_TRUST_HOST=true` in production — Auth.js only auto-trusts the `Host` header outside `NODE_ENV=production`. `NEXTAUTH_URL` alone does **not** fix this. |
| `403 Cross-origin request not allowed` | Add your frontend's real origin to `ALLOWED_ORIGINS`. Doesn't affect same-origin, server-to-server, or the Telegram webhook. |
| Orders stuck in `PENDING` forever | `process-orders` worker/cron isn't running, or the service has no provider attached (manual-fulfillment services require an admin). |
| Orders stuck `IN_PROGRESS`, never complete | The `poll-order-status` worker/cron isn't running — it's separate from `process-orders`. |
| Emails aren't arriving | `SMTP_*` env vars are unset — emails are being logged to console instead of sent. |
| Rate limiting inconsistent across requests | `UPSTASH_REDIS_REST_URL`/`_TOKEN` unset — each instance has its own in-memory counter. |
| Telegram bot doesn't respond | Confirm `TELEGRAM_BOT_TOKEN` is set; in production confirm the webhook is registered and `TELEGRAM_WEBHOOK_SECRET` matches. |
| `PrismaClientInitializationError` / "Can't reach database server" | `DATABASE_URL`/`DIRECT_URL` is wrong, or (on Supabase specifically) `DATABASE_URL` is pointed at the direct connection string instead of the pooled one (port `6543`, `?pgbouncer=true`). |
| Expired verification tokens never get cleaned up | The cleanup job (`npm run cleanup-expired-tokens` or `GET /api/cron/cleanup-expired-tokens`) isn't running on a schedule. This is a storage-hygiene issue, not a correctness one: expired tokens are already rejected by application logic regardless. |

More scenarios, plus the formal incident-response runbook (severity levels, scenario playbooks, communication templates): [`docs/INCIDENT_RESPONSE.md`](docs/INCIDENT_RESPONSE.md).

## 📚 Documentation

| Document | Covers |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System layers, request/data flow, auth, background jobs, error handling, security architecture |
| [`docs/DATABASE.md`](docs/DATABASE.md) | PostgreSQL/Prisma schema, relationships, indexes, transactions, data lifecycle, backup/recovery |
| [`docs/WORKFLOWS.md`](docs/WORKFLOWS.md) | End-to-end request lifecycles (order, deposit, support, Telegram linking) |
| [`docs/PRODUCTION_READINESS.md`](docs/PRODUCTION_READINESS.md) | Security hardening, logging/monitoring, CI/CD, deployment, and known gaps — kept honest, not aspirational |
| [`docs/INCIDENT_RESPONSE.md`](docs/INCIDENT_RESPONSE.md) | Formal incident-response runbook: severity levels, playbooks, backup/restore, postmortems |
| [`docs/API.md`](docs/API.md) | Reseller HTTP API (`POST /api/v2`) contract for third-party integrators |
| [`docs/I18N_PLAN.md`](docs/I18N_PLAN.md) | Internationalization architecture and the live currency-display conversion layer |
| [`docs/COMPETITIVE_ANALYSIS_AND_ROADMAP.md`](docs/COMPETITIVE_ANALYSIS_AND_ROADMAP.md) | Competitive teardown and prioritized roadmap |
| [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) | Execution-ready task breakdown for the roadmap above |

## 📄 License

Released under the [MIT License](LICENSE).

---

<div align="center">

Built with Next.js, TypeScript, and PostgreSQL · [Report an issue](https://github.com/MASUM79CSE/telegram-smm-panel/issues)

</div>
</content>
