import { describe, it, expect } from "vitest";

import { isBulkSafeOrderStatus, BULK_SAFE_ORDER_STATUSES } from "@/lib/services/admin-bulk";

/**
 * Pure-logic unit coverage for the bulk-order-status safety guard
 * (docs/DASHBOARD_UPGRADE_PLAN.md §2.3 — bulk actions on admin tables).
 *
 * Bulk order-status change is deliberately restricted to a small subset of
 * statuses that carry no money-movement or ledger-anchoring side effects
 * (see lib/services/admin-orders.ts's `changeOrderStatus` doc comment for
 * why `COMPLETED` sets `completedAt`, and `refundOrder`'s own transactional
 * wallet-credit for why `REFUNDED` is a completely separate, single-item-
 * only code path). This test exists specifically to lock that boundary in
 * place — see this test failing/being changed as a signal that the bulk
 * surface's scope is being widened and deserves a fresh look, not a
 * reflexive test update.
 */
describe("lib/services/admin-bulk — isBulkSafeOrderStatus", () => {
  it("allows CANCELED", () => {
    expect(isBulkSafeOrderStatus("CANCELED")).toBe(true);
  });

  it("allows FAILED", () => {
    expect(isBulkSafeOrderStatus("FAILED")).toBe(true);
  });

  it("rejects REFUNDED (money-moving — single-item only)", () => {
    expect(isBulkSafeOrderStatus("REFUNDED")).toBe(false);
  });

  it("rejects COMPLETED (anchors refill-eligibility window — single-item only)", () => {
    expect(isBulkSafeOrderStatus("COMPLETED")).toBe(false);
  });

  it("rejects PENDING/PROCESSING/IN_PROGRESS/PARTIAL", () => {
    expect(isBulkSafeOrderStatus("PENDING")).toBe(false);
    expect(isBulkSafeOrderStatus("PROCESSING")).toBe(false);
    expect(isBulkSafeOrderStatus("IN_PROGRESS")).toBe(false);
    expect(isBulkSafeOrderStatus("PARTIAL")).toBe(false);
  });

  it("rejects an arbitrary non-status string", () => {
    expect(isBulkSafeOrderStatus("NOT_A_REAL_STATUS")).toBe(false);
  });

  it("BULK_SAFE_ORDER_STATUSES contains exactly CANCELED and FAILED", () => {
    expect([...BULK_SAFE_ORDER_STATUSES].sort()).toEqual(["CANCELED", "FAILED"]);
  });
});
