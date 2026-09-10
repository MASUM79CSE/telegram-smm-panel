import { describe, it, expect } from "vitest";
import { escapeCsvField, toCsv } from "@/lib/csv";

describe("lib/csv", () => {
  describe("escapeCsvField", () => {
    it("returns an empty string for null/undefined", () => {
      expect(escapeCsvField(null)).toBe("");
      expect(escapeCsvField(undefined)).toBe("");
    });

    it("stringifies non-string values", () => {
      expect(escapeCsvField(42)).toBe("42");
      expect(escapeCsvField(true)).toBe("true");
    });

    it("leaves plain text untouched", () => {
      expect(escapeCsvField("hello world")).toBe("hello world");
    });

    it("quotes fields containing a comma", () => {
      expect(escapeCsvField("a,b")).toBe('"a,b"');
    });

    it("quotes and doubles embedded quotes", () => {
      expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    });

    it("quotes fields containing a newline", () => {
      expect(escapeCsvField("line1\nline2")).toBe('"line1\nline2"');
    });

    it("neutralizes a leading = (formula injection)", () => {
      expect(escapeCsvField("=SUM(A1:A2)")).toBe("'=SUM(A1:A2)");
    });

    it("neutralizes a leading +, -, and @", () => {
      expect(escapeCsvField("+1234")).toBe("'+1234");
      expect(escapeCsvField("-1234")).toBe("'-1234");
      expect(escapeCsvField("@mention")).toBe("'@mention");
    });
  });

  describe("toCsv", () => {
    it("returns just the header row for an empty array", () => {
      const csv = toCsv([], [{ key: "id", label: "ID" }]);
      expect(csv).toBe("ID\r\n");
    });

    it("serializes rows in column order with a header", () => {
      const rows = [
        { id: "1", name: "Alice", amount: 10 },
        { id: "2", name: "Bob", amount: 20.5 },
      ];
      const csv = toCsv(rows, [
        { key: "id", label: "ID" },
        { key: "name", label: "Name" },
        { key: "amount", label: "Amount" },
      ]);
      expect(csv).toBe("ID,Name,Amount\r\n1,Alice,10\r\n2,Bob,20.5\r\n");
    });

    it("escapes fields that need it within a full row", () => {
      const rows = [{ id: "1", note: "a,b" }];
      const csv = toCsv(rows, [
        { key: "id", label: "ID" },
        { key: "note", label: "Note" },
      ]);
      expect(csv).toBe('ID,Note\r\n1,"a,b"\r\n');
    });
  });
});
