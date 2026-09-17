import { Prisma } from "@/lib/generated/prisma";

/**
 * Helpers to safely work with money fields without ever dropping into
 * native floating-point arithmetic.
 *
 * This is the Postgres/Prisma-era rewrite of the original MongoDB version
 * of this file, which manually reimplemented fixed-point arithmetic via
 * BigInt because `mongodb`'s `Decimal128` type has no arithmetic methods of
 * its own. Prisma's `Decimal` type (re-exported here as `Prisma.Decimal`)
 * is actually decimal.js under the hood, which already has correct,
 * battle-tested arbitrary-precision decimal arithmetic built in — so this
 * version is a thin, intent-revealing wrapper around decimal.js's own
 * methods rather than a manual reimplementation. The public API of this
 * file (function names/signatures) is kept identical to the original so
 * every call site elsewhere in this codebase needed no changes beyond the
 * import already being updated by the wider migration.
 */
const SCALE = 4; // matches the original convention: Decimal(18, 4) columns

export type Money = Prisma.Decimal;

export function toDecimal128(value: number | string | Money): Money {
  if (value instanceof Prisma.Decimal) return value.toDecimalPlaces(SCALE);
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (!Number.isFinite(num)) throw new Error("Invalid numeric value for money field");
  return new Prisma.Decimal(num.toFixed(SCALE));
}

export function decimalToNumber(value: Money | number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "string") return parseFloat(value);
  return value.toNumber();
}

export function addMoney(a: Money | number | string, b: Money | number | string): Money {
  return toDecimal128(a).plus(toDecimal128(b)).toDecimalPlaces(SCALE);
}

export function subtractMoney(a: Money | number | string, b: Money | number | string): Money {
  return toDecimal128(a).minus(toDecimal128(b)).toDecimalPlaces(SCALE);
}

export function isGreaterOrEqual(a: Money | number | string, b: Money | number | string): boolean {
  return toDecimal128(a).greaterThanOrEqualTo(toDecimal128(b));
}

export function isPositive(a: Money | number | string): boolean {
  return toDecimal128(a).greaterThan(0);
}

/** Compute order charge = (rate per 1000) * quantity / 1000, rounded to 4dp. */
export function calculateCharge(ratePer1000: Money | number | string, quantity: number): Money {
  const rate = toDecimal128(ratePer1000);
  return rate.times(quantity).dividedBy(1000).toDecimalPlaces(SCALE);
}

export function formatMoney(value: Money | number | string, currency = "USD"): string {
  const n = decimalToNumber(value);
  return new Intl.NumberFormat("en-US", { style: "currency", currency, currencyDisplay: "narrowSymbol" }).format(n);
}
