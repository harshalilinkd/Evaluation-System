/** Employment CSV import: the columns, and what makes a row valid. Pure. */

import { z } from "zod";

/**
 * The five columns P19 names, plus the increment frequency.
 *
 * `employee_code` is the key. It is the identifier HR's other systems carry and
 * the one they look people up by — an email would work too, but a payroll
 * export is far more likely to have the code than the work address.
 */
export const EMPLOYMENT_COLUMNS: ReadonlyArray<{
  header: string;
  required?: boolean;
  hint: string;
}> = [
  { header: "employee_code", required: true, hint: "must already exist in the system" },
  { header: "date_of_joining", hint: "DD-MM-YYYY" },
  { header: "last_increment_date", hint: "DD-MM-YYYY — blank for a new joiner" },
  { header: "current_ctc", hint: "480000, or ₹4,80,000" },
  { header: "employment_type", hint: "PERMANENT / PROBATION / CONTRACT / TRAINEE" },
  { header: "increment_frequency_months", hint: "12 if left blank" },
];

/** An optional rupee figure. Empty means "not in this file", never zero. */
const money = z.preprocess(
  (value) => {
    if (value === null || value === undefined) return undefined;
    const text = String(value).replace(/[₹,\s]/g, "");
    return text === "" ? undefined : Number(text);
  },
  z
    .number({ invalid_type_error: "The salary is not a number" })
    .positive("A salary must be more than zero")
    .max(100_000_000, "That salary looks too large — check the figure")
    .optional(),
);

export const employmentRowSchema = z.object({
  employee_code: z.string().trim().min(1, "The employee code is missing"),
  date_of_joining: z.string().optional(),
  last_increment_date: z.string().optional(),
  current_ctc: money,
  employment_type: z
    .enum(["PERMANENT", "PROBATION", "CONTRACT", "TRAINEE"], {
      errorMap: () => ({ message: "Employment type must be PERMANENT, PROBATION, CONTRACT or TRAINEE" }),
    })
    .optional(),
  increment_frequency_months: z.preprocess(
    (value) => {
      const text = String(value ?? "").trim();
      return text === "" ? undefined : Number(text);
    },
    z.number().int().min(1).max(60).optional(),
  ),
});

export type EmploymentRow = z.infer<typeof employmentRowSchema>;

/** The template HR downloads: header row, then one filled example. */
export function employmentTemplate(): string {
  const header = EMPLOYMENT_COLUMNS.map((c) => c.header).join(",");
  const example = ["LP-014", "01-04-2022", "01-04-2025", "480000", "PERMANENT", "12"].join(",");
  // BOM and CRLF, so Excel on Windows opens it without mojibake (P16-8).
  return `﻿${header}\r\n${example}\r\n`;
}

/** One row's outcome, whether it was accepted or refused. */
export type EmploymentPreviewRow = {
  line: number;
  employeeCode: string;
  /** The person the code resolved to, once known. */
  name?: string;
  error?: string;
  /** What would be written. Present only when the row is valid. */
  value?: {
    profile_id: string;
    date_of_joining?: string;
    last_increment_date?: string;
    current_ctc?: number;
    employment_type?: string;
    increment_frequency_months?: number;
  };
};
