/**
 * Financial report CSV export helper.
 *
 * Scope note: this module is deliberately limited to the pure,
 * unit-testable CSV-serialization half of a future `/admin/reports` page.
 * The DB aggregation half (pulling per-day revenue/order/refund totals,
 * analogous to `getRevenueSeries` in `lib/services/analytics.ts`) needs a
 * live DB to verify and is intentionally out of scope here, matching this
 * project's existing "pure logic only" unit-test boundary (see
 * `vitest.config.ts`).
 */

export interface FinancialReportRow {
  /** "YYYY-MM-DD", or any free-text label for a summary row. */
  date: string;
  /** Total revenue for the row, as a plain display number (see lib/money.ts — already converted via decimalToNumber upstream). */
  revenue: number;
  orderCount: number;
  refunds: number;
}

const CSV_HEADER = "Date,Revenue,Orders,Refunds";

/**
 * Escapes a single CSV field per RFC 4180 (quote if it contains a comma,
 * quote, or newline; double any embedded quotes) AND neutralizes leading
 * `=`, `+`, `-`, `@` characters, which spreadsheet applications (Excel,
 * Google Sheets, LibreOffice) interpret as the start of a formula —
 * "CSV/formula injection" per OWASP's CSV Injection guidance. This report
 * is exported for admin consumption and may be opened directly in a
 * spreadsheet app, so untrusted-looking string fields must never be able
 * to trigger formula execution.
 */
function escapeCsvField(value: string): string {
  let field = value;

  if (/^[=+\-@]/.test(field)) {
    field = `'${field}`;
  }

  if (/[",\n\r]/.test(field)) {
    field = `"${field.replace(/"/g, '""')}"`;
  }

  return field;
}

function formatMoney(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid financial report value: ${value}`);
  }
  return value.toFixed(2);
}

/**
 * Serializes financial report rows to a CSV string (header + one line per
 * row, `\n`-terminated). Pure function — no I/O, no DB access.
 */
export function toFinancialReportCsv(rows: FinancialReportRow[]): string {
  const lines = [CSV_HEADER];

  for (const row of rows) {
    if (!Number.isFinite(row.orderCount) || row.orderCount < 0) {
      throw new Error(`Invalid orderCount in financial report row: ${row.orderCount}`);
    }
    if (!Number.isInteger(row.orderCount)) {
      throw new Error(`orderCount must be an integer, got: ${row.orderCount}`);
    }

    const fields = [
      escapeCsvField(row.date),
      formatMoney(row.revenue),
      String(row.orderCount),
      formatMoney(row.refunds),
    ];
    lines.push(fields.join(","));
  }

  return lines.join("\n") + "\n";
}
