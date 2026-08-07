/** Bulk Job Specific Skills import: reading the file and deciding what each row means. Pure. */

import { parseCsv } from "@/lib/auth/csv";
import { ANSWERED_BY, RESPONSE_TYPES } from "@/lib/questions/labels";
import type { Enums } from "@/types/database";

/*
 * Pure on purpose: no I/O and no server imports, so the preview and the commit
 * can run the SAME builder. P19D-3 learned this the expensive way — a preview
 * produced by a second, more forgiving parser is a preview that lies, and
 * without the server re-running it the screen could talk the commit into
 * accepting a row it had just shown as broken.
 */

export type ImportStatus = "NEW" | "EXISTS" | "NEW_DEPARTMENT" | "ERROR";

export type ImportRow = {
  /** 1-based, and counting the header, so it matches what the spreadsheet shows. */
  line: number;
  department: string;
  text: string;
  helpText: string;
  responseType: Enums<"response_type">;
  answeredBy: Enums<"answered_by">;
  isRequired: boolean;
  status: ImportStatus;
  /** Set on ERROR, and on the two statuses that need explaining. */
  note?: string;
  /** Present when the text already exists: the row it will be mapped to. */
  existingId?: string;
};

export type ImportPreview = {
  rows: ImportRow[];
  counts: { new: number; exists: number; newDepartments: number; errors: number };
  /** Departments named in the file that do not exist yet, deduplicated. */
  unknownDepartments: string[];
  /** Set when the file cannot be read at all — no rows are returned. */
  fatal?: string;
};

/* ---------- Column names ---------- */
/*
 * The canonical header is `department`, but the source sheet this was written
 * for calls it a role, and HR should not have to rename a column to use their
 * own file. Aliases cost one line each and remove the single most likely reason
 * for a first import to fail.
 */
const DEPARTMENT_HEADERS = ["department", "role", "role_profile", "job_role", "profile"];
const TEXT_HEADERS = ["question_text", "question", "text"];
const HELP_HEADERS = ["helper_text", "help_text", "helper", "hint", "description"];
const TYPE_HEADERS = ["answer_type", "response_type", "type"];
const WHO_HEADERS = ["who_answers", "answered_by", "who"];
const REQUIRED_HEADERS = ["required", "is_required", "mandatory"];

/** §5 keeps the flat shape; 300 is the brief's cap and it is enforced here, not in the UI. */
const MAX_TEXT = 300;

const DEFAULT_TYPE: Enums<"response_type"> = "SCALE_0_5";
const DEFAULT_WHO: Enums<"answered_by"> = "EMPLOYEE_AND_LEAD";

function normaliseHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
}

