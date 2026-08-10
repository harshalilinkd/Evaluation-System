"use client";

/** The worker appraisal list, and the one dialog that starts a round. */

import * as React from "react";
import { useRouter } from "next/navigation";
import { HardHat, Loader2, Plus } from "lucide-react";

import { DashboardCard } from "@/components/appraise/metric-widget";
import { EmptyState } from "@/components/appraise/states";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createWorkerCycle, launchWorkerCycle } from "@/lib/worker/cycle-actions";
import { formatDate } from "@/lib/utils/date";

export type WorkerCycleRow = {
  id: string;
  name: string;
  period_label: string;
  status: string;
  self_due_on: string | null;
  supervisor_due_on: string | null;
  md_due_on: string | null;
};

export type WorkerRow = {
  id: string;
  name: string;
  employeeCode: string | null;
  supervisorName: string | null;
};

const STATUS_WORD: Record<string, string> = {
  DRAFT: "Not started",
  ACTIVE: "Running",
  CLOSED: "Finished",
};

export function WorkerCyclesClient({
  cycles,
  workers,
}: {
  cycles: WorkerCycleRow[];
  workers: WorkerRow[];
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-sans text-h2 text-ink">Worker appraisals</h1>
          {/* Said once, at the top. The two modules look alike and are not:
              different form, different scale, different people. Somebody who
              arrives expecting the staff cycle screen should learn that here
              rather than after starting a round. */}
          <p className="mt-1 max-w-prose font-sans text-body-sm text-ink-muted">
            The shop-floor three-tick sheet. Separate from staff evaluations, and nothing is shared
            between them. The worker and their supervisor tick the same sheet at the same time, and
            neither sees the other&rsquo;s answers.
          </p>
        </div>
        <Button onClick={() => setOpen(true)} className="min-h-11">
          <Plus className="size-4" aria-hidden />
          Start a round
        </Button>
      </header>

      {cycles.length === 0 ? (
        <EmptyState
          title="No worker appraisals yet"
          body={
            workers.length === 0
              ? "Nobody is on the shop-floor track. Set somebody's track to Worker in Settings, Users first."
              : `${workers.length} ${workers.length === 1 ? "worker is" : "workers are"} ready to be appraised.`
          }
        />
      ) : (
        <div className="grid gap-4">
          {cycles.map((cycle) => (
            <DashboardCard key={cycle.id} title={cycle.name}>
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <p className="font-sans text-body-sm text-ink-muted">
                  {cycle.period_label} · {STATUS_WORD[cycle.status] ?? cycle.status}
                </p>
                <p className="tabular font-sans text-body-sm text-ink-muted">
                  Supervisor due {formatDate(cycle.supervisor_due_on)}
                </p>
              </div>
            </DashboardCard>
          ))}
        </div>
      )}

      <StartDialog open={open} onOpenChange={setOpen} workers={workers} />
    </div>
  );
}

/**
 * One dialog, not a four-step wizard.
 *
 * The staff wizard has four steps because it has four decisions: a cycle type,
 * a department-varying form, a per-person lead, and a readiness report. None of
 * those exists here. Every worker answers the identical eight qualities and
 * their supervisor comes from their profile, so what is left is a name, three
 * dates and a list of people, which is one screenful.
 */
