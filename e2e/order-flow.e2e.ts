import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers";

/**
 * Critical happy path #2 (docs/PRODUCTION_READINESS.md §15 item 4):
 * deposit -> admin approval -> wallet credited -> order placement ->
 * order appears in the customer's order history.
 *
 * This is the actual money-moving path this entire project exists to
 * support, so it's the highest-value flow for e2e coverage — the
 * individual transactional functions underneath it (`submitDeposit`,
 * `approveDeposit`, `placeOrder`) already have dedicated DB-backed
 * integration tests with concurrency-race coverage (see
 * `lib/__tests__/integration/`); this suite instead proves the REAL UI
 * (real buttons, real forms, real admin approval click) drives those real
 * functions correctly end-to-end, which the integration suite — calling
 * the service functions directly — cannot prove on its own.
 *
 * Uses the pre-funded seeded customer (`e2e-funded@example.com`, see
 * e2e/global-setup.ts) for the order-placement test specifically so that
 * test doesn't ALSO depend on the deposit-approval test in this same file
 * having already succeeded — each test targets one flow, following this
 * project's own established testing philosophy (see the integration
 * suite's per-function test files) of preferring several precise,
 * independently-diagnosable tests over one long chained scenario.
 */
test.describe.serial("Deposit → admin approval → wallet credit", () => {
  const customerEmail = "e2e-funded@example.com"; // seeded, pre-verified, ACTIVE
  const customerPassword = "FundedE2E!Pass1";
  const adminEmail = "e2e-admin@example.com"; // seeded, pre-verified, ADMIN
  const adminPassword = "AdminE2E!Pass1";
  const depositAmount = "250";
  const transactionRef = `E2E-DEP-${Date.now()}`;

  test("a logged-in customer can submit a deposit request", async ({ page }) => {
    await loginAs(page, customerEmail, customerPassword);
    await page.goto("/dashboard/wallet");

    // DepositForm's <label>s aren't associated to their inputs via
    // htmlFor/id (see components/dashboard/deposit-form.tsx), so
    // getByLabel() won't match them — use each field's distinctive
    // placeholder/element type instead, exactly like a real user would
    // identify them visually.
    await page.locator("select").selectOption("MANUAL");
    await page.getByPlaceholder("500").fill(depositAmount);
    await page.getByPlaceholder(/enter your payment reference/i).fill(transactionRef);
    await page.getByRole("button", { name: /submit payment/i }).click();

    await expect(page.getByText(/deposit request submitted/i)).toBeVisible({ timeout: 10_000 });
  });

  test("an admin can see and approve the pending deposit", async ({ page }) => {
    await loginAs(page, adminEmail, adminPassword);
    await page.goto("/admin/payments");

    const row = page.locator("tr", { hasText: transactionRef });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row.getByText(/pending/i)).toBeVisible();

    // The real component uses a native `confirm()` dialog before approving
    // (components/admin/payments-table.tsx) — must be accepted for the
    // click to actually proceed, exactly like a real admin clicking
    // "Approve" and confirming the browser prompt.
    page.once("dialog", (dialog) => dialog.accept());
    await row.getByTitle("Approve").click();

    // After approval the row re-renders via router.refresh() with the
    // updated status — wait for the PENDING badge to actually disappear
    // from this row rather than a fixed sleep.
    await expect(row.getByText(/pending/i)).not.toBeVisible({ timeout: 10_000 });
  });

  test("the customer's wallet balance reflects the approved deposit", async ({ page }) => {
    await loginAs(page, customerEmail, customerPassword);
    await page.goto("/dashboard/wallet");

    // Seeded starting balance is 500 (see e2e/global-setup.ts) + the 250
    // deposit approved above = 750.
    await expect(page.getByText("750.00", { exact: false })).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("Order placement", () => {
  const customerEmail = "e2e-funded@example.com";
  const customerPassword = "FundedE2E!Pass1";

  test("a funded customer can place an order and see it in their order history", async ({ page }) => {
    await loginAs(page, customerEmail, customerPassword);
    await page.goto("/dashboard/services");

    // Seeded in e2e/global-setup.ts: "E2E Smoke Test Service", no provider
    // attached, so a placed order lands in PROCESSING ("awaiting manual
    // fulfillment") rather than being auto-dispatched anywhere — the
    // correct, real behavior for a service with no configured provider
    // (see lib/fulfillment.ts), and sufficient to prove `placeOrder`'s
    // wallet-debit + order-creation transaction ran correctly end-to-end
    // through the real UI.
    // OrderForm's <label>s (like DepositForm's) aren't associated to their
    // inputs via htmlFor/id, so structural locators are used instead —
    // the service <select> is already defaulted to the only seeded
    // service (see e2e/global-setup.ts), so it doesn't need to be
    // explicitly selected, but confirm it anyway as a guard against a
    // future seed change silently breaking this test's assumption.
    await expect(page.locator("select")).toContainText(/E2E Smoke Test Service/i);
    const target = `https://t.me/e2e_test_target_${Date.now()}`;
    await page.getByPlaceholder(/t\.me\/yourchannel/i).fill(target);
    await page.locator('input[type="number"]').fill("100");
    await page.getByRole("button", { name: /place order/i }).click();

    await expect(page.getByText(/order placed successfully/i)).toBeVisible({ timeout: 10_000 });

    await page.goto("/dashboard/orders");
    const row = page.locator("tr", { hasText: target.slice(-20) });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row.getByText(/E2E Smoke Test Service/i)).toBeVisible();
  });
});
