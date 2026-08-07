/** CSV parsing for the bulk employee import. Pure — no I/O, no server imports. */

/**
 * A small RFC 4180 reader.
 *
 * Hand-written because §2 pins the dependency list and a CSV reader is not on
 * it. It is deliberately not a one-line `split(",")`: the two things that break
 * a naive split are exactly the two things HR's data contains — a comma inside a
 * quoted field ("Sharma, Priya") and a rupee figure pasted with grouping
 * ("4,80,000"). Both arrive quoted from Excel, and both would silently shift
 * every later column of that row into the wrong field.
 *
 * Handles: quoted fields, embedded commas and newlines, "" as an escaped quote,
 * CRLF or LF line endings, and a UTF-8 BOM (which Excel on Windows writes, and
 * which would otherwise become part of the first header name).
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;

  // Excel writes a BOM. Left in place it becomes part of the first header, so
  // "full_name" silently stops matching and every row reports a missing name.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    // A trailing newline should not produce a phantom final row.
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };

  while (i < src.length) {
    const ch = src[i]!;

    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      quoted = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      endField();
      i += 1;
      continue;
    }
    if (ch === "\r") {
      // CRLF or a bare CR both end the row.
      if (src[i + 1] === "\n") i += 1;
      endRow();
      i += 1;
      continue;
    }
    if (ch === "\n") {
      endRow();
      i += 1;
      continue;
    }

    field += ch;
    i += 1;
  }

  if (field !== "" || row.length > 0) endRow();
  return rows;
}

/**
 * The columns the import understands.
 *
 * `key` is the field name on `createUserSchema`, so the CSV and the form
 * validate through exactly the same rules — there is no second definition of
 * what a valid employee code or phone number is.
 */
export const IMPORT_COLUMNS: ReadonlyArray<{
  key: string;
  header: string;
  required?: boolean;
  hint: string;
}> = [
  { key: "full_name", header: "full_name", required: true, hint: "Priya Sharma" },
  { key: "email", header: "email", required: true, hint: "priya@linkdprints.com" },
  { key: "password", header: "password", required: true, hint: "at least 10 characters" },
  { key: "employee_code", header: "employee_code", hint: "LP-014" },
  { key: "department", header: "department", hint: "matched by name or code" },
  { key: "phone", header: "phone", hint: "9876543210" },
  { key: "designation", header: "designation", hint: "Senior Designer" },
  { key: "reports_to", header: "reports_to", hint: "their HOD's email" },
  { key: "roles", header: "roles", hint: "HOD / HR_ADMIN / MD, separated by spaces" },
  { key: "date_of_joining", header: "date_of_joining", hint: "DD-MM-YYYY" },
  { key: "employment_type", header: "employment_type", hint: "PERMANENT / PROBATION / CONTRACT / TRAINEE" },
  { key: "last_increment_date", header: "last_increment_date", hint: "DD-MM-YYYY" },
  { key: "increment_frequency_months", header: "increment_frequency_months", hint: "12" },
  { key: "joining_ctc", header: "joining_ctc", hint: "400000" },
  { key: "current_ctc", header: "current_ctc", hint: "480000" },
  { key: "last_increment_amount", header: "last_increment_amount", hint: "80000" },
];

/** The template HR downloads: the header row, then one filled example. */
export function importTemplate(): string {
  const header = IMPORT_COLUMNS.map((c) => c.header).join(",");
  const example = [
    "Priya Sharma",
    "priya@linkdprints.com",
    "ChangeMe12345",
    "LP-014",
    "Design",
    "9876543210",
    "Senior Designer",
    "", // reports_to — blank on the example, since the HOD may not exist yet
    "",
    "01-04-2022",
    "PERMANENT",
    "01-04-2025",
    "12",
    "400000",
    "480000",
    "80000",
  ]
    // Quote anything containing a comma, quote or newline, per RFC 4180.
    .map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v))
    .join(",");

  // CRLF and a BOM, for the same reason the CSV export uses them (P16-8):
  // Excel on Windows renders bare-LF UTF-8 as mojibake, and these are Indian
  // names.
  return `﻿${header}\r\n${example}\r\n`;
}

/**
 * DD-MM-YYYY to the ISO form Postgres wants.
 *
 * §0.10 fixes DD-MM-YYYY as the convention everywhere in this product, so that
 * is what HR will type. ISO is accepted too and passed through — a date that
 * came out of another system should not have to be reformatted by hand.
 *
 * Returns null for anything else rather than guessing: 03-04-2025 is ambiguous
 * across conventions, and silently reading it as the wrong month would set
 * somebody's increment eleven months out with nothing on screen to show for it.
 */
export function toIsoDate(value: string): string | null {
  const text = value.trim();
  if (text === "") return "";

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) return text;

  const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(text);
  if (!dmy) return null;

  const [, d, m, y] = dmy;
  const day = Number(d);
  const month = Number(m);
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;

  return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Map a parsed CSV table to header-keyed rows, ignoring unknown columns. */
export function toRecords(table: string[][]): {
  records: Array<Record<string, string>>;
  missing: string[];
} {
  const [headerRow, ...body] = table;
  if (!headerRow) return { records: [], missing: [] };

  const headers = headerRow.map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const known = new Set(IMPORT_COLUMNS.map((c) => c.header));

  const missing = IMPORT_COLUMNS.filter((c) => c.required && !headers.includes(c.header)).map(
    (c) => c.header,
  );

  const records = body
    // A row of nothing but commas is what a spreadsheet leaves behind below the
    // data. Importing it would report a failure for a row nobody typed.
    .filter((cells) => cells.some((cell) => cell.trim() !== ""))
    .map((cells) => {
      const record: Record<string, string> = {};
      headers.forEach((header, index) => {
        if (known.has(header)) record[header] = (cells[index] ?? "").trim();
      });
      return record;
    });

  return { records, missing };
}
