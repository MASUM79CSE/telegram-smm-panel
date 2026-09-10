import { describe, it, expect } from "vitest";
import { getAuditActionMeta, AUDIT_ACTION_META, AUDIT_CATEGORY_COLORS } from "@/lib/audit-labels";

describe("lib/audit-labels", () => {
  it("returns a defined label/category for every known AuditAction", () => {
    for (const [action, meta] of Object.entries(AUDIT_ACTION_META)) {
      const result = getAuditActionMeta(action);
      expect(result.label.length).toBeGreaterThan(0);
      expect(AUDIT_CATEGORY_COLORS[result.category]).toBeDefined();
      expect(result).toEqual(meta);
    }
  });

  it("falls back to a humanized label + 'content' category for an unknown action", () => {
    const result = getAuditActionMeta("SOME_FUTURE_ACTION");
    expect(result.label).toBe("some future action");
    expect(result.category).toBe("content");
  });

  it("every category referenced in AUDIT_ACTION_META has a corresponding color entry", () => {
    const categories = new Set(Object.values(AUDIT_ACTION_META).map((m) => m.category));
    for (const category of categories) {
      expect(AUDIT_CATEGORY_COLORS[category]).toBeDefined();
    }
  });
});
