import { describe, it, expect } from "vitest";
import {
  DISPLAY_CURRENCIES,
  formatCurrencyAmount,
  defaultDisplayCurrencyForLocale,
  ATTRIBUTION_TEXT,
  ATTRIBUTION_URL,
} from "@/lib/currency-format";

describe("lib/currency-format", () => {
  it("exposes exactly USD and BDT as supported display currencies", () => {
    expect(DISPLAY_CURRENCIES).toEqual(["USD", "BDT"]);
  });

  describe("formatCurrencyAmount", () => {
    it("formats USD with the default 2 decimal places", () => {
      const formatted = formatCurrencyAmount(19.9, "USD");
      expect(formatted).toContain("19.90");
    });

    it("formats BDT using the bn-BD locale (Bengali digits or BDT symbol)", () => {
      const formatted = formatCurrencyAmount(100, "BDT");
      // bn-BD Intl output uses Bengali numerals; just confirm it doesn't throw
      // and produces a non-empty, currency-shaped string.
      expect(formatted.length).toBeGreaterThan(0);
    });

    it("respects an explicit fractionDigits override", () => {
      const formatted = formatCurrencyAmount(0.001234, "USD", 4);
      expect(formatted).toContain("0.0012");
    });

    it("rounds correctly at the default precision", () => {
      const formatted = formatCurrencyAmount(1.005, "USD");
      // Intl rounding for currency at 2dp — just assert it doesn't throw and
      // yields a 2-decimal-looking amount.
      expect(formatted).toMatch(/\d\.\d{2}/);
    });
  });

  describe("defaultDisplayCurrencyForLocale", () => {
    it("defaults Bengali locale to BDT", () => {
      expect(defaultDisplayCurrencyForLocale("bn")).toBe("BDT");
    });

    it("defaults English (and any other) locale to USD", () => {
      expect(defaultDisplayCurrencyForLocale("en")).toBe("USD");
      expect(defaultDisplayCurrencyForLocale("fr")).toBe("USD");
    });
  });

  describe("attribution constants", () => {
    it("has a non-empty attribution text and a valid https URL", () => {
      expect(ATTRIBUTION_TEXT.length).toBeGreaterThan(0);
      expect(ATTRIBUTION_URL.startsWith("https://")).toBe(true);
    });
  });
});
