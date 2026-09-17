import { connectDB, prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { changeOrderStatus } from "@/lib/services/admin-orders";
import { issuePartialRefund } from "@/lib/services/refunds";
import { logger } from "@/lib/logger";
import type { Order, Provider, Prisma } from "@/lib/generated/prisma";

function appendHistory(order: { statusHistory: Prisma.JsonValue }, status: string, note: string, at: Date) {
  const existing = Array.isArray(order.statusHistory) ? order.statusHistory : [];
  return [...existing, { status, note, at: at.toISOString() }];
}

/**
 * Fulfillment layer — dispatches a PENDING order to its provider.
 *
 * Three provider types are supported:
 *  - MANUAL: no automated action; an admin processes it from the admin panel.
 *  - INTERNAL: fulfilled by this platform's own automation (e.g. a Telegram
 *    bot action the organization is authorized to run). Implement the actual
 *    action in `runInternalFulfillment` for your specific compliant use case.
 *  - API: calls an upstream SMM-panel-style HTTP API (typical `action=add`
 *    contract). Adjust `callProviderApi` to match your specific provider's
 *    contract if it differs.
 *
 * This function is intentionally resilient: it never throws in a way that
 * would roll back the (already-committed) customer payment. Errors are
 * recorded on the order for admin visibility and retried by the worker
 * script (scripts/process-orders.ts) on a schedule.
 *
 * Multi-provider fallback (docs/IMPLEMENTATION_PLAN.md Phase 2.1): a
 * `Service` can now have multiple `ServiceProvider` links, tried in
 * ascending `priority` order within a SINGLE dispatch attempt — if
 * provider A's API call fails, provider B is tried immediately, rather
 * than waiting for the next scheduled retry against the same broken
 * provider. Services that haven't been backfilled into `ServiceProvider`
 * yet (see scripts/backfill-service-providers.ts) fall back to the legacy
 * single-provider fields on `Service` (`providerId`/`providerServiceId`/
 * `providerRate`) — this is a zero-migration-required fallback, not a
 * required step before this feature works.
 */
export async function dispatchOrderToProvider(orderId: string): Promise<void> {
  await connectDB();

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  // Retry-eligible states: a fresh PENDING order, or a PROCESSING order that
  // got there because every candidate provider failed this round (signaled
  // by a non-null `lastError` — cleared to null on any successful dispatch,
  // including the MANUAL "awaiting human" outcome). This distinction matters
  // because PROCESSING is overloaded: it also means "successfully handed to
  // a MANUAL provider, awaiting a human" (lastError === null in that case),
  // which must NOT be re-dispatched on every worker pass.
  const isRetryEligibleFailure = order?.status === "PROCESSING" && order.lastError != null;
  if (!order || (order.status !== "PENDING" && !isRetryEligibleFailure)) return;

  const candidates = await resolveDispatchCandidates(order.serviceId);

  if (candidates.length === 0) {
    // No provider configured at all -> requires manual fulfillment by an admin.
    await prisma.order.update({
      where: { id: order.id },
      data: {
        attempts: { increment: 1 },
        lastAttemptAt: new Date(),
        status: "PROCESSING",
        statusHistory: appendHistory(order, "PROCESSING", "Awaiting manual fulfillment", new Date()),
      },
    });
    return;
  }

  const attemptErrors: string[] = [];
  const workingOrder: Order = order;

  for (const candidate of candidates) {
    const provider = candidate.provider;

    if (!provider || provider.status !== "ACTIVE") {
      attemptErrors.push(`${candidate.providerName ?? "Unknown provider"}: unavailable`);
      continue;
    }

    try {
      const priorFailureNote =
        attemptErrors.length > 0
          ? ` (after ${attemptErrors.length} earlier provider failure(s) this attempt: ${attemptErrors.join("; ")})`
          : "";

      const now = new Date();
      let update: Prisma.OrderUncheckedUpdateInput = {};

      if (provider.type === "MANUAL") {
        update = {
          providerId: provider.id,
          status: "PROCESSING",
          statusHistory: appendHistory(
            workingOrder,
            "PROCESSING",
            `Awaiting manual fulfillment (provider: ${candidate.providerName ?? "unknown"})${priorFailureNote}`,
            now
          ),
        };
      } else if (provider.type === "INTERNAL") {
        const result = await runInternalFulfillment(workingOrder);
        if (result.automated) {
          update = {
            providerId: provider.id,
            providerOrderId: result.providerOrderId ?? null,
            status: "IN_PROGRESS",
            statusHistory: appendHistory(
              workingOrder,
              "IN_PROGRESS",
              `Dispatched to internal automation (provider: ${candidate.providerName ?? "unknown"})${priorFailureNote}`,
              now
            ),
          };
        } else {
          update = {
            status: "PROCESSING",
            statusHistory: appendHistory(
              workingOrder,
              "PROCESSING",
              `Awaiting manual fulfillment — internal automation is not yet implemented for provider "${candidate.providerName ?? "unknown"}"${priorFailureNote}`,
              now
            ),
          };
        }
      } else if (provider.type === "API") {
        const result = await callProviderApi(workingOrder, provider, candidate.providerServiceId);
        update = {
          providerId: provider.id,
          providerOrderId: result.orderId,
          providerResponse: result.raw as Prisma.InputJsonValue,
          status: "IN_PROGRESS",
          statusHistory: appendHistory(
            workingOrder,
            "IN_PROGRESS",
            `Dispatched to ${candidate.providerName ?? "provider"} (id: ${result.orderId})${priorFailureNote}`,
            now
          ),
        };
      }

      await prisma.order.update({
        where: { id: order.id },
        data: {
          attempts: { increment: 1 },
          lastAttemptAt: now,
          lastError: null,
          ...update,
        } as Prisma.OrderUncheckedUpdateInput,
      });
      return; // success — stop trying further candidates
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown dispatch error";
      attemptErrors.push(`${candidate.providerName ?? "provider"}: ${message}`);
      // Fall through to the next candidate, if any.
    }
  }

  // Every candidate failed (or was unavailable) within this attempt — leave
  // the order in PROCESSING for the next scheduled retry pass, same
  // "never silently lose a charged order" behavior as before, now just
  // informed by every provider that was tried this round, not only one.
  const lastError = attemptErrors.join("; ");
  const now = new Date();
  await prisma.order.update({
    where: { id: order.id },
    data: {
      attempts: { increment: 1 },
      lastAttemptAt: now,
      lastError,
      status: "PROCESSING",
      statusHistory: appendHistory(
        workingOrder,
        "PROCESSING",
        `All ${candidates.length} provider(s) failed this attempt: ${lastError}`,
        now
      ),
    },
  });
}

interface DispatchCandidate {
  provider: Provider | null;
  providerName: string | null;
  providerServiceId: string;
}

/**
 * Resolves the ordered list of providers to try for a service. Prefers
 * `ServiceProvider` rows (priority-ordered, multi-provider) and falls back
 * to the service's legacy single-provider fields when no rows exist yet —
 * see the module doc comment above for why both paths exist.
 */
async function resolveDispatchCandidates(serviceId: string): Promise<DispatchCandidate[]> {
  const links = await prisma.serviceProvider.findMany({
    where: { serviceId, active: true },
    orderBy: { priority: "asc" },
    include: { provider: true },
  });

  if (links.length > 0) {
    return links.map((link) => ({
      provider: link.provider ?? null,
      providerName: link.provider?.name ?? null,
      providerServiceId: link.providerServiceId,
    }));
  }

  const service = await prisma.service.findUnique({
    where: { id: serviceId },
    select: { providerId: true, providerServiceId: true },
  });
  if (!service?.providerId) return [];

  const provider = await prisma.provider.findUnique({ where: { id: service.providerId } });
  if (!provider) return [];

  return [
    {
      provider,
      providerName: provider.name,
      providerServiceId: service.providerServiceId ?? "",
    },
  ];
}

interface ProviderApiResult {
  orderId: string;
  raw: unknown;
}

async function callProviderApi(order: Order, provider: Provider, providerServiceId: string): Promise<ProviderApiResult> {
  if (!provider.apiUrl || !provider.apiKeyEncrypted) {
    throw new Error("Provider is missing API configuration");
  }

  const apiKey = decryptSecret(provider.apiKeyEncrypted);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(provider.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        key: apiKey,
        action: "add",
        service: providerServiceId || order.serviceId,
        link: order.target,
        quantity: String(order.quantity),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Provider API returned HTTP ${res.status}`);
    }

    const data = await res.json();

    if (data.error) {
      throw new Error(`Provider API error: ${data.error}`);
    }

    if (!data.order) {
      throw new Error("Provider API response missing order id");
    }

    return { orderId: String(data.order), raw: data };
  } finally {
    clearTimeout(timeout);
  }
}

interface ProviderRefillResult {
  refillId: string;
  raw: unknown;
}

/**
 * Requests a refill from an upstream API provider for an already-dispatched
 * order (docs/IMPLEMENTATION_PLAN.md Phase 3.1). Mirrors `callProviderApi`'s
 * structure/error handling exactly — same timeout, same
 * `{error}`-in-body-means-failure convention, same "throw on anything
 * unexpected, let the caller decide what to do" contract. Only meaningful
 * for `API`-type providers; MANUAL/INTERNAL orders never reach this
 * function (see `lib/services/refill.ts#requestRefill`, which routes those
 * to manual admin review instead).
 */
export async function requestProviderRefill(order: Order, provider: Provider): Promise<ProviderRefillResult> {
  if (!provider.apiUrl || !provider.apiKeyEncrypted) {
    throw new Error("Provider is missing API configuration");
  }
  if (!order.providerOrderId) {
    throw new Error("Order has no provider order id to refill");
  }

  const apiKey = decryptSecret(provider.apiKeyEncrypted);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(provider.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        key: apiKey,
        action: "refill",
        order: order.providerOrderId,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Provider API returned HTTP ${res.status}`);
    }

    const data = await res.json();

    if (data.error) {
      throw new Error(`Provider API error: ${data.error}`);
    }

    if (!data.refill) {
      throw new Error("Provider API response missing refill id");
    }

    return { refillId: String(data.refill), raw: data };
  } finally {
    clearTimeout(timeout);
  }
}

interface ProviderStatusResult {
  /** Raw provider status string (e.g. "Completed", "Partial", "In progress") — not yet normalized to this project's OrderStatus enum. */
  status: string;
  remains: number | null;
  startCount: number | null;
  raw: unknown;
}

async function callProviderStatusApi(order: Order, provider: Provider): Promise<ProviderStatusResult> {
  if (!provider.apiUrl || !provider.apiKeyEncrypted) {
    throw new Error("Provider is missing API configuration");
  }
  if (!order.providerOrderId) {
    throw new Error("Order has no provider order id to check status for");
  }

  const apiKey = decryptSecret(provider.apiKeyEncrypted);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(provider.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        key: apiKey,
        action: "status",
        order: order.providerOrderId,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Provider API returned HTTP ${res.status}`);
    }

    const data = await res.json();

    if (data.error) {
      throw new Error(`Provider API error: ${data.error}`);
    }
    if (!data.status) {
      throw new Error("Provider API response missing status");
    }

    const remains = data.remains !== undefined && data.remains !== null ? Number(data.remains) : null;
    const startCount =
      data.start_count !== undefined && data.start_count !== null ? Number(data.start_count) : null;

    return {
      status: String(data.status),
      remains: Number.isFinite(remains) ? remains : null,
      startCount: Number.isFinite(startCount) ? startCount : null,
      raw: data,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Polls an upstream API provider for the current delivery status of an
 * already-`IN_PROGRESS` order (docs/IMPLEMENTATION_PLAN.md Phase 3.2) and
 * reconciles our own `Order` accordingly:
 *  - provider reports "completed" -> transition to COMPLETED (via the same
 *    `changeOrderStatus` used by admin actions, so `completedAt` gets set
 *    identically regardless of which path completes an order).
 *  - provider reports "partial" (with remains > 0) -> issue a proportional
 *    refund via `issuePartialRefund` (idempotent — see that function).
 *  - provider reports "partial" with remains <= 0 (a contradiction some
 *    providers exhibit) -> treated as a plain completion, not a 0-amount
 *    refund with no real effect.
 *  - anything else (pending/in progress/processing) -> just persist the
 *    latest `remains`/`startCount`/`lastStatusCheckAt`, no state transition.
 *
 * This is intentionally read-mostly and resilient: MANUAL/INTERNAL orders,
 * orders with no `providerOrderId` yet, and orders not currently
 * `IN_PROGRESS` are all safely skipped (not errors) — the calling worker
 * script's candidate query only selects orders where polling is meaningful
 * in the first place, but this function re-checks defensively since it can
 * also be called directly (e.g. from a future admin "check now" action).
 */
export async function pollOrderStatus(orderId: string): Promise<void> {
  await connectDB();

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order || order.status !== "IN_PROGRESS" || !order.providerId || !order.providerOrderId) {
    return;
  }

  const provider = await prisma.provider.findUnique({ where: { id: order.providerId } });
  if (!provider || provider.type !== "API") {
    return;
  }

  const now = new Date();

  let result: ProviderStatusResult;
  try {
    result = await callProviderStatusApi(order, provider);
  } catch (err) {
    await prisma.order.update({
      where: { id: orderId },
      data: {
        lastStatusCheckAt: now,
        lastError: err instanceof Error ? err.message : "Status check failed",
      },
    });
    return;
  }

  const normalized = result.status.trim().toLowerCase();

  const baseUpdate: Prisma.OrderUncheckedUpdateInput = {
    lastStatusCheckAt: now,
    ...(result.remains !== null ? { remains: result.remains } : {}),
    ...(result.startCount !== null && order.startCount === null ? { startCount: result.startCount } : {}),
  };

  if (normalized === "completed") {
    await prisma.order.update({ where: { id: orderId }, data: baseUpdate }); // persist remains/lastStatusCheckAt first
    await changeOrderStatus(orderId, "COMPLETED", "Provider reported delivery complete");
    return;
  }

  if (normalized === "partial" && (result.remains ?? 0) > 0) {
    await prisma.order.update({ where: { id: orderId }, data: baseUpdate }); // persist remains/lastStatusCheckAt first
    await issuePartialRefund(orderId, result.remains ?? 0);
    return;
  }

  if (normalized === "partial") {
    // remains <= 0 despite a "Partial" report — nothing left undelivered,
    // treat as a plain completion rather than a meaningless 0-amount refund.
    await prisma.order.update({ where: { id: orderId }, data: baseUpdate });
    await changeOrderStatus(orderId, "COMPLETED", "Provider reported delivery complete");
    return;
  }

  // pending / in progress / processing — nothing to transition, just persist.
  await prisma.order.update({ where: { id: orderId }, data: baseUpdate });
}

interface InternalFulfillmentResult {
  /** True only if a real automated action actually ran (not just logged). */
  automated: boolean;
  providerOrderId?: string;
}

/**
 * Dispatch point for `INTERNAL`-type providers — fulfillment performed by
 * this platform's own bot/automation rather than an external HTTP API or a
 * human admin. No default "engagement" behavior is implemented here on
 * purpose (see `prisma/schema.prisma`'s Provider model compliance note:
 * this platform does not ship fake-engagement automation). If/when a
 * specific compliant internal action is defined (e.g. a Telegram bot
 * action this organization is directly authorized to run against
 * consenting users), implement it in this function and set
 * `automated: true` once it actually runs.
 *
 * Until then, this deliberately reports `automated: false` so the caller
 * (`dispatchOrderToProvider`) does NOT claim the order is `IN_PROGRESS` —
 * it instead falls back to the same "awaiting manual fulfillment" state
 * used for `MANUAL` providers, with a note that makes the gap visible on
 * the order's status history for admins, rather than silently no-op'ing
 * while claiming automated delivery started.
 */
async function runInternalFulfillment(order: Order): Promise<InternalFulfillmentResult> {
  logger.warn(
    { orderId: order.id },
    "[fulfillment] INTERNAL provider dispatch has no automation implemented — falling back to manual admin fulfillment"
  );
  return { automated: false };
}
