import { describe, it, expect } from "vitest";
import { Decimal128 } from "mongodb";
import {
  toDecimal128,
  decimalToNumber,
  addMoney,
  subtractMoney,
  isGreaterOrEqual,
  isPositive,
  calculateCharge,
  formatMoney,
} from "@/lib/money";

/**
 * Money math must never drop into native floating point (that's the whole
 * point of `lib/money.ts` — see its file header). These tests specifically
 * target classic floating-point failure cases (e.g. 0.1 + 0.2) to guard
 * against a regression back to plain `number` arithmetic.
 */
describe("lib/money", () => {
  describe("toDecimal128 / decimalToNumber round-trip", () => {
    it("preserves 4 decimal places", () => {
      const d = toDecimal128(12.3456);
      expect(decimalToNumber(d)).toBeCloseTo(12.3456, 4);
    });

    it("accepts string input", () => {
      const d = toDecimal128("99.9900");
      expect(decimalToNumber(d)).toBeCloseTo(99.99, 4);
    });

    it("throws on non-finite input", () => {
      expect(() => toDecimal128(NaN)).toThrow();
      expect(() => toDecimal128(Infinity)).toThrow();
    });

    it("decimalToNumber treats null/undefined as 0", () => {
      expect(decimalToNumber(null)).toBe(0);
      expect(decimalToNumber(undefined)).toBe(0);
    });

    it("decimalToNumber passes through plain numbers", () => {
      expect(decimalToNumber(42)).toBe(42);
    });
  });

  describe("addMoney / subtractMoney", () => {
    it("avoids classic floating point error (0.1 + 0.2)", () => {
      const result = addMoney(0.1, 0.2);
      expect(decimalToNumber(result)).toBe(0.3);
    });

    it("adds two Decimal128 values precisely", () => {
      const a = toDecimal128("10.5000");
      const b = toDecimal128("0.0001");
      const sum = addMoney(a, b);
      expect(decimalToNumber(sum)).toBeCloseTo(10.5001, 4);
    });

    it("subtracts correctly including going negative", () => {
      const result = subtractMoney(5, 7.5);
      expect(decimalToNumber(result)).toBe(-2.5);
    });

    it("subtract then add returns to original (round trip)", () => {
      const start = toDecimal128("100.0000");
      const afterSub = subtractMoney(start, 33.3333);
      const restored = addMoney(afterSub, 33.3333);
      expect(decimalToNumber(restored)).toBeCloseTo(100, 4);
    });
  });

  describe("isGreaterOrEqual / isPositive", () => {
    it("isGreaterOrEqual is true for equal values", () => {
      expect(isGreaterOrEqual(10, 10)).toBe(true);
    });

    it("isGreaterOrEqual is false when a < b", () => {
      expect(isGreaterOrEqual(5, 5.01)).toBe(false);
    });

    it("isPositive is false for zero and negative", () => {
      expect(isPositive(0)).toBe(false);
      expect(isPositive(-0.0001)).toBe(false);
    });

    it("isPositive is true for any positive amount, however small", () => {
      expect(isPositive(0.0001)).toBe(true);
    });
  });

  describe("calculateCharge", () => {
    it("computes rate-per-1000 * quantity / 1000", () => {
      // $2.50 per 1000 units, order of 4000 units => $10.00
      const charge = calculateCharge(2.5, 4000);
      expect(decimalToNumber(charge)).toBeCloseTo(10, 4);
    });

    it("handles fractional quantities/rates without drift", () => {
      const charge = calculateCharge("1.3333", 750);
      expect(decimalToNumber(charge)).toBeCloseTo((1.3333 * 750) / 1000, 3);
    });

    it("returns zero charge for zero quantity", () => {
      const charge = calculateCharge(9.99, 0);
      expect(decimalToNumber(charge)).toBe(0);
    });
  });

  describe("formatMoney", () => {
    it("formats a Decimal128 as USD currency by default", () => {
      const formatted = formatMoney(toDecimal128(19.99));
      expect(formatted).toContain("19.99");
      expect(formatted).toMatch(/\$/);
    });

    it("formats a plain number in a given currency", () => {
      const formatted = formatMoney(5, "EUR");
      expect(formatted).toContain("5.00");
    });

    it("formats Decimal128.fromString directly (not just via toDecimal128)", () => {
      const formatted = formatMoney(Decimal128.fromString("1000.5"));
      expect(formatted).toContain("1,000.50");
    });
  });
});