function StartDialog({
  open,
  onOpenChange,
  workers,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workers: WorkerRow[];
}) {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [period, setPeriod] = React.useState("");
  const [selfDue, setSelfDue] = React.useState("");
  const [supervisorDue, setSupervisorDue] = React.useState("");
  const [mdDue, setMdDue] = React.useState("");
  const [chosen, setChosen] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  /* Nobody is ticked to begin with. Starting a round opens a real appraisal for
     real people, and a pre-ticked list is a decision the app made that HR is
     presumed to have agreed with. The header checkbox is one press away. */
  const eligible = workers.filter((w) => w.supervisorName);
  const allChosen = eligible.length > 0 && chosen.size === eligible.length;

  async function submit() {
    setBusy(true);
    setError(null);

    const created = await createWorkerCycle({
      name,
      periodLabel: period,
      selfDueOn: selfDue,
      supervisorDueOn: supervisorDue,
      mdDueOn: mdDue,
    });
    if (!created.ok) {
      setBusy(false);
      setError(created.error.message);
      return;
    }

    const launched = await launchWorkerCycle(created.data.id, [...chosen]);
    setBusy(false);
    if (!launched.ok) {
      /* The cycle exists as a draft by now. Say so, rather than leaving
         somebody to wonder whether pressing the button again makes a second. */
      setError(`${launched.error.message} The round has been saved as a draft.`);
      return;
    }

    onOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] w-[min(96vw,720px)] max-w-none flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-rule px-6 py-4">
          <DialogTitle className="flex items-center gap-2">
            <HardHat className="size-4 text-ink-muted" aria-hidden />
            Start a round
          </DialogTitle>
          <DialogDescription>
            Both sheets go live as soon as you start. Neither side sees the other&rsquo;s ticks.
          </DialogDescription>
        </DialogHeader>

        {/* The action bar is a sibling of the scroll region, never inside it —
            a sticky bar within a scroller floats over the content. */}
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="wc_name">Name</Label>
              <Input
                id="wc_name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Shop floor Q3"
                className="min-h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wc_period">Period</Label>
              <Input
                id="wc_period"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                placeholder="Oct-Dec 25"
                className="min-h-11"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="wc_self">Worker due</Label>
              <Input
                id="wc_self"
                type="date"
                value={selfDue}
                onChange={(e) => setSelfDue(e.target.value)}
                className="min-h-11 tabular"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wc_sup">Supervisor due</Label>
              <Input
                id="wc_sup"
                type="date"
                value={supervisorDue}
                onChange={(e) => setSupervisorDue(e.target.value)}
                className="min-h-11 tabular"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wc_md">Final due</Label>
              <Input
                id="wc_md"
                type="date"
                value={mdDue}
                onChange={(e) => setMdDue(e.target.value)}
                className="min-h-11 tabular"
              />
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="font-sans text-body font-medium text-ink">Who is in it</p>
              <p className="tabular font-sans text-body-sm text-ink-muted">
                {chosen.size} of {eligible.length} chosen
              </p>
            </div>

            {eligible.length === 0 ? (
              <p className="rounded-control bg-warning-tint px-4 py-3 text-body-sm text-ink">
                No shop-floor worker has a supervisor set. A worker with nobody above them cannot be
                appraised, because there would be nobody to fill the other side.
              </p>
            ) : (
              <div className="overflow-hidden rounded-card border border-rule">
                <label className="flex items-center gap-3 border-b border-rule bg-surface-mute px-4 py-2.5">
                  <Checkbox
                    checked={chosen.size === 0 ? false : allChosen ? true : "indeterminate"}
                    onCheckedChange={() =>
                      setChosen(allChosen ? new Set() : new Set(eligible.map((w) => w.id)))
                    }
                    aria-label={allChosen ? "Clear everyone" : "Choose everyone"}
                  />
                  <span className="font-sans text-body-sm text-ink">Everyone on the shop floor</span>
                </label>

                <ul className="max-h-64 overflow-y-auto">
                  {eligible.map((w) => (
                    <li key={w.id}>
                      <label className="flex items-center gap-3 border-b border-rule px-4 py-2.5 last:border-b-0">
                        <Checkbox
                          checked={chosen.has(w.id)}
                          onCheckedChange={(checked) =>
                            setChosen((prev) => {
                              const next = new Set(prev);
                              if (checked === true) next.add(w.id);
                              else next.delete(w.id);
                              return next;
                            })
                          }
                          aria-label={`Include ${w.name}`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-sans text-body-sm text-ink">
                            {w.name}
                          </span>
                          <span className="block truncate font-sans text-body-sm text-ink-muted">
                            Rated by {w.supervisorName}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {workers.length > eligible.length ? (
              <p className="mt-2 font-sans text-body-sm text-ink-muted">
                {workers.length - eligible.length} not listed, because there is no supervisor on
                their profile.
              </p>
            ) : null}
          </div>

          {error ? (
            <p
              role="alert"
              className="rounded-control bg-critical-tint px-4 py-3 text-body-sm text-critical"
            >
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter className="shrink-0 border-t border-rule px-6 py-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="min-h-11">
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={busy || chosen.size === 0}
            className="min-h-11"
          >
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Start for {chosen.size} {chosen.size === 1 ? "worker" : "workers"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
