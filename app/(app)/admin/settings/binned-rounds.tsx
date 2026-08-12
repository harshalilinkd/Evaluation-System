"use client";

/** Binned production rounds, on the Settings recycle bin. Their own section. */

import * as React from "react";
import { useRouter } from "next/navigation";
import { HardHat, Loader2, RotateCcw, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { deleteWorkerRoundForever, restoreWorkerRound } from "@/lib/worker/cycle-actions";

export type BinnedRound = {
  id: string;
  name: string;
  period_label: string;
  status: string;
};

const STATUS_WORD: Record<string, string> = {
  DRAFT: "Not started",
  ACTIVE: "Running",
  CLOSED: "Finished",
};

/**
 * WHY A SECOND SECTION RATHER THAN ONE MERGED LIST
 *
 * §7 forbids refactoring a staff function to serve the worker module and the
 * reverse. A merged table would need a discriminator on every row and a restore
 * that branches on it — one function doing two modules' work, which is exactly
 * what that rule exists to prevent.
 *
 * They share a SCREEN, which is the thing somebody is looking for when they go
 * hunting for something they deleted. They share no code: this calls
 * `restoreWorkerRound` and `deleteWorkerRoundForever`, and knows nothing about
 * evaluation cycles.
 *
 * It moved here from the Production Appraisals list at the owner's instruction —
 * it was a card there with the same visual weight as a live round, on a screen
 * nobody visits to look for a deleted one.
 */
export function BinnedRounds({ rounds }: { rounds: BinnedRound[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [purging, setPurging] = React.useState<BinnedRound | null>(null);

  if (rounds.length === 0) return null;

  async function restore(id: string) {
    setBusyId(id);
    setError(null);
    const result = await restoreWorkerRound(id);
    setBusyId(null);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    router.refresh();
  }

  return (
    <section className="mt-8 space-y-3">
      <div className="flex items-center gap-2">
        <HardHat aria-hidden className="size-4 shrink-0 text-ink-muted" />
        <h3 className="font-sans text-body font-medium text-ink">
          Production rounds · {rounds.length} in the bin
        </h3>
      </div>

      {error ? (
        <p role="alert" className="rounded-control bg-critical-tint px-3 py-2 font-sans text-body-sm text-critical">
          {error}
        </p>
      ) : null}

      <ul className="card-surface divide-y divide-rule">
        {rounds.map((round) => (
          <li key={round.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="truncate font-sans text-body text-ink">{round.name}</p>
              <p className="font-sans text-body-sm text-ink-muted">
                {round.period_label} · {STATUS_WORD[round.status] ?? round.status}
              </p>
            </div>
            <span className="flex items-center gap-2">
              <Button
                variant="outline"
                className="min-h-11"
                disabled={busyId === round.id}
                onClick={() => void restore(round.id)}
              >
                {busyId === round.id ? (
                  <Loader2 aria-hidden className="size-4 animate-spin" />
                ) : (
                  <RotateCcw aria-hidden className="size-4" />
                )}
                Restore
              </Button>
              {/* -- Offered only where it can succeed. A round that was ever
                    LAUNCHED cascades to every frozen sheet and every tick in it,
                    and §5's snapshot rule is what makes an appraisal a record
                    rather than a picture of a form that has since changed. The
                    action refuses it server-side; not offering the button is
                    what stops somebody discovering that by pressing it. -- */}
              {round.status === "DRAFT" ? (
                <Button
                  variant="ghost"
                  className="min-h-11 text-critical hover:text-critical"
                  onClick={() => setPurging(round)}
                >
                  <Trash2 aria-hidden className="size-4" />
                  Delete for good
                </Button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>

      <Dialog open={purging !== null} onOpenChange={(open) => (open ? null : setPurging(null))}>
        <DialogContent className="w-[min(96vw,480px)] border-rule">
          <DialogHeader>
            <DialogTitle className="text-display-sm text-ink">
              Delete {purging?.name} for good?
            </DialogTitle>
            <DialogDescription className="font-sans text-body-sm text-ink-muted">
              This cannot be undone. The round and everything in it are removed. Only a round that
              was never started can be deleted — anything with sheets in it stays in the bin.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" className="min-h-11" onClick={() => setPurging(null)}>
              Keep it
            </Button>
            <Button
              className="min-h-11 bg-critical text-ink-invert hover:bg-critical/90"
              disabled={busyId !== null}
              onClick={async () => {
                if (!purging) return;
                setBusyId(purging.id);
                setError(null);
                const result = await deleteWorkerRoundForever(purging.id);
                setBusyId(null);
                setPurging(null);
                if (!result.ok) {
                  setError(result.error.message);
                  return;
                }
                router.refresh();
              }}
            >
              Delete for good
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
