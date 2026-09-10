import { z } from "zod";

/** Strong password policy — enforced both client and server side. */
export const passwordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .max(128)
  .regex(/[a-z]/, "Password must contain a lowercase letter")
  .regex(/[A-Z]/, "Password must contain an uppercase letter")
  .regex(/[0-9]/, "Password must contain a number")
  .regex(/[^a-zA-Z0-9]/, "Password must contain a special character");

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email().max(255),
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
});

export const serviceGroupSchema = z.object({
  name: z.string().trim().min(2).max(100),
  icon: z.string().trim().max(20).optional().nullable(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export const categorySchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(1000).optional().nullable(),
  /** Empty string means "no group" (from a <select> default option) — normalized to null before use. */
  groupId: z.string().trim().min(1).optional().nullable(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

/**
 * Base object schema, deliberately kept separate from `serviceSchema`'s
 * `.refine()` wrapper below — Zod does not allow `.partial()` on a schema
 * that already has a `.refine()`/`.superRefine()` cross-field check applied
 * ("`.partial()` cannot be used on object schemas containing refinements").
 * `app/api/admin/services/[id]/route.ts`'s PATCH handler needs a genuinely
 * partial version of this schema (a service edit may only touch one field,
 * e.g. just `refillDays`), so it imports THIS base object and calls
 * `.partial()` on it directly, rather than on `serviceSchema` itself. Found
 * live during Phase 3.1 verification: the admin services PATCH route threw
 * a 500 on every request (including totally unrelated field edits, e.g.
 * just toggling `active`) the moment the Phase 3.1 `maxQuantity`
 * cross-field `.refine()` existed on this schema at all — this was a
 * latent, pre-existing bug waiting to be triggered by the first refinement
 * ever added to `serviceSchema`, not something specific to `refillDays`.
 */
export const serviceBaseSchema = z.object({
  categoryId: z.string().min(1),
  name: z.string().trim().min(2).max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  rate: z.number().positive(),
  providerId: z.string().optional().nullable(),
  providerServiceId: z.string().optional().nullable(),
  minQuantity: z.number().int().positive(),
  maxQuantity: z.number().int().positive(),
  active: z.boolean().optional(),
  // docs/IMPLEMENTATION_PLAN.md Phase 3.1 — null (the default, via
  // .nullable() with no default here since this schema is also used with
  // .partial() for PATCH) means "this service does not support refills".
  refillDays: z.number().int().nonnegative().nullable().optional(),
});

export const serviceSchema = serviceBaseSchema.refine((data) => data.maxQuantity >= data.minQuantity, {
  message: "maxQuantity must be >= minQuantity",
  path: ["maxQuantity"],
});

export const orderSchema = z.object({
  serviceId: z.string().min(1),
  target: z
    .string()
    .trim()
    .min(1)
    .max(500)
    // Basic guard against obviously malicious input; deeper per-service
    // target validation (e.g. valid t.me link) happens in the order route.
    .regex(/^[^\s<>"]+$/, "Target contains invalid characters"),
  quantity: z.number().int().positive(),
});

export const paymentSchema = z.object({
  amount: z.number().positive().max(1_000_000),
  method: z.enum(["BKASH", "NAGAD", "SSLCOMMERZ", "MANUAL", "CRYPTO"]),
  transactionRef: z.string().trim().min(3).max(100),
});

export const providerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  type: z.enum(["API", "MANUAL", "INTERNAL"]),
  apiUrl: z.string().url().optional().nullable(),
  apiKey: z.string().optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});

/**
 * ServiceProvider — links a Service to a Provider with a fallback priority
 * (docs/IMPLEMENTATION_PLAN.md Phase 2.1). `providerRate` intentionally
 * mirrors `serviceSchema`'s `rate`/`providerRate` numeric convention (plain
 * `z.number()`, converted to Decimal128 at the model layer via
 * `lib/money.ts#toDecimal128`) rather than accepting a string here.
 */
export const serviceProviderSchema = z.object({
  serviceId: z.string().min(1),
  providerId: z.string().min(1),
  providerServiceId: z.string().trim().min(1).max(200),
  providerRate: z.number().nonnegative(),
  priority: z.number().int().min(0).optional(),
  active: z.boolean().optional(),
});

export const apiKeyCreateSchema = z.object({
  label: z.string().trim().min(1).max(100).optional().nullable(),
});

/**
 * `/api/v2` reseller endpoint request body (docs/IMPLEMENTATION_PLAN.md
 * Phase 2.2). Deliberately permissive/untyped-per-action at this top level —
 * `key`/`action` are the only fields validated here; each action handler in
 * `app/api/v2/route.ts` further validates its own action-specific fields
 * (mirroring how real SMM-panel APIs accept one flat form-encoded or JSON
 * body regardless of action, rather than a discriminated-union schema).
 */
export const apiV2RequestSchema = z.object({
  key: z.string().trim().min(1).optional(),
  action: z.enum(["services", "add", "status", "balance", "refill", "cancel"]),
  service: z.union([z.string(), z.number()]).optional(),
  link: z.string().trim().max(500).optional(),
  quantity: z.union([z.string(), z.number()]).optional(),
  order: z.union([z.string(), z.number()]).optional(),
  orders: z.string().optional(),
});

export const ticketSchema = z.object({
  subject: z.string().trim().min(3).max(200),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),
  message: z.string().trim().min(1).max(5000),
});

export const ticketMessageSchema = z.object({
  message: z.string().trim().min(1).max(5000),
});

export const userStatusSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED", "BANNED"]),
});

export const userRoleSchema = z.object({
  role: z.enum(["USER", "ADMIN"]),
});

export const settingsSchema = z.object({
  siteName: z.string().trim().min(1).max(100).optional(),
  siteDescription: z.string().trim().max(1000).optional().nullable(),
  supportEmail: z.string().trim().email().optional().nullable(),
  minDeposit: z.number().positive().optional(),
  maxDeposit: z.number().positive().optional(),
  registrationEnabled: z.boolean().optional(),
  maintenanceMode: z.boolean().optional(),
});

/** `/dashboard/settings` — updating one's own display name (docs/DASHBOARD_UPGRADE_PLAN.md §3.3). */
export const accountUpdateSchema = z.object({
  name: z.string().trim().min(2).max(100),
});

/**
 * `/dashboard/settings` — self-service password change. Re-uses the same
 * `passwordSchema` strength rules as registration/reset so a user can never
 * set a self-service password weaker than what's required at signup.
 */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: passwordSchema,
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: "New password must be different from your current password",
    path: ["newPassword"],
  });

/** `/dashboard/services` — toggling a service on/off the caller's favorites list. */
export const favoriteServiceSchema = z.object({
  serviceId: z.string().min(1),
});
