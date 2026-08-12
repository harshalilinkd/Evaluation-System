"use client";

/** "Preview the full form" — the real renderer, read-only and watermarked. */

import { useEffect, useState } from "react";

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { FormRenderer } from "@/components/appraise/form-renderer";
import { ScaleLegend } from "@/components/appraise/rating-scale";
import { ErrorState, TableSkeleton } from "@/components/appraise/states";
import { useSectionLabel } from "@/components/appraise/section-labels";
import { loadDepartmentPreview, type PreviewResult } from "@/app/(app)/admin/departments/[id]/preview-action";

/**
 * §13.5: "That preview is the trust-builder — make it exact."
 *
 * So this draws with `FormRenderer` — the same component P12's real
 * self-evaluation uses — from a `FormDefinition` assembled by the same code the
 * real form runs. There is no second renderer and no second assembly path; the
 * only difference is that the questions come from the live bank rather than a
 * frozen snapshot, which is exactly what makes it a preview.
 */
export function PreviewDrawer({
  open,
  onOpenChange,
  departmentId,
  departmentName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  departmentId: string;
  departmentName: string;
}) {
  // HR's own name for it, not the shipped default (P25).
  const departmentSection = useSectionLabel("DEPARTMENT_SPECIFIC");
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto bg-background p-0 sm:max-w-[720px]"
      >
        <SheetHeader className="space-y-1 border-b border-rule bg-surface px-6 py-4">
          <SheetTitle className="text-display-md text-ink">
            The form a {departmentName} employee will see
          </SheetTitle>
          <p className="text-body-sm text-ink-muted">
            Read-only. {departmentSection} is highlighted — every other section is
            identical for every employee in the company.
          </p>
        </SheetHeader>

        {open ? <PreviewBody departmentId={departmentId} departmentName={departmentName} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function PreviewBody({
  departmentId,
  departmentName,
}: {
  departmentId: string;
  departmentName: string;
}) {
  const [result, setResult] = useState<PreviewResult | null>(null);

  // Loaded on open rather than with the page: assembling a whole form is real
  // work, and most visits to this screen never open the preview.
  useEffect(() => {
    let cancelled = false;
    loadDepartmentPreview(departmentId).then((r) => {
      if (!cancelled) setResult(r);
    });
    return () => {
      cancelled = true;
    };
  }, [departmentId]);

  if (!result) {
    return (
      <div className="p-6">
        <TableSkeleton rows={6} columns={2} />
      </div>
    );
  }

  if (!result.ok) {
    return (
      <div className="p-6">
        <ErrorState
          title="Nothing to preview yet"
          body={result.error.message}
          detail={result.error.code}
        />
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* §6's wording, once at the top — the placement the real form uses.
          Rendered only when there is a 0-5 question to explain. */}
      <ScaleLegend form={result.data} className="mb-4" />

      <FormRenderer
        form={result.data}
        readOnly
        watermark="Preview"
        highlightDepartment={departmentName}
      />
    </div>
  );
}
