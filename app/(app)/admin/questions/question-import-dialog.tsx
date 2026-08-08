"use client";

/** Bulk Job Specific Skills import: upload → preview → confirm. */

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Download, Loader2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { importTemplateCsv, type ImportPreview, type ImportStatus } from "@/lib/questions/import";
import {
  commitQuestionImport,
  exportQuestions,
  previewQuestionImport,
} from "@/lib/questions/import-actions";
import { responseTypeLabel } from "@/lib/questions/labels";
import { cn } from "@/lib/utils";

/** Downloading is a browser job, not a route: the file is already in memory. */
function download(filename: string, contents: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

const STATUS_STYLE: Record<ImportStatus, string> = {
  NEW: "bg-success-tint text-success",
  EXISTS: "bg-surface-mute text-ink-muted",
  NEW_DEPARTMENT: "bg-warning-tint text-warning",
  ERROR: "bg-critical-tint text-critical",
};

const STATUS_LABEL: Record<ImportStatus, string> = {
  NEW: "New",
  EXISTS: "Already exists",
  NEW_DEPARTMENT: "New department",
  ERROR: "Error",
};

export function QuestionImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();

  const [csvText, setCsvText] = React.useState("");
  const [fileName, setFileName] = React.useState("");
  const [preview, setPreview] = React.useState<ImportPreview | null>(null);
  const [confirmDepartments, setConfirmDepartments] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<string | null>(null);

  async function onFile(file: File) {
    setError(null);
    setDone(null);
    setBusy(true);
    const text = await file.text();
    setCsvText(text);
    setFileName(file.name);

    const result = await previewQuestionImport(text);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setPreview(result.preview);
    if (result.preview.fatal) setError(result.preview.fatal);
  }

  async function commit() {
    setBusy(true);
    setError(null);
    const result = await commitQuestionImport(csvText, fileName, confirmDepartments);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDone(result.message);
    setPreview(null);
    router.refresh();
  }

  function reset() {
    setCsvText("");
    setFileName("");
    setPreview(null);
    setConfirmDepartments(false);
    setError(null);
    setDone(null);
  }

  const counts = preview?.counts;
  const blocked = Boolean(
    !preview ||
      preview.fatal ||
      (counts?.errors ?? 0) > 0 ||
      (preview.unknownDepartments.length > 0 && !confirmDepartments),
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="max-h-[88vh] w-[min(96vw,900px)] max-w-[96vw] overflow-hidden border-rule bg-surface"
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="font-sans text-display-md">Import questions</DialogTitle>
          <DialogDescription className="font-sans text-body text-ink-muted">
            A spreadsheet of Job Specific Skills questions, one row per question. A question that
            already exists is mapped to the department rather than duplicated, so the same question
            can serve several teams and changing its wording changes it everywhere.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          {/* ---------- Step 1 ---------- */}
          {!preview && !done ? (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  className="min-h-11"
                  onClick={() => download("job-specific-questions-template.csv", importTemplateCsv())}
                >
                  <Download className="size-4" aria-hidden />
                  Download the template
                </Button>
                <Button
                  variant="outline"
                  className="min-h-11"
                  onClick={async () => {
                    const result = await exportQuestions();
                    if (result.ok) download(result.filename, result.csv);
                    else setError(result.error);
                  }}
                >
                  <Download className="size-4" aria-hidden />
                  Export what is there now
                </Button>
              </div>

              <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-card border border-dashed border-rule bg-surface-mute px-6 py-10 text-center">
                <Upload className="size-6 text-ink-muted" aria-hidden />
                <span className="text-body text-ink">Choose a CSV file</span>
                <span className="text-body-sm text-ink-muted">
                  Needs a column for the department and one for the question. Everything else is
                  optional — questions default to a 0-5 rating answered by the employee and their
                  manager.
                </span>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void onFile(file);
                  }}
                />
              </label>

              <p className="text-body-sm text-ink-muted">
                A sheet where the department is written once and the rows beneath it are blank works
                as it is — the department carries down. There is no need to reformat it.
              </p>
            </div>
          ) : null}

          {/* ---------- Step 2 ---------- */}
          {preview && !preview.fatal && !done ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-body-sm">
                <span className="rounded-pill bg-success-tint px-2.5 py-1 text-success">
                  {counts?.new ?? 0} new
                </span>
                <span className="rounded-pill bg-surface-mute px-2.5 py-1 text-ink-muted">
                  {counts?.exists ?? 0} already exist
                </span>
                {(counts?.newDepartments ?? 0) > 0 ? (
                  <span className="rounded-pill bg-warning-tint px-2.5 py-1 text-warning">
                    {counts?.newDepartments} in a new department
                  </span>
                ) : null}
                {(counts?.errors ?? 0) > 0 ? (
                  <span className="rounded-pill bg-critical-tint px-2.5 py-1 text-critical">
                    {counts?.errors} {counts?.errors === 1 ? "error" : "errors"}
                  </span>
                ) : null}
                <span className="ml-auto text-ink-muted">{fileName}</span>
              </div>

              {(counts?.errors ?? 0) > 0 ? (
                <p className="flex items-start gap-2 rounded-control border-l-2 border-l-critical bg-critical-tint/40 py-2 pl-3 pr-3 text-body-sm text-ink">
                  <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
                  Nothing will be imported while there is an error. Fix the rows below and upload
                  the file again — a half-imported file is harder to sort out than a rejected one.
                </p>
              ) : null}

              {preview.unknownDepartments.length > 0 ? (
                <label className="flex cursor-pointer items-start gap-2 rounded-control border-l-2 border-l-warning bg-warning-tint/40 py-3 pl-3 pr-3 text-body-sm text-ink">
                  <Checkbox
                    checked={confirmDepartments}
                    onCheckedChange={(v) => setConfirmDepartments(v === true)}
                    className="mt-0.5"
                  />
                  <span>
                    Create {preview.unknownDepartments.length === 1 ? "the department" : "these departments"}{" "}
                    <span className="font-medium">{preview.unknownDepartments.join(", ")}</span>. If
                    one of those is a typo, close this and correct the file instead — a department
                    created by mistake has to be retired by hand.
                  </span>
                </label>
              ) : null}

              <div className="max-h-[42vh] overflow-auto rounded-card border border-rule">
                <table className="w-full border-collapse text-body-sm">
                  <thead className="sticky top-0 bg-surface-mute">
                    <tr>
                      <th className="border-b border-rule px-3 py-2 text-left font-medium text-ink">Row</th>
                      <th className="border-b border-rule px-3 py-2 text-left font-medium text-ink">Department</th>
                      <th className="border-b border-rule px-3 py-2 text-left font-medium text-ink">Question</th>
                      <th className="border-b border-rule px-3 py-2 text-left font-medium text-ink">Type</th>
                      <th className="border-b border-rule px-3 py-2 text-left font-medium text-ink">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row) => (
                      <tr key={row.line} className="align-top">
                        <td className="tabular border-b border-rule px-3 py-2 text-ink-muted">{row.line}</td>
                        <td className="border-b border-rule px-3 py-2 text-ink">{row.department}</td>
                        <td className="border-b border-rule px-3 py-2 text-ink">
                          {row.text || <span className="text-ink-muted">—</span>}
                          {row.note ? (
                            <span className="block text-ink-muted">{row.note}</span>
                          ) : null}
                        </td>
                        <td className="border-b border-rule px-3 py-2 text-ink-muted">
                          {responseTypeLabel(row.responseType)}
                        </td>
                        <td className="border-b border-rule px-3 py-2">
                          <span
                            className={cn(
                              "whitespace-nowrap rounded-pill px-2 py-0.5",
                              STATUS_STYLE[row.status],
                            )}
                          >
                            {STATUS_LABEL[row.status]}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {/* ---------- Step 3 ---------- */}
          {done ? (
            <p className="flex items-start gap-2 rounded-card border border-success/40 bg-success-tint px-4 py-3 text-body-sm text-ink">
              <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
              <span>
                <span className="font-medium">Imported.</span> {done} Launched evaluations are
                unchanged — they keep the questions they were launched with.
              </span>
            </p>
          ) : null}

          {error ? (
            <p
              role="alert"
              className="rounded-card border border-critical/40 bg-critical-tint px-4 py-3 text-body-sm text-critical"
            >
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          {done ? (
            <>
              <Button variant="outline" className="min-h-11" onClick={reset}>
                Import another file
              </Button>
              <Button className="min-h-11" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                className="min-h-11"
                onClick={() => (preview ? reset() : onOpenChange(false))}
                disabled={busy}
              >
                {preview ? "Choose a different file" : "Cancel"}
              </Button>
              <Button className="min-h-11" onClick={() => void commit()} disabled={blocked || busy}>
                {busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
                Import {counts ? counts.new + counts.exists + counts.newDepartments : ""}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
