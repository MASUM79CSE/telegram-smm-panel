import { describe, it, expect } from "vitest";
import { parseStatusList, parseDateRange, escapeRegExp, parseListQuery } from "@/lib/admin-query";

describe("lib/admin-query", () => {
  describe("parseStatusList", () => {
    it("returns undefined for null/undefined/empty input", () => {
      expect(parseStatusList(null)).toBeUndefined();
      expect(parseStatusList(undefined)).toBeUndefined();
      expect(parseStatusList("")).toBeUndefined();
    });

    it("splits a single value into a one-element array", () => {
      expect(parseStatusList("PENDING")).toEqual(["PENDING"]);
    });

    it("splits comma-separated values and trims whitespace", () => {
      expect(parseStatusList("PENDING, FAILED ,COMPLETED")).toEqual(["PENDING", "FAILED", "COMPLETED"]);
    });

    it("filters out empty entries from trailing/double commas", () => {
      expect(parseStatusList("PENDING,,FAILED,")).toEqual(["PENDING", "FAILED"]);
    });

    it("returns undefined if all entries are empty", () => {
      expect(parseStatusList(",, ,")).toBeUndefined();
    });
  });

  describe("parseDateRange", () => {
    it("returns undefined when both bounds are absent", () => {
      expect(parseDateRange(null, null)).toBeUndefined();
      expect(parseDateRange(undefined, undefined)).toBeUndefined();
    });

    it("parses only a `from` bound", () => {
      const range = parseDateRange("2026-01-01", null);
      expect(range?.gte?.toISOString().slice(0, 10)).toBe("2026-01-01");
      expect(range?.lte).toBeUndefined();
    });

    it("parses only a `to` bound and extends it to end-of-day", () => {
      const range = parseDateRange(null, "2026-01-01");
      expect(range?.gte).toBeUndefined();
      expect(range?.lte?.getHours()).toBe(23);
      expect(range?.lte?.getMinutes()).toBe(59);
    });

    it("parses both bounds", () => {
      const range = parseDateRange("2026-01-01", "2026-01-31");
      expect(range?.gte).toBeInstanceOf(Date);
      expect(range?.lte).toBeInstanceOf(Date);
    });

    it("ignores invalid date strings", () => {
      expect(parseDateRange("not-a-date", "also-not-a-date")).toBeUndefined();
    });

    it("ignores an invalid `from` while keeping a valid `to`", () => {
      const range = parseDateRange("garbage", "2026-01-31");
      expect(range?.gte).toBeUndefined();
      expect(range?.lte).toBeInstanceOf(Date);
    });
  });

  describe("escapeRegExp", () => {
    it("escapes regex metacharacters", () => {
      expect(escapeRegExp("a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o")).toBe(
        "a\\.b\\*c\\+d\\?e\\^f\\$g\\{h\\}i\\(j\\)k\\|l\\[m\\]n\\\\o"
      );
    });

    it("leaves plain text untouched", () => {
      expect(escapeRegExp("hello world 123")).toBe("hello world 123");
    });

    it("neutralizes a ReDoS-shaped/injection-shaped input as literal text", () => {
      const evil = "(a+)+$";
      const escaped = escapeRegExp(evil);
      expect(() => new RegExp(escaped)).not.toThrow();
      expect(new RegExp(escaped).test("(a+)+$")).toBe(true);
      expect(new RegExp(escaped).test("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!")).toBe(false);
    });
  });

  describe("parseListQuery", () => {
    it("applies defaults when no params are given", () => {
      const q = parseListQuery(new URLSearchParams());
      expect(q.page).toBe(1);
      expect(q.limit).toBe(20);
      expect(q.status).toBeUndefined();
      expect(q.search).toBeUndefined();
      expect(q.dateRange).toBeUndefined();
    });

    it("parses page/limit/status/search/from/to together", () => {
      const q = parseListQuery(
        new URLSearchParams({
          page: "2",
          limit: "50",
          status: "PENDING,FAILED",
          search: " alice ",
          from: "2026-01-01",
          to: "2026-01-31",
        })
      );
      expect(q.page).toBe(2);
      expect(q.limit).toBe(50);
      expect(q.status).toEqual(["PENDING", "FAILED"]);
      expect(q.search).toBe("alice");
      expect(q.dateRange?.gte).toBeInstanceOf(Date);
      expect(q.dateRange?.lte).toBeInstanceOf(Date);
    });

    it("clamps limit to the given max", () => {
      const q = parseListQuery(new URLSearchParams({ limit: "500" }), 20, 100);
      expect(q.limit).toBe(100);
    });

    it("clamps page below 1 up to 1", () => {
      const q = parseListQuery(new URLSearchParams({ page: "-5" }));
      expect(q.page).toBe(1);
    });

    it("falls back to defaults for non-numeric page/limit", () => {
      const q = parseListQuery(new URLSearchParams({ page: "abc", limit: "xyz" }), 20, 100);
      expect(q.page).toBe(1);
      expect(q.limit).toBe(20);
    });
  });
});
