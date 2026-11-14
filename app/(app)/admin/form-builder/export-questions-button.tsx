"use client";

/** A download button for a whole-form question export (`lib/questions/form-export.ts`). */

import * as React from "react";
import { Download, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ExportResult } from "@/lib/questions/form-export";
import { downloadCsv } from "@/lib/utils/download-csv";

export function ExportQuestionsButton({
  label,
  action,
}: {
  label: string;
  /** One of the three `export*FormQuestions` server actions. */
  action: () => Promise<ExportResult>;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="min-h-9 shrink-0"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const result = await action();
          setBusy(false);
          if (result.ok) downloadCsv(result.filename, result.csv);
          else setError(result.error);
        }}
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <Download className="size-4" aria-hidden />
        )}
        {label}
      </Button>
      {error ? <p className="text-body-sm text-critical">{error}</p> : null}
    </div>
  );
}