/** Case- and space-insensitive, so "Colour  Matching " and "colour matching" are one question. */
export function questionKey(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/* ---------- Value readers ---------- */

/**
 * Accepts the label HR sees, the enum value, and a few things a person would
 * reasonably type. Anything else is an error rather than a silent default —
 * a question quietly becoming a 0-5 rating when somebody meant Yes/No is the
 * kind of mistake that is only noticed once it is on a live form.
 */
export function readResponseType(raw: string): Enums<"response_type"> | null {
  const value = raw.trim();
  if (value === "") return DEFAULT_TYPE;

  const key = value.toLowerCase().replace(/[\s_/-]+/g, "");
  const byEnum = RESPONSE_TYPES.find((t) => t.value.toLowerCase().replace(/_/g, "") === key);
  if (byEnum) return byEnum.value;

  const byLabel = RESPONSE_TYPES.find(
    (t) => t.label.toLowerCase().replace(/[\s_/-]+/g, "") === key,
  );
  if (byLabel) return byLabel.value;

  const aliases: Record<string, Enums<"response_type">> = {
    rating: "SCALE_0_5",
    rating05: "SCALE_0_5",
    "0to5": "SCALE_0_5",
    scale: "SCALE_0_5",
    scale05: "SCALE_0_5",
    tick: "TICK_3",
    tick3: "TICK_3",
    threetick: "TICK_3",
    yesno: "BOOLEAN",
    boolean: "BOOLEAN",
    number: "NUMBER",
    shorttext: "TEXT_SHORT",
    longtext: "TEXT_LONG",
    paragraph: "TEXT_LONG",
    pickone: "SINGLE_SELECT",
    singleselect: "SINGLE_SELECT",
    pickmany: "MULTI_SELECT",
    multiselect: "MULTI_SELECT",
    date: "DATE",
  };
  return aliases[key] ?? null;
}

export function readAnsweredBy(raw: string): Enums<"answered_by"> | null {
  const value = raw.trim();
  if (value === "") return DEFAULT_WHO;

  const key = value.toLowerCase().replace(/[\s_/-]+/g, "");
  const byEnum = ANSWERED_BY.find((a) => a.value.toLowerCase().replace(/_/g, "") === key);
  if (byEnum) return byEnum.value;

  const byLabel = ANSWERED_BY.find((a) => a.label.toLowerCase().replace(/[\s_/-]+/g, "") === key);
  if (byLabel) return byLabel.value;

  const aliases: Record<string, Enums<"answered_by">> = {
    employeeandmanager: "EMPLOYEE_AND_LEAD",
    both: "EMPLOYEE_AND_LEAD",
    employeeandtheirmanager: "EMPLOYEE_AND_LEAD",
    employee: "EMPLOYEE_ONLY",
    employeeonly: "EMPLOYEE_ONLY",
    manager: "LEAD_ONLY",
    managironly: "LEAD_ONLY",
    manageronly: "LEAD_ONLY",
    lead: "LEAD_ONLY",
    md: "MD_ONLY",
    mdonly: "MD_ONLY",
  };
  return aliases[key] ?? null;
}

/** Blank means yes: the brief's default, and every question in the source sheet is required. */
export function readRequired(raw: string): boolean | null {
  const key = raw.trim().toLowerCase();
  if (key === "") return true;
  if (["yes", "y", "true", "1", "required"].includes(key)) return true;
  if (["no", "n", "false", "0", "optional"].includes(key)) return false;
  return null;
}

/* ---------- The preview ---------- */

export type ExistingQuestion = { id: string; text: string; isActive: boolean };

/**
 * Turns a file into a decision per row.
 *
 * `existing` and `departments` come from the database, so this stays pure and
 * the same function runs on both the preview and the commit.
 */
export function buildImportPreview(
  csvText: string,
  existing: ExistingQuestion[],
  departmentNames: string[],
): ImportPreview {
  const table = parseCsv(csvText);
  const [headerRow, ...body] = table;

  if (!headerRow || headerRow.length === 0) {
    return { rows: [], counts: blank(), unknownDepartments: [], fatal: "That file is empty." };
  }

  const headers = headerRow.map(normaliseHeader);
  const indexOf = (names: string[]) => headers.findIndex((h) => names.includes(h));

  const iDept = indexOf(DEPARTMENT_HEADERS);
  const iText = indexOf(TEXT_HEADERS);

  if (iDept < 0 || iText < 0) {
    return {
      rows: [],
      counts: blank(),
      unknownDepartments: [],
      fatal:
        "The file needs a column for the department and one for the question. Download the template to see the expected headings.",
    };
  }

  const iHelp = indexOf(HELP_HEADERS);
  const iType = indexOf(TYPE_HEADERS);
  const iWho = indexOf(WHO_HEADERS);
  const iRequired = indexOf(REQUIRED_HEADERS);

  /* -- The existing bank, keyed for matching.
        Only ACTIVE questions count as "already exists" (the brief's rule): a
        retired question matching by text should not silently come back into a
        form because somebody re-imported a sheet. -- */
  const byKey = new Map<string, ExistingQuestion>();
  for (const q of existing) {
    if (q.isActive) byKey.set(questionKey(q.text), q);
  }

  const knownDepartments = new Map<string, string>();
  for (const name of departmentNames) knownDepartments.set(name.trim().toLowerCase(), name);

  const rows: ImportRow[] = [];
  const seenInFile = new Set<string>();
  const unknown = new Set<string>();

  /* -- The source sheet's shape: the role appears on its first row only and the
        rows beneath it are blank. Carrying the last non-blank value down is what
        makes that file importable without anybody reformatting it. -- */
  let carriedDepartment = "";

  body.forEach((cells, index) => {
    const line = index + 2; // +1 for the header, +1 because spreadsheets count from 1

    if (cells.every((c) => c.trim() === "")) return; // a trailing blank row

    const rawDept = (cells[iDept] ?? "").trim();
    if (rawDept !== "") carriedDepartment = rawDept;
    const department = carriedDepartment;

    const text = (cells[iText] ?? "").trim();
    const helpText = iHelp >= 0 ? (cells[iHelp] ?? "").trim() : "";

    const base = {
      line,
      department,
      text,
      helpText,
      responseType: DEFAULT_TYPE,
      answeredBy: DEFAULT_WHO,
      isRequired: true,
    };

    if (text === "") {
      rows.push({ ...base, status: "ERROR", note: "There is no question on this row." });
      return;
    }
    if (department === "") {
      rows.push({
        ...base,
        status: "ERROR",
        note: "No department on this row, and none above it to carry down.",
      });
      return;
    }
    if (text.length > MAX_TEXT) {
      rows.push({
        ...base,
        status: "ERROR",
        note: `That question is ${text.length} characters. The limit is ${MAX_TEXT}.`,
      });
      return;
    }

    const responseType = readResponseType(iType >= 0 ? (cells[iType] ?? "") : "");
    if (!responseType) {
      rows.push({
        ...base,
        status: "ERROR",
        note: `"${(cells[iType] ?? "").trim()}" is not an answer type. Try "Rating 0 to 5".`,
      });
      return;
    }

    const answeredBy = readAnsweredBy(iWho >= 0 ? (cells[iWho] ?? "") : "");
    if (!answeredBy) {
      rows.push({
        ...base,
        responseType,
        status: "ERROR",
        note: `"${(cells[iWho] ?? "").trim()}" is not one of the people who can be asked.`,
      });
      return;
    }

    const isRequired = readRequired(iRequired >= 0 ? (cells[iRequired] ?? "") : "");
    if (isRequired === null) {
      rows.push({
        ...base,
        responseType,
        answeredBy,
        status: "ERROR",
        note: `"${(cells[iRequired] ?? "").trim()}" is not Yes or No.`,
      });
      return;
    }

    /* -- The same question twice for the same department, inside one file.
          Postgres would catch it on the unique mapping, but only after the first
          had been written — and "already mapped" is a misleading thing to read
          when the duplicate is four rows above in the file you just uploaded. -- */
    const dupeKey = `${department.toLowerCase()}::${questionKey(text)}`;
    if (seenInFile.has(dupeKey)) {
      rows.push({
        ...base,
        responseType,
        answeredBy,
        isRequired,
        status: "ERROR",
        note: "This question is already on an earlier row for the same department.",
      });
      return;
    }
    seenInFile.add(dupeKey);

    const departmentKnown = knownDepartments.has(department.toLowerCase());
    if (!departmentKnown) unknown.add(department);

    const match = byKey.get(questionKey(text));

    rows.push({
      ...base,
      responseType,
      answeredBy,
      isRequired,
      existingId: match?.id,
      // An unknown department is the more urgent thing to say: it needs a
      // decision before the import can run at all, whereas "already exists"
      // only describes what will happen.
      status: !departmentKnown ? "NEW_DEPARTMENT" : match ? "EXISTS" : "NEW",
      note: !departmentKnown
        ? `There is no "${department}" department yet.`
        : match
          ? "This question already exists. It will be mapped to this department, not duplicated."
          : undefined,
    });
  });

  return {
    rows,
    counts: {
      new: rows.filter((r) => r.status === "NEW").length,
      exists: rows.filter((r) => r.status === "EXISTS").length,
      newDepartments: rows.filter((r) => r.status === "NEW_DEPARTMENT").length,
      errors: rows.filter((r) => r.status === "ERROR").length,
    },
    unknownDepartments: [...unknown],
  };
}

function blank() {
  return { new: 0, exists: 0, newDepartments: 0, errors: 0 };
}

/* ---------- The template, and the export mirror ---------- */

export const IMPORT_HEADERS = [
  "department",
  "question_text",
  "helper_text",
  "answer_type",
  "who_answers",
  "required",
] as const;

/** A field is quoted whenever it could otherwise shift the columns of its row. */
function cell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/*
 * BOM + CRLF, for the same reason P16-8 and P19C-11 give: Excel on Windows
 * renders bare-LF UTF-8 as mojibake, and these are Indian names and rupee-era
 * spreadsheets. The template must round-trip through the importer that reads it.
 */
export function toCsv(rows: ReadonlyArray<ReadonlyArray<string>>): string {
  return "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

export function importTemplateCsv(): string {
  return toCsv([
    [...IMPORT_HEADERS],
    [
      "Design",
      "Colour Matching & Design Accuracy",
      "Colours come out on fabric matching the approved shade or Pantone",
      "Rating 0 to 5",
      "The employee and their manager",
      "Yes",
    ],
    ["Design", "Design Creativity & Innovation", "", "Rating 0 to 5", "", "Yes"],
  ]);
}
