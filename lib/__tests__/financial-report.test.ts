import { describe, it, expect } from "vitest";
import { toFinancialReportCsv, type FinancialReportRow } from "@/lib/services/financial-report";

/**
 * Written BEFORE lib/services/financial-report.ts existed, as a TDD
 * (test-first) exercise — this file was expected to fail with a
 * module-not-found error until the implementation landed (RED), then
 * pass once it did (GREEN). Kept as a normal regression test going forward.
 */
describe("lib/services/financial-report", () => {
  describe("toFinancialReportCsv", () => {
    it("returns just the header row for an empty input", () => {
      const csv = toFinancialReportCsv([]);
      expect(csv).toBe("Date,Revenue,Orders,Refunds\n");
    });

    it("formats a single row with 2-decimal-fixed money values", () => {
      const rows: FinancialReportRow[] = [
        { date: "2026-09-01", revenue: 1234.5, orderCount: 7, refunds: 10 },
      ];
      const csv = toFinancialReportCsv(rows);
      expect(csv).toBe("Date,Revenue,Orders,Refunds\n2026-09-01,1234.50,7,10.00\n");
    });

    it("formats multiple rows in the given order, one per line", () => {
      const rows: FinancialReportRow[] = [
        { date: "2026-09-01", revenue: 100, orderCount: 1, refunds: 0 },
        { date: "2026-09-02", revenue: 200.25, orderCount: 2, refunds: 5 },
      ];
      const csv = toFinancialReportCsv(rows);
      const lines = csv.trim().split("\n");
      expect(lines).toHaveLength(3); // header + 2 rows
      expect(lines[1]).toBe("2026-09-01,100.00,1,0.00");
      expect(lines[2]).toBe("2026-09-02,200.25,2,5.00");
    });

    it("rounds floating-point revenue/refund values to 2 decimal places", () => {
      const rows: FinancialReportRow[] = [
        { date: "2026-09-01", revenue: 10.005, orderCount: 1, refunds: 0.001 },
      ];
      const csv = toFinancialReportCsv(rows);
      const dataLine = csv.trim().split("\n")[1];
      const [, revenue, , refunds] = dataLine.split(",");
      // Just assert well-formed 2-decimal numeric strings — exact rounding
      // direction for .005 is a known floating-point edge case and not the
      // point of this test.
      expect(revenue).toMatch(/^\d+\.\d{2}$/);
      expect(refunds).toMatch(/^\d+\.\d{2}$/);
    });

    it("neutralizes leading =, +, -, @ in the date field to prevent CSV/formula injection", () => {
      const rows: FinancialReportRow[] = [
        { date: "=cmd|'/C calc'!A1", revenue: 1, orderCount: 1, refunds: 0 },
      ];
      const csv = toFinancialReportCsv(rows);
      const dataLine = csv.trim().split("\n")[1];
      expect(dataLine.startsWith("'=")).toBe(true);
    });

    it("quotes and escapes date fields containing a comma", () => {
      const rows: FinancialReportRow[] = [
        { date: "2026-09-01, note: partial day", revenue: 5, orderCount: 1, refunds: 0 },
      ];
      const csv = toFinancialReportCsv(rows);
      const dataLine = csv.trim().split("\n")[1];
      expect(dataLine.startsWith('"2026-09-01, note: partial day"')).toBe(true);
    });

    it("escapes embedded double quotes by doubling them, per RFC 4180", () => {
      const rows: FinancialReportRow[] = [
        { date: 'note "urgent"', revenue: 1, orderCount: 1, refunds: 0 },
      ];
      const csv = toFinancialReportCsv(rows);
      const dataLine = csv.trim().split("\n")[1];
      expect(dataLine.startsWith('"note ""urgent"""')).toBe(true);
    });

    it("rejects negative order counts as invalid input", () => {
      const rows: FinancialReportRow[] = [
        { date: "2026-09-01", revenue: 0, orderCount: -1, refunds: 0 },
      ];
      expect(() => toFinancialReportCsv(rows)).toThrow();
    });
  });
});
