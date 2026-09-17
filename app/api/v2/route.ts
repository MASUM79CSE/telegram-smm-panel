import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { apiV2RequestSchema } from "@/lib/validation";
import { rateLimit } from "@/lib/rate-limit";
import { resolveApiKey } from "@/lib/services/api-keys";
import { placeOrder } from "@/lib/services/orders";
import { refundOrder } from "@/lib/services/admin-orders";
import { getPublicCatalog } from "@/lib/services/catalog";
import { decimalToNumber } from "@/lib/money";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

/**
 * Reseller HTTP API — `POST /api/v2` (docs/IMPLEMENTATION_PLAN.md Phase 2.2,
 * full contract documented in docs/API.md).
 *
 * Deliberately follows the same request/response conventions as the
 * industry-standard SMM-panel "API v2" contract (the same shape used by
 * every reference panel researched for this project — see docs/API.md's
 * sources) so existing reseller scripts/SDKs written against that contract
 * work against this endpoint with zero changes beyond the base URL:
 *   - single POST endpoint, `action` field selects the operation
 *   - `key` authenticates (accepted in the body OR the `X-Api-Key` header —
 *     the reference contract only documents the body form, since it
 *     predates typical header-auth conventions, but accepting the header
 *     too costs nothing and is friendlier to modern HTTP clients)
 *   - **all** responses are HTTP 200 with a JSON body; errors are signaled
 *     by an `{"error": "..."}` field in that body, NOT by the HTTP status
 *     code — this matches every reference panel's actual behavior (verified
 *     across multiple real panels' published docs, not assumed) and is
 *     important for reseller compatibility: their integration code checks
 *     `response.error`, not `response.status`. The one deliberate exception
 *     is authentication itself (missing/invalid key) and malformed
 *     input this project's own validation layer rejects before it can even
 *     reach the "always 200" per-action logic — those still return 200 with
 *     an `error` field for the SAME reason (consistency for reseller
 *     clients), not a 401/400, to avoid a client special-casing one class of
 *     error over another.
 *
 * Every action is scoped to `apiKey.userId` — never allow a reseller to see
 * or act on another user's orders/balance. This is enforced by always
 * filtering DB queries by that id, never by trusting anything the caller
 * sends besides their own key.
 *
 * `add` and `cancel` call the EXACT SAME shared service functions
 * (`placeOrder`/`refundOrder`) already used by the website and Telegram bot
 * — this is the third entry point into that shared logic, per this
 * project's established "one function per business operation, multiple
 * entry surfaces" convention (see MEMORY.md §3). `services` calls the same
 * `getPublicCatalog()` used by the public website catalog and the
 * authenticated `/api/services` route — a third consumer of that one query,
 * not a fourth independent implementation.
 */

function errorResponse(message: string) {
  return NextResponse.json({ error: message });
}

export async function POST(request: Request) {
  // Accept JSON, form-encoded, or multipart bodies — real reseller
  // integrations (PHP curl, Python requests) commonly POST
  // application/x-www-form-urlencoded, not JSON, matching the reference
  // contract's documented examples.
  const contentType = request.headers.get("content-type") ?? "";
  let rawBody: Record<string, unknown>;

  try {
    if (contentType.includes("application/json")) {
      rawBody = await request.json();
    } else {
      const form = await request.formData();
      rawBody = Object.fromEntries(form.entries());
    }
  } catch {
    return errorResponse("Malformed request body.");
  }

  const parsed = apiV2RequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return errorResponse("Invalid or missing parameters.");
  }

  const { action, ...params } = parsed.data;
  const rawKey = params.key ?? request.headers.get("x-api-key") ?? "";

  let apiKeyUserId: string;
  try {
    const apiKey = await resolveApiKey(rawKey);
    apiKeyUserId = apiKey.userId;
  } catch {
    return errorResponse("Invalid API key.");
  }

  const { success } = await rateLimit("apiV2", apiKeyUserId);
  if (!success) {
    return errorResponse("Rate limit exceeded. Please slow down your requests.");
  }

  const user = await prisma.user.findUnique({ where: { id: apiKeyUserId }, select: { status: true } });
  if (!user || user.status !== "ACTIVE") {
    return errorResponse("Account is not active.");
  }

  switch (action) {
    case "services":
      return handleServices();
    case "balance":
      return handleBalance(apiKeyUserId);
    case "add":
      return handleAdd(apiKeyUserId, user.status, params);
    case "status":
      return handleStatus(apiKeyUserId, params);
    case "cancel":
      return handleCancel(apiKeyUserId, params);
    case "refill":
      return errorResponse("Refill is not currently supported by this panel.");
    default:
      return errorResponse("Invalid action.");
  }
}

