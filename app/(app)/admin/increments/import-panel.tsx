"use client";

/** Bulk employment import (P19). HR only — salary figures pass through here. */

import * as React from "react";
import { Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { commitEmploymentImport, previewEmploymentImport } from "@/lib/employment/actions";
import { EMPLOYMENT_COLUMNS, employmentTemplate, type EmploymentPreviewRow } from "@/lib/employment/import";
import { formatDate, formatInr } from "@/lib/utils/date";
import { cn } from "@/lib/utils";

type Stage =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "previewed"; rows: EmploymentPreviewRow[]; valid: number }
  | { kind: "importing" }
  | { kind: "done"; rows: number; salaryRows: number };

/**
 * The import, as a module the header button opens.
 *
 * All of the state lives in `ImportForm`, which Radix unmounts when the dialog
 * closes — so a second open starts from `idle` with no file and no preview.
 * That is the keyed-remount idiom (P10-11) falling out of the portal for free:
 * reopening is a NEW import, not the old one wiped by an effect.
 */
export function EmploymentImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Capped so a long preview can never outgrow the viewport. The BODY
          scrolls, not the dialog: the header and its close button are the way
          out, and a way out that scrolls off the top is not one. */}
      <DialogContent className="max-h-[86dvh] max-w-3xl grid-rows-[auto_minmax(0,1fr)] overflow-hidden border-rule bg-surface">
        <DialogHeader>
          <DialogTitle className="font-sans text-display-md">Import employment data</DialogTitle>
          <DialogDescription className="font-sans text-body text-ink-muted">
            For the initial load. Matches people by employee code — the whole file is written, or
            none of it is.
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto">
          <ImportForm />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ImportForm() {
  const [stage, setStage] = React.useState<Stage>({ kind: "idle" });
  const [error, setError] = React.useState<string | null>(null);
  // The text is kept rather than the File object: the commit re-validates
  // server-side from the same text, so the two passes cannot see different
  // bytes (a re-read could, if the file changed on disk between them).
  const [file, setFile] = React.useState<{ name: string; text: string } | null>(null);

  function downloadTemplate() {
    const url = URL.createObjectURL(
      new Blob([employmentTemplate()], { type: "text/csv;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "linkd-prints-employment.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function onChoose(event: React.ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    if (!chosen) return;

    setError(null);
    setStage({ kind: "checking" });

    const text = await chosen.text();
    setFile({ name: chosen.name, text });

    const result = await previewEmploymentImport(text, chosen.name);
    if (!result.ok) {
      setError(result.error.message);
      setStage({ kind: "idle" });
      return;
    }
    setStage({ kind: "previewed", rows: result.data.rows, valid: result.data.valid });
  }

  async function onImport() {
    if (!file) return;
    setError(null);
    setStage({ kind: "importing" });

    const result = await commitEmploymentImport(file.text, file.name);
    if (!result.ok) {
      setError(result.error.message);
      // Back to the preview, so the rows needing fixing are still on screen.
      const again = await previewEmploymentImport(file.text, file.name);
      setStage(again.ok ? { kind: "previewed", rows: again.data.rows, valid: again.data.valid } : { kind: "idle" });
      return;
    }
    setStage({ kind: "done", rows: result.data.rows, salaryRows: result.data.salaryRows });
  }

  const rows = stage.kind === "previewed" ? stage.rows : [];
  const validCount = stage.kind === "previewed" ? stage.valid : 0;
  const bad = rows.filter((r) => !r.value);
  const canImport = stage.kind === "previewed" && bad.length === 0 && rows.length > 0;

  return (
    <div className="space-y-5">
      {error ? (
        <p
          role="alert"
          className="rounded-control border border-critical/40 bg-critical-tint px-3 py-2 font-sans text-body-sm text-critical"
        >
          {error}
        </p>
      ) : null}

      {stage.kind === "done" ? (
        <p
          role="status"
          className="rounded-control border border-final/40 bg-final-tint px-3 py-2 font-sans text-body-sm text-final"
        >
          {stage.rows} {stage.rows === 1 ? "record" : "records"} imported
          {stage.salaryRows > 0
            ? `, and ${stage.salaryRows} opening pay ${stage.salaryRows === 1 ? "row" : "rows"} written.`
            : "."}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" className="min-h-11" onClick={downloadTemplate}>
          Download the template
        </Button>

        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-control border border-rule bg-surface px-4 font-sans text-body text-ink hover:bg-surface-mute">
          <Upload className="size-4" aria-hidden />
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={onChoose} />
          {file?.name ?? "Choose a CSV file"}
        </label>

        {stage.kind === "checking" ? (
          <span className="font-sans text-body-sm text-ink-muted">Checking the file…</span>
        ) : null}

        {stage.kind === "previewed" || stage.kind === "importing" ? (
          <Button
            type="button"
            className="min-h-11"
            // Order matters: TypeScript narrows through the `canImport` alias,
            // so testing it first would make the "importing" check unreachable.
            disabled={stage.kind === "importing" || !canImport}
            onClick={onImport}
          >
            {stage.kind === "importing"
              ? "Importing…"
              : `Import ${validCount} ${validCount === 1 ? "record" : "records"}`}
          </Button>
        ) : null}
      </div>

      {/* §13.4: a disabled control needs its reason beside it, not in a tooltip. */}
      {stage.kind === "previewed" && bad.length > 0 ? (
        <p className="rounded-control border border-critical/40 bg-critical-tint px-3 py-2 font-sans text-body-sm text-critical">
          {bad.length} {bad.length === 1 ? "row needs" : "rows need"} fixing. Nothing will be
          imported until every row is right — fix the file and choose it again.
        </p>
      ) : null}

      <details className="rounded-control border border-rule bg-surface-mute p-4">
        <summary className="cursor-pointer font-sans text-body text-ink">
          What the columns mean
        </summary>
        <ul className="mt-3 space-y-1.5">
          {EMPLOYMENT_COLUMNS.map((column) => (
            <li key={column.header} className="font-sans text-body-sm text-ink-muted">
              <span className="tabular text-ink">{column.header}</span>
              {column.required ? (
                <span className="type-label ml-2 text-critical">required</span>
              ) : null}
              <span className="ml-2 text-ink-faint">{column.hint}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 font-sans text-body-sm text-ink-faint">
          A blank salary column means &ldquo;not in this file&rdquo;, never &ldquo;set it to
          nothing&rdquo; — an existing figure is left alone. The next increment date is worked out
          for you and is not a column.
        </p>
      </details>

      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-control border border-rule">
          <table className="w-full min-w-[760px] border-collapse">
            <thead>
              <tr className="border-b border-rule bg-surface-mute">
                {["Row", "Code", "Name", "Joined", "Last increment", "Current CTC", ""].map((h) => (
                  <th key={h} className="type-label px-4 py-2 text-left text-ink-muted">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.line}
                  className={cn(
                    "border-b border-rule last:border-b-0",
                    // A left bar as well as the tint: colour is never the only
                    // signal (§13.8).
                    !row.value && "border-l-2 border-l-critical bg-critical-tint/40",
                  )}
                >
                  <td className="px-4 py-2 tabular text-body-sm text-ink-muted">{row.line}</td>
                  <td className="px-4 py-2 tabular text-body-sm text-ink">{row.employeeCode || "—"}</td>
                  <td className="px-4 py-2 font-sans text-body-sm text-ink">{row.name ?? "—"}</td>
                  <td className="px-4 py-2 tabular text-body-sm text-ink-muted">
                    {row.value?.date_of_joining ? formatDate(row.value.date_of_joining) : "—"}
                  </td>
                  <td className="px-4 py-2 tabular text-body-sm text-ink-muted">
                    {row.value?.last_increment_date ? formatDate(row.value.last_increment_date) : "—"}
                  </td>
                  <td className="px-4 py-2 tabular text-body-sm text-ink">
                    {row.value?.current_ctc !== undefined ? formatInr(row.value.current_ctc) : "—"}
                  </td>
                  <td className="px-4 py-2 font-sans text-body-sm text-critical">{row.error ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
