/** CSV export. Server-side only, from the same RLS-scoped query. P16. */

import "server-only";

/**
 * P16: "generated server-side through the same RLS-scoped query that fed the
 * screen. Never build a CSV from client state."
 *
 * The reason is not tidiness. A CSV assembled in the browser can only contain
 * what was sent to the browser — but it is also trivially editable before it is
 * assembled, so an export built from client state is an export whose contents
 * the client chose. Going back through the query means the file is exactly what
 * that person is allowed to read, decided by the same policies as the screen.
 */
export function toCsv(headers: readonly string[], rows: ReadonlyArray<ReadonlyArray<unknown>>): string {
  const escape = (value: unknown): string => {
    if (value === null || value === undefined) return "";
    const text = String(value);
    // A field containing a comma, a quote or a newline must be quoted, and an
    // embedded quote doubled. Excel is unforgiving about this and a name like
    // O'Brien or "Smith, A." is the ordinary case, not the exotic one.
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const lines = [headers.map(escape).join(",")];
  for (const row of rows) lines.push(row.map(escape).join(","));

  // CRLF and a BOM: Excel on Windows opens a bare-LF UTF-8 file as mojibake,
  // and this is an Indian office where names carry non-ASCII characters.
  return `﻿${lines.join("\r\n")}\r\n`;
}

export function csvResponse(filename: string, body: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // Never cached: the contents depend on who asked.
      "Cache-Control": "no-store",
    },
  });
}
