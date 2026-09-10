/**
 * Generic CSV serialization helper for admin data exports
 * (docs/DASHBOARD_UPGRADE_PLAN.md §2.5 — Financial reports & CSV export).
 *
 * Deliberately hand-rolled (no CSV library dependency) — export tables
 * here are small/flat (orders, transactions, payments), and this project
 * already has an equivalent pattern in `lib/services/financial-report.ts`
 * for the report-summary CSV specifically. This module generalizes the
 * same escaping rules to arbitrary row shapes so
 * `/api/admin/export/{orders|transactions|payments}` don't each
 * reimplement CSV escaping.
 */

/**
 * Escapes a single CSV field per RFC 4180 (quote if it contains a comma,
 * quote, or newline; double any embedded quotes) AND neutralizes leading
 * `=`, `+`, `-`, `@` characters, which spreadsheet applications (Excel,
 * Google Sheets, LibreOffice) interpret as the start of a formula —
 * "CSV/formula injection" per OWASP's CSV Injection guidance. Exported
 * data may include free-text/user-supplied fields (e.g. order target,
 * payment reference), so untrusted-looking values must never be able to
 * trigger formula execution when opened in a spreadsheet app.
 */
export function escapeCsvField(value: unknown): string {
  let field = value === null || value === undefined ? "" : String(value);

  if (/^[=+\-@]/.test(field)) {
    field = `'${field}`;
  }

  if (/[",\n\r]/.test(field)) {
    field = `"${field.replace(/"/g, '""')}"`;
  }

  return field;
}

/**
 * Serializes an array of flat row objects to a CSV string (header + one
 * line per row, `\r\n`-terminated per RFC 4180). `columns` controls both
 * the column order and the header labels.
 */
export function toCsv<T extends Record<string, unknown>>(
  rows: T[],
  columns: { key: keyof T; label: string }[]
): string {
  const lines = [columns.map((c) => escapeCsvField(c.label)).join(",")];

  for (const row of rows) {
    lines.push(columns.map((c) => escapeCsvField(row[c.key])).join(","));
  }

  return lines.join("\r\n") + "\r\n";
}
