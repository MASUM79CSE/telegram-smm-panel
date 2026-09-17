# Reseller API (`/api/v2`)

**Status:** shipped in `docs/IMPLEMENTATION_PLAN.md` Phase 2.2, live-verified at the time against real MongoDB Atlas data (see that section for the verification log — the project has since been fully migrated to PostgreSQL/Prisma via Supabase, see [`DATABASE.md`](DATABASE.md); this endpoint's contract/behavior is unchanged by that migration).

This is a **reseller-facing HTTP API** for third parties (or your own scripts/bots) to place orders, check status, and manage balance programmatically, without a browser session. It deliberately follows the same request/response contract used by the wider "SMM panel API v2" ecosystem (the shape shared by every reference panel researched while building this — see the note on conventions below), so existing reseller integration scripts generally work against this endpoint with only a base-URL change.

For the shared business logic this endpoint calls into (so you understand what it does and does not duplicate), see [`ARCHITECTURE.md` §2](ARCHITECTURE.md#2-layers--module-boundaries) and [`WORKFLOWS.md`](WORKFLOWS.md). For the `ApiKey` schema, see [`DATABASE.md` §2](DATABASE.md#2-collections-entities--responsibilities).

## 1. Getting an API key

1. Sign in to the dashboard and go to **API Keys** (`/dashboard/api-keys`).
2. Click **Generate New Key**. The raw key is shown **exactly once** — copy it immediately. Only its hash is stored server-side (same convention as this project's email-verification/password-reset tokens — see `lib/crypto.ts`), so it cannot be recovered later; generate a new one if it's lost.
3. Revoke a key any time from the same page. Revocation takes effect immediately (verified live: a request made with a just-revoked key is rejected on its very next call).

Each user can hold multiple active keys (e.g. one per integration, so they can be rotated/revoked independently).

## 2. Making a request

```
POST /api/v2
```

- **Body:** either `application/x-www-form-urlencoded` (the traditional convention for this class of API — see any reference panel's own docs) or `application/json`. Both are accepted; use whichever your HTTP client makes easiest.
- **Authentication:** include your key as either:
  - a `key` field in the request body (the traditional convention), **or**
  - an `X-Api-Key` request header (both are supported; use whichever fits your client).
- **Response format:** always JSON, always **HTTP 200**, even for errors. Check the `error` field in the response body, not the HTTP status code, to detect failure. This matches the real-world convention of this API family (verified against multiple reference panels' published docs before implementing) — the one deliberate reason for this is that reseller integration code written against those panels typically checks `response.error`, not `response.status`, so returning varying HTTP status codes here would silently break otherwise-compatible client code.
- **Rate limit:** 120 requests per 60 seconds, tracked **per API key** (not per IP — a real integration server makes many rapid calls from one IP, so limiting by IP would be the wrong unit here). Exceeding it returns `{"error": "Rate limit exceeded. Please slow down your requests."}`.
- **Scoping:** every action is scoped to the key's owning user. A key can only ever see/act on its own orders and balance — verified live with two separate accounts/keys (see Phase 2.2's verification log in `docs/IMPLEMENTATION_PLAN.md`): one key querying or attempting to cancel another user's order id gets back the same `"Incorrect order ID"` response as a genuinely nonexistent order id, never a distinguishable error that would leak the order's existence.

## 3. Actions

### `services` — list available services

| Parameter | Description |
|---|---|
| `key` | Your API key |
| `action` | `services` |

Returns the exact same underlying catalog data as the public website (`lib/services/catalog.ts#getPublicCatalog()` — one shared query, not a separate implementation), flattened to one row per service:

```json
[
  {
    "service": "6a95c857a864e49dfda94c23",
    "name": "Telegram Channel Members",
    "category": "Telegram Members",
    "rate": "1.5",
    "min": 100,
    "max": 50000
  }
]
```

`service` is this platform's UUID string primary key for the service (not a small sequential integer, unlike some reference panels) — use it verbatim as the `service` parameter in `add`.

### `add` — place an order

| Parameter | Description |
|---|---|
| `key` | Your API key |
| `action` | `add` |
| `service` | Service ID (from `services`) |
| `link` | Target link/username/channel |
| `quantity` | Needed quantity |

Calls the exact same `placeOrder()` function (`lib/services/orders.ts`) already shared by the website and the Telegram bot — this is a third entry point into that one function, not a separate reimplementation of the wallet-debit/order-creation transaction. The same validation (service must be active, quantity within the service's min/max, sufficient wallet balance) applies identically regardless of entry surface.

**Success:**
```json
{ "order": "6a974cb62b3e8b77684d9c90" }
```

**Failure** (insufficient balance, invalid quantity, unknown service, inactive account, etc.):
```json
{ "error": "Insufficient wallet balance." }
```

### `status` — order status (single or bulk)

| Parameter | Description |
|---|---|
| `key` | Your API key |
| `action` | `status` |
| `order` | A single order ID |
| `orders` | Comma-separated order IDs (up to 100) — use this instead of `order` for bulk lookups |

**Single-order response:**
```json
{
  "charge": "0.1500",
  "start_count": "0",
  "status": "PROCESSING",
  "remains": 0,
  "currency": "USD"
}
```

`status` is this platform's own order status string (`PENDING`/`PROCESSING`/`IN_PROGRESS`/`COMPLETED`/`PARTIAL`/`CANCELED`/`FAILED`/`REFUNDED` — see `models/Order.ts`), not the capitalized human-readable strings some reference panels use (e.g. `"Partial"`) — this is a deliberate simplicity choice for this project's first API version; revisit if a specific reseller integration requires exact string compatibility.

**Bulk response** (keyed by order id, matching the reference contract's documented shape):
```json
{
  "6a974cb62b3e8b77684d9c90": {
    "charge": "0.1500",
    "start_count": "0",
    "status": "PROCESSING",
    "remains": 0,
    "currency": "USD"
  },
  "000000000000000000000000": { "error": "Incorrect order ID" }
}
```

An order ID that doesn't exist, or belongs to a different user, returns `{"error": "Incorrect order ID"}` either way — verified live that this is indistinguishable, so a key can never use this endpoint to enumerate or confirm the existence of another user's orders.

### `balance` — wallet balance

| Parameter | Description |
|---|---|
| `key` | Your API key |
| `action` | `balance` |

```json
{ "balance": "9.8500", "currency": "USD" }
```

### `cancel` — cancel and refund an order

| Parameter | Description |
|---|---|
| `key` | Your API key |
| `action` | `cancel` |
| `order` | A single order ID, **or** |
| `orders` | Comma-separated order IDs (up to 100) for bulk cancel |

Only orders still in `PENDING` or `PROCESSING` are eligible (i.e. dispatch hasn't progressed to `IN_PROGRESS` or later) — this calls the exact same `refundOrder()` function (`lib/services/admin-orders.ts`) the admin dashboard uses to issue a refund, so the wallet-crediting transaction exists in exactly one place regardless of who triggers it.

**Single-order response:**
```json
{ "order": "6a974cb62b3e8b77684d9c90", "cancel": 1 }
```
or, on failure:
```json
{ "order": "6a974cb62b3e8b77684d9c90", "cancel": { "error": "Order not eligible for cancellation." } }
```

**Bulk response** (an array, one entry per requested id — matching the reference contract):
```json
[
  { "order": "6a974cb62b3e8b77684d9c90", "cancel": 1 },
  { "order": "000000000000000000000000", "cancel": { "error": "Incorrect order ID" } }
]
```

### `refill` — not yet supported over this API

Reserved in the contract (present in the reference API family this endpoint otherwise mirrors). Calling it returns:
```json
{ "error": "Refill is not currently supported by this panel." }
```
rather than silently no-op'ing, so integration code can detect and handle the gap explicitly instead of assuming success.

**Note (post Phase 3.1):** the platform *does* now have a self-service refill feature — `requestRefill()` (`lib/services/refill.ts`), reachable via `POST /api/orders/[id]/refill` on the customer dashboard (see `docs/IMPLEMENTATION_PLAN.md` §3.1). This reseller endpoint's `refill` action was **deliberately left unwired to it** rather than exposed here: reseller/API-key access is a separate trust boundary from the logged-in dashboard, and extending refill to resellers wasn't part of Phase 3.1's agreed scope. Wiring `case "refill"` in `app/api/v2/route.ts` to call the same `requestRefill()` function (following this project's "one function, many surfaces" convention — see `MEMORY.md` §3) is a candidate for a future phase, not a bug.

## 4. Error responses

Every error is `{"error": "<human-readable message>"}` with **HTTP 200** (see the response-format note above for why). Common cases:

| Message | Cause |
|---|---|
| `Invalid API key.` | Key missing, malformed, unknown, or revoked. |
| `Account is not active.` | The key's owning user account is `SUSPENDED`/`BANNED`. |
| `Rate limit exceeded. Please slow down your requests.` | More than 120 requests/60s on this key. |
| `Invalid or missing parameters.` | Request body failed schema validation (e.g. unknown `action`). |
| `Invalid quantity.` | `quantity` isn't a positive integer. |
| `Service not found or unavailable.` | Unknown or inactive `service` id. |
| `Insufficient wallet balance.` | Wallet balance is lower than the order's charge. |
| `Incorrect order ID` | Order id doesn't exist, or doesn't belong to this key's user (indistinguishable, deliberately). |
| `Order not eligible for cancellation.` | Order has already progressed past `PROCESSING`, or was already refunded/canceled. |

## 5. What this endpoint deliberately does NOT do (yet)

- No `refill`/guarantee support over this reseller API (see above) — the underlying feature exists (dashboard-only, Phase 3.1).
- No webhook/callback notifications on status change — a reseller must poll `status`. Revisit if a future phase adds outbound webhooks.
- No API-key scoping to a subset of services/spending limit per key — a key has the same permissions as the underlying user account, full stop. If per-key restrictions are ever needed (e.g. a "read-only" key), that's a schema addition to `ApiKey`, not present today.
