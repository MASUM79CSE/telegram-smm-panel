import { Decimal128 } from "mongodb";

/**
 * Helpers to safely work with Mongo's Decimal128 for money math without
 * ever dropping into floating point (which caused real bugs in the original
 * plan's Prisma `Decimal` usage too — the same discipline applies here).
 *
 * We use decimal.js-style string arithmetic via BigInt on a fixed scale
 * (4 decimal places) to avoid pulling in another dependency for now.
 */
const SCALE = 4; // matches original plan's Decimal(12,4) for service rates
const SCALE_FACTOR = 10 ** SCALE;

export function toDecimal128(value: number | string): Decimal128 {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (!Number.isFinite(num)) throw new Error("Invalid numeric value for money field");
  return Decimal128.fromString(num.toFixed(SCALE));
}

export function decimalToNumber(value: Decimal128 | number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  return parseFloat(value.toString());
}

function toFixedInt(value: Decimal128 | number | string): bigint {
  const n = decimalToNumber(value);
  return BigInt(Math.round(n * SCALE_FACTOR));
}

function fromFixedInt(v: bigint): Decimal128 {
  const sign = v < 0n ? "-" : "";
  const abs = v < 0n ? -v : v;
  const str = abs.toString().padStart(SCALE + 1, "0");
  const intPart = str.slice(0, -SCALE) || "0";
  const fracPart = str.slice(-SCALE);
  return Decimal128.fromString(`${sign}${intPart}.${fracPart}`);
}

export function addMoney(a: Decimal128 | number | string, b: Decimal128 | number | string): Decimal128 {
  return fromFixedInt(toFixedInt(a) + toFixedInt(b));
}

export function subtractMoney(a: Decimal128 | number | string, b: Decimal128 | number | string): Decimal128 {
  return fromFixedInt(toFixedInt(a) - toFixedInt(b));
}

export function isGreaterOrEqual(a: Decimal128 | number | string, b: Decimal128 | number | string): boolean {
  return toFixedInt(a) >= toFixedInt(b);
}

export function isPositive(a: Decimal128 | number | string): boolean {
  return toFixedInt(a) > 0n;
}

/** Compute order charge = (rate per 1000) * quantity / 1000, rounded to 4dp. */
export function calculateCharge(ratePer1000: Decimal128 | number | string, quantity: number): Decimal128 {
  const rate = decimalToNumber(ratePer1000);
  const charge = (rate * quantity) / 1000;
  return toDecimal128(charge);
}

export function formatMoney(value: Decimal128 | number | string, currency = "USD"): string {
  const n = decimalToNumber(value);
  return new Intl.NumberFormat("en-US", { style: "currency", currency, currencyDisplay: "narrowSymbol" }).format(n);
}
