/** Saving a CSV string a server action has already built. Browser-side only. */

"use client";

/*
 * Downloading is a browser job, not a route — the file is already in memory by
 * the time this runs, so there is nothing for a route to serve. Three call
 * sites built this inline before this file existed (the question bank's
 * import dialog and the users-tab export); this is for new ones, so the next
 * caller has one place to reach for rather than a fourth copy of six lines.
 */
export function downloadCsv(filename: string, csv: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
