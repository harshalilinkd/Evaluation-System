/** CSV parsing for the bulk employee import. Pure — no I/O, no server imports. */

/* -- The hint below states the rule the schema actually applies, rather than a
      number typed twice. `schemas.ts` is pure as well, so this stays a pure
      module. -- */
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/schemas";

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
  /* -- EMAIL IS NO LONGER A REQUIRED COLUMN, and that is a deliberate change.

        A production worker does not sign in — they are rated by their
        supervisor and never open the app (WORKER-1) — and most have no work
        address to give. Demanding one meant either inventing twenty-five by
        hand or leaving twenty-five people out of the system entirely, and a
        worker with no profile cannot be appraised at all.

        The COLUMN is still there and is still required for anybody on the
        Backend Team; what changed is that the header need not be present and a
        Production Team row may leave it blank. That rule lives in the row
        validation, because it depends on the track. -- */
  { key: "email", header: "email", hint: "blank for Production Team — they never sign in" },
  {
    key: "password",
    header: "password",
    hint: `${MIN_PASSWORD_LENGTH}+ characters. Blank gives firstname123 — either way the import shows you what each person got, once.`,
  },
  /* -- §7: which MODULE somebody is in. Independent of department, because both
        modules have people in the same teams. Blank means Backend Team, so a
        file written before this column existed still imports as it did. -- */
  { key: "track", header: "track", hint: "Backend Team or Production Team" },
  { key: "employee_code", header: "employee_code", hint: "LP-014 — REQUIRED when the email is blank" },
  { key: "department", header: "department", hint: "matched by name or code" },
  { key: "phone", header: "phone", hint: "9876543210" },
  /* -- The OFFICIAL pair (0081). Optional, and blank for almost everybody.
        Only somebody who does HR or management work needs one: their own
        appraisal and their team's reach the personal details above, and the
        administrative messages come here instead. Blank falls back, so a file
        written before these columns existed imports exactly as it did. -- */
  {
    key: "work_email",
    header: "work_email",
    hint: "official address — optional, blank falls back to the personal one above",
  },
  {
    key: "work_phone",
    header: "work_phone",
    hint: "official mobile — optional, blank falls back to the personal one above",
  },
  { key: "designation", header: "designation", hint: "Senior Designer" },
  /* -- THE EMAIL, never the name. Two people can share a name; an email is what
        the account is keyed on, and it is the only manager identifier a
        spreadsheet reliably carries (P19C-14). -- */
  { key: "reports_to", header: "reports_to", hint: "their manager's EMAIL, not their name" },
  /* -- A SECOND manager, for the few people who genuinely have two (0083).
        Blank for almost everybody, and blank means the ordinary two-form flow —
        so a file written before this column existed imports exactly as it did.

        By EMAIL, for the same reason `reports_to` is: two people can share a
        name, and an email is what the account is keyed on (P19C-14). Resolved
        against the database AND against this file, so an org chart that names
        the Design Coordinator four rows down still works (FIX-56). -- */
  {
    key: "second_reviewer",
    header: "second_reviewer",
    hint: "a SECOND manager's EMAIL — blank for almost everybody",
  },
  /* -- THE HINT SAID "Manager", AND THAT VALUE DOES NOT EXIST.
        `roles` is filtered against ROLE_VALUES and anything unrecognised is
        dropped — so somebody following this hint got a person with EMPLOYEE
        alone and no error to show for it. The enum value is HOD, and SUPERVISOR
        was missing entirely, which is the one a production round needs to find
        a rater at all. Both fixed here; the silent drop is fixed in the import,
        which now refuses an unrecognised value by name (§0.7). -- */
  { key: "roles", header: "roles", hint: "HOD / SUPERVISOR / HR_ADMIN / MD — blank for most people" },
  { key: "date_of_joining", header: "date_of_joining", hint: "DD-MM-YYYY" },
  { key: "employment_type", header: "employment_type", hint: "PERMANENT / PROBATION / CONTRACT / TRAINEE" },
  { key: "last_increment_date", header: "last_increment_date", hint: "DD-MM-YYYY" },
  { key: "increment_frequency_months", header: "increment_frequency_months", hint: "12" },
  /* -- THE UNIT, ASKED FOR RATHER THAN ASSUMED.

        Every salary in the database is ANNUAL (0061 — monthly at the edges,
        annual in the core), and the three figures below have always been read
        that way. Payroll sheets are usually monthly, so pasting 32000 into a
        column the system reads as a year stores ₹2,667 a month — out by twelve
        on every increment percentage, report and printed sheet, and low enough
        to look plausible rather than obviously wrong.

        One column removes the whole class. BLANK MEANS MONTHLY, on both tracks,
        at the owner's instruction — their payroll sheet states both teams per
        month, and the remaining risk points the safe way: an annual figure read
        as monthly is out by twelve UPWARDS, which nobody scrolls past. See the
        note beside `perMonth` in provisioning.ts. -- */
  { key: "salary_unit", header: "salary_unit", hint: "MONTHLY or ANNUAL (blank = MONTHLY)" },
  /* -- The three figures are exampled PER MONTH, matching the default above.
        An example row is what people copy, so it has to state the same unit the
        blank column means — a monthly default beside an annual example is the
        column contradicting itself. -- */
  { key: "joining_ctc", header: "joining_ctc", hint: "25000 — what they started on" },
  /* -- `current_ctc` IS NO LONGER A COLUMN (0109). A salary is what somebody
        joined on plus every rise since, so it is worked out rather than
        stated — and a file that could state it as well would be a second
        answer to the same question, free to disagree with the rises beside it.
        A sheet still carrying the column is read and ignored. -- */
  { key: "last_increment_amount", header: "last_increment_amount", hint: "5000 — the RISE, not the new salary" },
  /* -- EARLIER RISES, one numbered pair each.
        `last_increment_*` records the newest rise and nothing before it, so a
        sheet carrying "Increment Amt 2025" and "Increment Amt 2026" lost one of
        them. Two pairs are exampled here because two years is what people have;
        the READER takes any `increment_N_*`, so a third year needs no change to
        this file — add the columns to the sheet and they are read. -- */
  { key: "increment_1_date", header: "increment_1_date", hint: "DD-MM-YYYY — the OLDER rise" },
  { key: "increment_1_amount", header: "increment_1_amount", hint: "3000 — the RISE" },
  { key: "increment_2_date", header: "increment_2_date", hint: "DD-MM-YYYY" },
  { key: "increment_2_amount", header: "increment_2_amount", hint: "4000 — the RISE" },
];

