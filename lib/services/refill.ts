import type { HydratedDocument } from "mongoose";

import { Order, type IOrder } from "@/models/Order";
import { Service } from "@/models/Service";
import { Provider } from "@/models/Provider";
import { requestProviderRefill } from "@/lib/fulfillment";
import { AppError } from "@/lib/errors";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Self-service order refill (docs/IMPLEMENTATION_PLAN.md Phase 3.1). Shared
 * by the customer dashboard (`app/api/orders/[id]/refill/route.ts`) — the
 * only entry point today, but written as a standalone service function per
 * this project's established "one function, multiple surfaces" convention
 * (see MEMORY.md §3) in case the Telegram bot or `/api/v2` reseller
 * endpoint need refill support later.
 *
 * Eligibility (all must hold, checked in this order so the error message is
 * always the most specific applicable one):
 *  1. The order belongs to the calling user.
 *  2. The order's service has `refillDays` configured (not null) — the
 *     admin has opted this service into refill support at all.
 *  3. The order is `COMPLETED`.
 *  4. `refillStatus` is still `NONE` — no double-requesting.
 *  5. The order's `completedAt` is within `refillDays` days of now.
 *
 * For an `API`-type provider, this calls the provider's own `refill` action
 * immediately (via `requestProviderRefill`) and returns success once THAT
 * call succeeds — no further polling of the refill's own progress exists
 * yet (see docs/API.md's "what this does NOT do yet" section: this
 * project's `/api/v2` also does not expose `refill_status`), matching the
 * scope explicitly agreed for this phase. For `MANUAL`/`INTERNAL` providers
 * (or an order with no provider at all — e.g. legacy/manually-fulfilled),
 * there is no automatic action to take: the request is simply recorded as
 * `REQUESTED` for an admin to action from the admin order view, exactly the
 * same "no automated action, human handles it from the admin panel"
 * pattern already used for `MANUAL` provider dispatch in
 * `lib/fulfillment.ts`.
 */
/**
 * Pure(ish) eligibility check shared by the server-rendered orders page
 * (`app/dashboard/orders/page.tsx`) so its "Request Refill" button only
 * ever appears when a request would actually succeed — mirrors exactly the
 * checks `requestRefill` itself enforces server-side (this is a UI-only
 * convenience, `requestRefill` remains the sole source of truth/enforcement).
 *
 * Deliberately a plain exported helper rather than inline logic inside the
 * page component: this project's lint config (`react-hooks/purity`) flags
 * any direct `Date.now()` call written inside a component function body,
 * even in a Server Component with no real re-render concern — moving the
 * time-window math into an ordinary, non-component helper function avoids
 * that false positive without disabling the rule.
 */
export function isRefillEligible(order: {
  status: string;
  refillStatus: string;
  completedAt: Date | string | null;
}, refillDays: number | null): boolean {
  if (order.status !== "COMPLETED" || refillDays === null || order.refillStatus !== "NONE" || !order.completedAt) {
    return false;
  }
  const completedAtMs = new Date(order.completedAt).getTime();
  return Date.now() - completedAtMs <= refillDays * MS_PER_DAY;
}

export async function requestRefill(orderId: string, userId: string): Promise<HydratedDocument<IOrder>> {
  const order = await Order.findOne({ _id: orderId, userId });
  if (!order) {
    throw new AppError("NOT_FOUND", "Order not found.");
  }

  const service = await Service.findById(order.serviceId).select("refillDays");
  if (!service || service.refillDays === null || service.refillDays === undefined) {
    throw new AppError("REFILL_NOT_SUPPORTED", "This service does not support refills.");
  }

  if (order.status !== "COMPLETED") {
    throw new AppError("ORDER_NOT_COMPLETED", "Only completed orders are eligible for a refill.");
  }

  if (order.refillStatus !== "NONE") {
    throw new AppError("REFILL_ALREADY_REQUESTED", "A refill has already been requested for this order.");
  }

  if (!order.completedAt) {
    // Defensive: should be impossible for a COMPLETED order (set by
    // changeOrderStatus), but never silently allow an un-datable window
    // check to pass.
    throw new AppError("REFILL_WINDOW_EXPIRED", "This order is not eligible for a refill.");
  }

  const deadline = order.completedAt.getTime() + service.refillDays * MS_PER_DAY;
  if (Date.now() > deadline) {
    throw new AppError("REFILL_WINDOW_EXPIRED", `Refill window (${service.refillDays} days) has expired for this order.`);
  }

  const now = new Date();
  order.refillStatus = "REQUESTED";
  order.refillRequestedAt = now;
  order.statusHistory.push({ status: order.status, note: "Refill requested by customer", at: now });

  if (order.providerId) {
    // `.select("+apiKeyEncrypted")` alone (NOT combined with any other plain
    // field name) — mixing a "+field" opt-in token with plain inclusion
    // field names in one Mongoose `.select()` string switches the whole
    // query into inclusion-only mode, silently dropping every OTHER field
    // (including `apiUrl`, which `requestProviderRefill` needs) rather than
    // just re-including the `select: false` field on top of the full
    // document. Found live during Phase 3 verification: the original
    // `.select("+apiKeyEncrypted type")` here caused `provider.apiUrl` to
    // come back `undefined` even though it was correctly set in the DB,
    // which made every refill request against a real API provider fail
    // with "Provider is missing API configuration". Matches the working
    // pattern already used in `lib/fulfillment.ts#resolveDispatchCandidates`.
    const provider = await Provider.findById(order.providerId).select("+apiKeyEncrypted");
    if (provider?.type === "API") {
      try {
        const result = await requestProviderRefill(order, provider);
        order.providerRefillId = result.refillId;
        // No further automatic tracking of the refill's own progress in this
        // phase (see module doc comment) — mark COMPLETED immediately since
        // the provider accepted the refill request itself; if visibility
        // into refill progress becomes a requirement later, this is the
        // function to extend with a poll, mirroring pollOrderStatus.
        order.refillStatus = "COMPLETED";
      } catch (err) {
        order.refillStatus = "REJECTED";
        const message = err instanceof Error ? err.message : "Provider refill request failed";
        order.statusHistory.push({ status: order.status, note: `Refill failed: ${message}`, at: new Date() });
        await order.save();
        throw new AppError("REFILL_PROVIDER_ERROR", "The provider rejected the refill request.");
      }
    }
    // MANUAL/INTERNAL providers: leave as REQUESTED for an admin to action.
  }
  // No providerId at all (legacy manually-fulfilled order): also leave as
  // REQUESTED for an admin to action — same fallback as above.

  await order.save();
  return order;
}

/**
 * Admin resolution of a refill left in `REQUESTED` state for manual action —
 * i.e. the `MANUAL`/`INTERNAL` provider and no-provider branches of
 * `requestRefill` above, which deliberately do not call any provider API
 * and leave the order for a human to actually go re-deliver (or decline).
 *
 * Found missing during Phase 3 live verification: `requestRefill`'s own doc
 * comment says these get "left as REQUESTED for an admin to action from the
 * admin order view", but no such admin action existed anywhere in the
 * codebase — a `REQUESTED` refill on a MANUAL-provider order had no way to
 * ever leave that state. This closes that gap the same way `changeOrderStatus`
 * closes the equivalent gap for order status itself: a plain admin-triggered
 * transition with an audit-trail note, no provider API call (since there is
 * no provider API to call for these two branches by construction).
 */
export async function resolveManualRefill(
  orderId: string,
  resolution: Extract<IOrder["refillStatus"], "COMPLETED" | "REJECTED">,
  note?: string | null
): Promise<HydratedDocument<IOrder>> {
  const order = await Order.findById(orderId);
  if (!order) {
    throw new AppError("NOT_FOUND", "Order not found.");
  }

  if (order.refillStatus !== "REQUESTED") {
    throw new AppError(
      "REFILL_NOT_PENDING",
      "This order does not have a refill request awaiting manual resolution."
    );
  }

  const now = new Date();
  order.refillStatus = resolution;
  order.statusHistory.push({
    status: order.status,
    note: note?.trim() ? `Refill ${resolution === "COMPLETED" ? "fulfilled" : "declined"} by admin: ${note.trim()}` : `Refill ${resolution === "COMPLETED" ? "fulfilled" : "declined"} by admin`,
    at: now,
  });

  await order.save();
  return order;
}
