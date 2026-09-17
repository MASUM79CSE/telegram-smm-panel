import type { Page } from "@playwright/test";
import { readFileSync } from "fs";
import { PrismaClient } from "../lib/generated/prisma";

/**
 * Shared helpers for the e2e smoke suite. Kept intentionally small — these
 * tests are meant to exercise the real UI (clicking real buttons, filling
 * real forms), not to reimplement app logic; a helper here only exists
 * where reaching into a channel a real user has, but this suite doesn't
 * (their inbox — see `readLatestVerificationLink` below), is the only way
 * to complete a flow.
 */

let testDbClient: PrismaClient | undefined;

export function connectToTestDb(): PrismaClient {
  if (testDbClient) return testDbClient;
  const uri = process.env.DATABASE_URL;
  if (!uri) {
    throw new Error(
      "DATABASE_URL is not set — e2e helpers must run after globalSetup has populated it (see e2e/global-setup.ts)."
    );
  }
  testDbClient = new PrismaClient({ datasourceUrl: uri });
  return testDbClient;
}


/** Fills and submits the login form, using the exact field labels/placeholders the real LoginForm component renders. */
export async function loginAs(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByPlaceholder("••••••••••").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
}

/**
 * Reads the most recent email-verification link straight out of the
 * server's own stdout log.
 *
 * Why: this suite deliberately runs with no SMTP configured (see
 * `e2e/global-setup.ts`'s header comment), so `lib/mail.ts#sendMail` takes
 * its documented dev fallback — logging the subject and full HTML body to
 * the server's console instead of sending it — rather than the email
 * actually being delivered anywhere this test could read it from. A real
 * user would click the link in their inbox; `playwright.config.ts`'s
 * `webServer.command` redirects that same server's stdout+stderr to
 * `E2E_SERVER_LOG_PATH` specifically so this helper can recover the exact
 * same link a real user's email would have contained, and complete the
 * verification flow by actually navigating to it — rather than skipping
 * email verification or faking its result via a direct DB write, which
 * would silently stop covering the real `/api/verify-email` route.
 */
export function readLatestVerificationLink(appBaseUrl: string): string {
  const logPath = process.env.E2E_SERVER_LOG_PATH;
  if (!logPath) {
    throw new Error("E2E_SERVER_LOG_PATH is not set — see playwright.config.ts's webServer.command.");
  }

  const log = readFileSync(logPath, "utf8");
  const escapedBase = appBaseUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const linkPattern = new RegExp(`${escapedBase}/verify-email\\?token=[a-f0-9]+`, "g");
  const matches = log.match(linkPattern);

  if (!matches || matches.length === 0) {
    throw new Error(
      `No verification link found in server log at ${logPath}. Expected a URL matching ${appBaseUrl}/verify-email?token=... — check that /api/register actually ran and that lib/mail.ts's dev-fallback console.warn wasn't changed.`
    );
  }

  // Last match = most recently generated link, in case multiple accounts
  // were registered earlier in the same test run.
  return matches[matches.length - 1];
}