/** `increment_7_date` / `increment_7_amount` — any year, without a code change. */
export const INCREMENT_PAIR = /^increment_(\d+)_(date|amount)$/;

/** The template HR downloads: the header row, then one filled example. */
export function importTemplate(): string {
  const header = IMPORT_COLUMNS.map((c) => c.header).join(",");
  /* -- TWO example rows, not one.
        The second is a production worker with no email and no password — the
        shape most of a real payroll sheet is in, and the one somebody would
        otherwise have to be told about in prose. An example that only shows the
        easy case is an example that gets copied.

        BOTH state MONTHLY. That is the owner's payroll sheet and it is now the
        default, so the examples say out loud what a blank column would have
        meant anyway — nobody has to infer it from the hint. -- */
  const rows = [
    /* -- ONE CELL PER COLUMN, and that had drifted.
          Both rows were missing `work_email` and `work_phone`, and the second
          was missing `roles` as well — so every value after `phone` was emitted
          one or two columns to the LEFT. "Senior Designer" landed in
          work_email, the joining date in the column beside it, and anybody who
          filled this template in got a file the importer read as nonsense.

          It fails SILENTLY, which is why it survived: a short row is not a
          parse error, it is a row whose later fields are blank and whose
          earlier ones are in the wrong place. The suite counts cells against
          columns now, and reads the template back through the reader rather
          than trusting the count. -- */
    [
      "Priya Sharma",
      "priya@linkdprints.com",
      "ChangeMe12345",
      "Backend Team",
      "LP-014",
      "Design",
      "9876543210",
      "", // work_email — optional, blank falls back to the personal one
      "", // work_phone — the same
      "Senior Designer",
      "", // reports_to — blank here, since the manager may not exist yet
      "", // second_reviewer — blank: only a Designer-shaped role has two
      "", // roles — blank for most people
      "01-04-2022",
      "PERMANENT",
      "01-04-2025",
      "12",
      "MONTHLY",
      // Per month, matching the unit beside them. 40000 -> 4,80,000 a year.
      "33000",
      "40000",
      "7000",
      // Two earlier rises: 33,000 -> 36,000 -> 40,000, the last of which is the
      // `last_increment_*` pair above. The three agree, which is the point.
      "01-04-2024",
      "3000",
      "01-04-2025",
      "4000",
    ],
    [
      "Ramesh Kumar",
      "", // never signs in
      "", // and so needs no password
      "Production Team",
      "PR-08", // required when the email is blank: the account is keyed on it
      "Fusing",
      "9137689996",
      "", // work_email
      "", // work_phone
      "Helper",
      "supervisor@linkdprints.com", // who rates them
      "", // second_reviewer
      "", // roles
      "01-01-2021",
      "PERMANENT",
      "01-02-2025",
      "12",
      "MONTHLY",
      "15000",
      "22000",
      "5000",
      "01-02-2023",
      "2000",
      "",
      "",
    ],
  ]
    // Quote anything containing a comma, quote or newline, per RFC 4180.
    .map((cells) =>
      cells.map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(","),
    );

  // CRLF and a BOM, for the same reason the CSV export uses them (P16-8):
  // Excel on Windows renders bare-LF UTF-8 as mojibake, and these are Indian
  // names.
  return `﻿${header}\r\n${rows.join("\r\n")}\r\n`;
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
        /* A numbered increment pair is kept whether or not the template names
           it, so a sheet with a third or fourth year is read as it stands. */
        if (known.has(header) || INCREMENT_PAIR.test(header)) {
          record[header] = (cells[index] ?? "").trim();
        }
      });
      return record;
    });

  return { records, missing };
}