async function handleServices() {
  const { groups } = await getPublicCatalog();

  const flat = groups.flatMap((group) =>
    group.categories.flatMap((category) =>
      category.services.map((service) => ({
        service: service._id,
        name: service.name,
        category: category.name,
        rate: service.rate,
        min: service.minQuantity,
        max: service.maxQuantity,
      }))
    )
  );

  return NextResponse.json(flat);
}

async function handleBalance(userId: string) {
  const wallet = await prisma.wallet.findUnique({ where: { userId } });
  if (!wallet) return errorResponse("Wallet not found.");

  return NextResponse.json({
    balance: decimalToNumber(wallet.balance).toFixed(4),
    currency: wallet.currency,
  });
}

async function handleAdd(
  userId: string,
  userStatus: string,
  params: { service?: string | number; link?: string; quantity?: string | number }
) {
  const { service, link, quantity } = params;

  if (service === undefined || !link || quantity === undefined) {
    return errorResponse("Parameters service, link, and quantity are required.");
  }

  const quantityNum = typeof quantity === "string" ? parseInt(quantity, 10) : quantity;
  if (!Number.isFinite(quantityNum) || quantityNum <= 0) {
    return errorResponse("Invalid quantity.");
  }

  try {
    const order = await placeOrder({
      userId,
      userStatus,
      serviceId: String(service),
      target: link,
      quantity: quantityNum,
    });

    return NextResponse.json({ order: order.id });
  } catch (err) {
    if (err instanceof AppError) {
      return errorResponse(err.message);
    }
    logger.error({ err }, "[api/v2] add error");
    return errorResponse("Failed to create order.");
  }
}

/** Real per-order status payload, or `{ error }` for one that doesn't exist / isn't this key's. */
async function statusPayloadFor(userId: string, orderId: string) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId },
    select: { charge: true, startCount: true, remains: true, status: true },
  });

  if (!order) return { error: "Incorrect order ID" };

  return {
    charge: decimalToNumber(order.charge).toFixed(4),
    start_count: order.startCount ?? "0",
    status: order.status,
    remains: order.remains ?? 0,
    currency: "USD",
  };
}

async function handleStatus(userId: string, params: { order?: string | number; orders?: string }) {
  const { order, orders } = params;

  if (orders) {
    const ids = orders
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
      .slice(0, 100); // matches the reference contract's documented cap

    if (ids.length === 0) {
      return errorResponse("Parameter orders must contain at least one order ID.");
    }

    const result: Record<string, unknown> = {};
    for (const id of ids) {
      result[id] = await statusPayloadFor(userId, id).catch(() => ({ error: "Incorrect order ID" }));
    }
    return NextResponse.json(result);
  }

  if (!order) {
    return errorResponse("Parameter order (or orders) is required.");
  }

  const payload = await statusPayloadFor(userId, String(order));
  return NextResponse.json(payload);
}

async function handleCancel(userId: string, params: { order?: string | number; orders?: string }) {
  const { order, orders } = params;
  const ids = orders
    ? orders
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
        .slice(0, 100)
    : order
      ? [String(order)]
      : [];

  if (ids.length === 0) {
    return errorResponse("Parameter order (or orders) is required.");
  }

  const results = await Promise.all(
    ids.map(async (id) => {
      const existing = await prisma.order.findFirst({ where: { id, userId }, select: { status: true } });
      if (!existing) return { order: id, cancel: { error: "Incorrect order ID" } };

      if (!["PENDING", "PROCESSING"].includes(existing.status)) {
        return { order: id, cancel: { error: "Order not eligible for cancellation." } };
      }

      try {
        await refundOrder(id, "Canceled via reseller API");
        return { order: id, cancel: 1 };
      } catch (err) {
        const message = err instanceof AppError ? err.message : "Order not eligible for cancellation.";
        return { order: id, cancel: { error: message } };
      }
    })
  );

  // Single-order convention: reference panels return the bare cancel result
  // object for a single `order`, and an array only for bulk `orders` — mirror
  // that rather than always wrapping in an array, for the same reseller-
  // compatibility reason described in the module doc comment above.
  if (!orders && results.length === 1) {
    return NextResponse.json(results[0]);
  }
  return NextResponse.json(results);
}
