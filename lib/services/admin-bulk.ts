import { Order, type OrderStatus } from "@/models/Order";
import { AppError } from "@/lib/errors";

/**
 * Bulk admin actions (docs/DASHBOARD_UPGRADE_PLAN.md §2.3).
 *
 * Scope note — deliberately narrow: bulk operations on Payments (approve)
 * and Users (status/role change) do NOT get a new service function here.
 * They compose the existing single-item, individually-tested code paths
 * (`approveDeposit()` in lib/services/admin-payments.ts,
 * `User.findByIdAndUpdate` in app/api/admin/users/[id]/route.ts) via a
 * client-side loop of calls to their existing routes — see
 * components/admin/{payments,users}-table.tsx. That preserves each row's
 * existing atomic-transaction/self-modification-guard invariants exactly
 * as-is, with zero new money-movement or auth code to review.
 *
 * Bulk order-status change is the one genuinely new server-side operation
 * in this feature, because no single-call bulk endpoint for order status
 * existed before. It is intentionally restricted to a small, non-money-
 * moving, non-ledger-anchoring subset of `OrderStatus` — see
 * `isBulkSafeOrderStatus` below and lib/services/admin-orders.ts's own doc
 * comments for exactly why `REFUNDED` (wallet-crediting transaction) and
 * `COMPLETED` (anchors the refill-eligibility window via `completedAt`)
 * must stay single-item-only, deliberate admin actions.
 */

/** Order statuses safe to apply in bulk — no money movement, no ledger anchor. */
export const BULK_SAFE_ORDER_STATUSES: ReadonlySet<OrderStatus> = new Set(["CANCELED", "FAILED"]);

const MAX_BULK_IDS = 100;

export function isBulkSafeOrderStatus(status: string): status is "CANCELED" | "FAILED" {
  return BULK_SAFE_ORDER_STATUSES.has(status as OrderStatus);
}

export interface BulkOrderStatusResult {
  succeeded: string[];
  failed: Array<{ id: string; error: string }>;
}

/**
 * Transition a batch of orders to a bulk-safe status. Each order is
 * updated independently (not a single multi-document transaction) — a
 * plain status/history update carries no cross-document invariant that
 * requires atomicity across rows (unlike a wallet credit), so a partial
 * failure (e.g. one bad id) reports per-row instead of rolling back the
 * whole batch, which is more useful for an admin working through a list.
 */
export async function bulkChangeOrderStatus(
  orderIds: string[],
  status: string,
  note?: string | null
): Promise<BulkOrderStatusResult> {
  if (orderIds.length === 0) {
    throw new AppError("NO_ORDER_IDS", "No order ids were provided.");
  }
  if (orderIds.length > MAX_BULK_IDS) {
    throw new AppError("TOO_MANY_IDS", `Too many order ids — a single bulk action is capped at ${MAX_BULK_IDS}.`);
  }
  if (!isBulkSafeOrderStatus(status)) {
    throw new AppError(
      "STATUS_NOT_BULK_SAFE",
      `Status "${status}" is not permitted for bulk update — only CANCELED and FAILED are.`
    );
  }

  const now = new Date();

  // Each row is an independent, non-transactional update (no shared
  // invariant across rows, unlike a wallet-crediting transaction), so
  // these fire concurrently via `Promise.allSettled` rather than a
  // sequential loop — one slow/failing id shouldn't stall the rest of the
  // batch, and `allSettled` (vs. `all`) guarantees every id gets a
  // succeeded/failed outcome even if others reject.
  // A dedicated marker class distinguishes the one EXPECTED per-row
  // failure (id doesn't exist — a normal, safe-to-report outcome) from any
  // OTHER rejection (e.g. a malformed id producing a raw Mongoose
  // `CastError`, whose message embeds internal schema/model details and
  // must not be echoed back to an API client — see the catch branch
  // below).
  class OrderNotFoundError extends Error {}

  const outcomes = await Promise.allSettled(
    orderIds.map(async (orderId) => {
      const order = await Order.findByIdAndUpdate(
        orderId,
        {
          status,
          $push: { statusHistory: { status, note: note ?? null, at: now } },
        },
        { returnDocument: "after" }
      );
      if (!order) {
        throw new OrderNotFoundError("Order not found.");
      }
      return orderId;
    })
  );

  const succeeded: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];

  outcomes.forEach((outcome, index) => {
    const orderId = orderIds[index];
    if (outcome.status === "fulfilled") {
      succeeded.push(orderId);
    } else if (outcome.reason instanceof OrderNotFoundError) {
      failed.push({ id: orderId, error: outcome.reason.message });
    } else {
      // Mirrors app/api/admin/orders/[id]/route.ts's catch-all branch,
      // which also returns a generic message for anything that isn't a
      // recognized, safe-to-report error — the real error is still
      // available server-side via the rejected promise for debugging.
      failed.push({ id: orderId, error: "Failed to update this order." });
    }
  });

  return { succeeded, failed };
}
