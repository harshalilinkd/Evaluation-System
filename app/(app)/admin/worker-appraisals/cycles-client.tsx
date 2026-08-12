"use client";

/** The worker appraisal list, and the one dialog that starts a round. */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { HardHat, Loader2, Plus, RotateCcw, Trash2 } from "lucide-react";

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
import {
  addWorkersToRound,
  createWorkerCycle,
  deleteWorkerRoundForever,
  launchWorkerCycle,
  moveWorkerRoundToBin,
  restoreWorkerRound,
} from "@/lib/worker/cycle-actions";
import { cn } from "@/lib/utils";
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
  /** Their `reports_to`. The DEFAULT rater, not the only possible one. */
  supervisorId: string | null;
  supervisorName: string | null;
};

export type RaterRow = {
  id: string;
  name: string;
  designation: string | null;
};

const STATUS_WORD: Record<string, string> = {
  DRAFT: "Not started",
  ACTIVE: "Running",
  CLOSED: "Finished",
};

export function WorkerCyclesClient({
  cycles,
  binned,
  workers,
  raters,
}: {
  cycles: WorkerCycleRow[];
  /** In the recycle bin. Hidden from every other screen; restorable from here. */
  binned: WorkerCycleRow[];
  workers: WorkerRow[];
  raters: RaterRow[];
}) {
  const [open, setOpen] = React.useState(false);
  const [binning, setBinning] = React.useState<WorkerCycleRow | null>(null);
  const [showBin, setShowBin] = React.useState(false);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-display-sm font-semibold text-ink">Worker appraisals</h1>
          {/* Said once, at the top. The two modules look alike and are not:
              different form, different scale, different people. Somebody who
              arrives expecting the staff cycle screen should learn that here
              rather than after starting a round. */}
          <p className="mt-1 max-w-prose font-sans text-body-sm text-ink-muted">
            The Production Team three-tick sheet. Separate from Backend Team evaluations, and nothing is shared
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
              ? "Nobody is on the Production Team yet. Set somebody's form to Production Team in Settings, Users first."
              : `${workers.length} ${workers.length === 1 ? "worker is" : "workers are"} ready to be appraised.`
          }
        />
      ) : (
        <div className="grid gap-4">
          {cycles.map((cycle) => (
            /* The whole card opens the round. A card that looks like a record
               and does nothing when pressed reads as a broken link, which is
               exactly how this was reported. */
            /* The bin control sits BESIDE the link, not inside it: a button
               nested in an anchor is invalid markup and gives a screen reader
               one control where there are two. */
            <div key={cycle.id} className="relative">
              <Link
                href={`/admin/worker-appraisals/${cycle.id}`}
                className="block rounded-card transition-colors hover:bg-surface-mute"
              >
                <DashboardCard title={cycle.name}>
                  <div className="flex flex-wrap items-baseline justify-between gap-3 pr-12">
                    <p className="font-sans text-body-sm text-ink-muted">
                      {cycle.period_label} · {STATUS_WORD[cycle.status] ?? cycle.status}
                    </p>
                    <p className="tabular font-sans text-body-sm text-ink-muted">
                      Supervisor due {formatDate(cycle.supervisor_due_on)}
                    </p>
                  </div>
                </DashboardCard>
              </Link>

              <Button
                variant="ghost"
                size="icon"
                aria-label={`Move ${cycle.name} to the recycle bin`}
                className="absolute right-3 top-3 z-10 min-h-11 text-ink-muted hover:text-critical"
                onClick={() => setBinning(cycle)}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* ---------- The recycle bin ----------
          Collapsed, because it is not the job — but present, because a round
          that can be binned and never restored is a delete wearing a softer
          word. §13.4. */}
      {binned.length > 0 ? (
        <section className="card-surface p-5">
          <button
            type="button"
            onClick={() => setShowBin((v) => !v)}
            aria-expanded={showBin}
            className="flex min-h-11 w-full items-center justify-between gap-3 text-left"
          >
            <span className="font-sans text-body font-medium text-ink">
              Recycle bin · {binned.length} {binned.length === 1 ? "round" : "rounds"}
            </span>
            <span className="font-sans text-body-sm text-ink-muted">
              {showBin ? "Hide" : "Show"}
            </span>
          </button>

          {showBin ? (
            <ul className="mt-3 divide-y divide-rule">
              {binned.map((cycle) => (
                <li key={cycle.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-sans text-body text-ink">{cycle.name}</p>
                    <p className="font-sans text-body-sm text-ink-muted">
                      {cycle.period_label} · {STATUS_WORD[cycle.status] ?? cycle.status}
                    </p>
                  </div>
                  <BinnedRoundActions cycle={cycle} />
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <BinRoundDialog cycle={binning} onClose={() => setBinning(null)} />

      <StartRoundDialog open={open} onOpenChange={setOpen} workers={workers} raters={raters} />
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
export function StartRoundDialog({
  open,
  onOpenChange,
  workers,
  raters,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workers: WorkerRow[];
  raters: RaterRow[];
}) {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [period, setPeriod] = React.useState("");
  const [selfDue, setSelfDue] = React.useState("");
  const [supervisorDue, setSupervisorDue] = React.useState("");
  const [chosen, setChosen] = React.useState<Set<string>>(new Set());

  /* -- Who rates each worker, seeded from their Reports-to and CHANGEABLE here.
        Inheriting it silently is what put "Rated by test MD" on a shop-floor
        worker: the field was set once on a profile, for a different purpose,
        and nothing since had asked whether it was right for this. A default is
        fine; a default nobody can see or override is not. -- */
  const [raterOf, setRaterOf] = React.useState<Record<string, string>>({});
  const raterFor = (w: WorkerRow) => raterOf[w.id] ?? w.supervisorId ?? "";
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  /* Nobody is ticked to begin with. Starting a round opens a real appraisal for
     real people, and a pre-ticked list is a decision the app made that HR is
     presumed to have agreed with. The header checkbox is one press away. */
  /* Everybody is listed now. A worker with no Reports-to is not excluded — they
     simply start with no rater chosen, which is a thing HR can fix here instead
     of being told to go and edit a profile. */
  const eligible = workers;
  const allChosen = eligible.length > 0 && chosen.size === eligible.length;

  async function submit() {
    setBusy(true);
    setError(null);

    /* -- EVERY await is inside the try, and `finally` clears the button.
          Both actions RETURN their errors, so the branches below cover an
          expected failure — but a server action can also THROW: a missing
          table, a Postgres error raised rather than returned, a dropped
          connection. That rejection propagated out of an async function called
          as `void submit()`, which discards it. The result was a button that
          did nothing at all and a dialog with no message on it, which is how
          this was reported.

          A failure somebody cannot see is worse than a failure with an ugly
          message (§0.7). The raw text is shown rather than a paraphrase,
          because the paraphrase is what would have hidden this. -- */
    try {
      const created = await createWorkerCycle({
        name,
        periodLabel: period,
        selfDueOn: selfDue,
        supervisorDueOn: supervisorDue,
        // No longer collected — the field was removed at the owner's
        // instruction. The column is nullable and the action coerces "" to null.
        mdDueOn: "",
      });
      if (!created.ok) {
        setError(created.error.message);
        return;
      }

      const launched = await launchWorkerCycle(
        created.data.id,
        [...chosen].map((id) => ({
          workerId: id,
          supervisorId: raterOf[id] ?? workers.find((w) => w.id === id)?.supervisorId ?? null,
        })),
      );
      if (!launched.ok) {
        /* The cycle exists as a draft by now. Say so, rather than leaving
           somebody to wonder whether pressing the button again makes a second. */
        setError(`${launched.error.message} The round has been saved as a draft.`);
        return;
      }

      onOpenChange(false);

      /* -- Go TO the new round, rather than refreshing the old one.
            The board is a per-cycle route, so `router.refresh()` re-rendered
            whichever round was already on screen — the new one existed, nothing
            was broken, and it was nowhere to be seen. Reported as "I'm trying
            to add a new entry, it's not visible", which is exactly what it
            looked like.

            `refresh()` after the push so the round switcher picks up the new
            option too; the push alone would leave it listing yesterday's. -- */
      router.push(`/admin/worker-appraisals/${created.data.id}`);
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : "Something went wrong and the round was not started.",
      );
    } finally {
      setBusy(false);
    }
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
                placeholder="Production Q3"
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
            {/* -- "Final due" REMOVED, at the owner's instruction.
                  A production round is filled by the supervisor and reviewed by
                  HR; a third deadline was a date nobody worked to and a third
                  thing to fill in on a phone. `md_due_on` STAYS on the table —
                  it is nullable, and dropping a column nobody asked to drop is a
                  schema change (§0.2) — it is simply no longer collected. -- */}
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="font-sans text-body font-medium text-ink">Who is in it</p>
              <p className="tabular font-sans text-body-sm text-ink-muted">
                {chosen.size} of {eligible.length} chosen
              </p>
            </div>

            {raters.length === 0 ? (
              /* -- A dropdown reading "Nobody chosen" and nothing else states a
                    problem in the one place that cannot explain it (§13.4). The
                    fix is named, and it is a role grant rather than a
                    designation — "Supervisor" typed into a job title looks
                    identical on the users list and does nothing here. -- */
              <p className="rounded-control bg-warning-tint px-4 py-3 text-body-sm text-ink">
                <span className="font-medium">Nobody holds the Supervisor access level yet.</span>{" "}
                A worker is rated by their supervisor, so somebody has to hold it before a round can
                start. Set it in Settings, Users — tick <span className="font-medium">Supervisor</span>{" "}
                under Access. A job title reading &ldquo;Supervisor&rdquo; is not the same thing.
              </p>
            ) : eligible.length === 0 ? (
              <p className="rounded-control bg-warning-tint px-4 py-3 text-body-sm text-ink">
                Nobody is on the Production Team yet. Set somebody&rsquo;s form to{" "}
                <span className="font-medium">Production Team</span> in Settings, Users.
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
                  <span className="font-sans text-body-sm text-ink">Everyone on the Production Team</span>
                </label>

                <ul className="max-h-64 overflow-y-auto">
                  {eligible.map((w) => {
                    /* A default seeded from Reports-to only counts if that
                       person is actually on the supervisor list — otherwise the
                       select would show a blank with a value behind it. */
                    const seeded = raterFor(w);
                    const raterId = raters.some((r) => r.id === seeded) ? seeded : "";
                    const included = chosen.has(w.id);

                    return (
                      <li
                        key={w.id}
                        className="flex flex-wrap items-center gap-3 border-b border-rule px-4 py-2.5 last:border-b-0"
                      >
                        <Checkbox
                          checked={included}
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

                        <span className="min-w-0 flex-1 font-sans text-body-sm text-ink">
                          {w.name}
                        </span>

                        {/* -- The rater, on the row, as a control.
                              This was a line of text reading whatever the
                              profile's Reports-to happened to say. Showing it
                              was not enough: somebody has to be able to fix it
                              at the moment they notice it is wrong. -- */}
                        <label className="flex items-center gap-2">
                          <span className="font-sans text-body-sm text-ink-muted">Rated by</span>
                          <select
                            value={raterId}
                            onChange={(e) =>
                              setRaterOf((prev) => ({ ...prev, [w.id]: e.target.value }))
                            }
                            aria-label={`Who rates ${w.name}`}
                            className="min-h-11 min-w-40 rounded-input border border-rule bg-surface px-2 font-sans text-body-sm text-ink"
                          >
                            <option value="">Nobody chosen</option>
                            {raters.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.designation ? `${r.name} · ${r.designation}` : r.name}
                              </option>
                            ))}
                          </select>
                        </label>

                        {included && !raterId ? (
                          <span className="w-full font-sans text-body-sm text-critical">
                            Choose who rates {w.name} before starting.
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {false ? (
              <p className="mt-2 font-sans text-body-sm text-ink-muted">
                {workers.length - eligible.length} not listed, because there is no supervisor on
                their profile.
              </p>
            ) : null}
          </div>

        </div>

        {/* -- Above the footer, not at the bottom of the scroll region.
              A message inside the scroller can be below the fold on a short
              dialog, so the button appears to have done nothing — which is the
              exact symptom this was reported as. -- */}
        {error ? (
          <p
            role="alert"
            className="shrink-0 border-t border-critical/30 bg-critical-tint px-6 py-3 font-sans text-body-sm text-critical"
          >
            {error}
          </p>
        ) : null}

        <DialogFooter className="shrink-0 border-t border-rule px-6 py-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="min-h-11">
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={busy || chosen.size === 0 || [...chosen].some((id) => {
              const w = workers.find((x) => x.id === id);
              return !w || !raterFor(w);
            })}
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

/* ================================================== AddWorkersDialog ====== */

/**
 * Add somebody to a round that is already running.
 *
 * There was no way to do this: `launchWorkerCycle` refuses a non-DRAFT cycle,
 * so a worker who joined after a round opened — or whom HR simply missed — had
 * to wait for a whole new round, which is a different period and a different
 * sheet.
 *
 * Deliberately simpler than `StartRoundDialog`: no dates and no name, because
 * the round already has them, and the rater defaults to the worker's own
 * Reports-to. A latecomer is a correction to a roster, not a new exercise to
 * configure — and the server refuses anybody with no rater, by name, rather
 * than letting the choice be made badly here (PR-9).
 */
export function AddWorkersDialog({
  open,
  onOpenChange,
  cycleId,
  available,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cycleId: string;
  /** Workers NOT already in this round — computed by the board. */
  available: WorkerRow[];
}) {
  const router = useRouter();
  const [chosen, setChosen] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function toggle(id: string) {
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit() {
    setBusy(true);
    setError(null);
    const result = await addWorkersToRound(
      cycleId,
      [...chosen].map((id) => ({
        workerId: id,
        supervisorId: available.find((w) => w.id === id)?.supervisorId ?? null,
      })),
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setChosen(new Set());
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add workers to this round</DialogTitle>
          <DialogDescription>
            {/* §5's snapshot rule, said where the decision is made rather than
                left in the server's comments: they are appraised on the same
                frozen sheet as everybody already in this round, so the round
                stays one comparable exercise even if the form has been edited
                since it opened. */}
            They get the same sheet as everybody already in this round, and are
            rated by whoever they report to.
          </DialogDescription>
        </DialogHeader>

        {available.length === 0 ? (
          <p className="py-6 text-center font-sans text-body-sm text-ink-muted">
            Everybody on the Production Team is already in this round.
          </p>
        ) : (
          <ul className="max-h-[50vh] space-y-1 overflow-y-auto py-1">
            {available.map((w) => (
              <li key={w.id}>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-control px-2 py-2 hover:bg-surface-mute">
                  <Checkbox checked={chosen.has(w.id)} onCheckedChange={() => toggle(w.id)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-sans text-body text-ink">
                      {w.name}
                      {w.employeeCode ? (
                        <span className="tabular ml-2 text-body-sm text-ink-muted">
                          {w.employeeCode}
                        </span>
                      ) : null}
                    </span>
                    {/* Named, and flagged when absent — the server refuses
                        somebody with no rater, so saying so here saves a
                        refusal somebody has to interpret (§13.4). */}
                    <span
                      className={cn(
                        "block truncate font-sans text-body-sm",
                        w.supervisorName ? "text-ink-muted" : "text-critical",
                      )}
                    >
                      {w.supervisorName
                        ? `Rated by ${w.supervisorName}`
                        : "Nobody is set to rate them — set their Reports-to first"}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}

        {error ? (
          <p role="alert" className="font-sans text-body-sm text-critical">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="min-h-11">
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={busy || chosen.size === 0}
            className="min-h-11"
          >
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Add {chosen.size > 0 ? chosen.size : ""}{" "}
            {chosen.size === 1 ? "worker" : "workers"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============================================ bin · restore · destroy ===== */

/**
 * Confirm before binning.
 *
 * It says what binning does and what it does NOT do, because the word "delete"
 * on the button that opened this dialog is the thing somebody is afraid of.
 */
function BinRoundDialog({
  cycle,
  onClose,
}: {
  cycle: WorkerCycleRow | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (!cycle) return null;

  async function bin() {
    if (!cycle) return;
    setBusy(true);
    setError(null);
    const result = await moveWorkerRoundToBin(cycle.id);
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move {cycle.name} to the recycle bin?</DialogTitle>
          <DialogDescription>
            It disappears from this list, from the Production Team screens and from every
            supervisor&rsquo;s screen. Nothing inside it is deleted, and it can be
            restored from the recycle bin below.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <p role="alert" className="font-sans text-body-sm text-critical">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="min-h-11">
            Cancel
          </Button>
          <Button onClick={() => void bin()} disabled={busy} className="min-h-11">
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Move to recycle bin
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Restore, or destroy for good.
 *
 * The second is offered without a confirmation dialog of its own because the
 * SERVER refuses it for anything that was ever launched — the only rounds it
 * can touch are drafts that were never opened to anybody, and it is already
 * the second deliberate act after binning. Where it refuses, the reason is
 * shown in full rather than paraphrased: it explains that the round holds the
 * frozen sheet and the ticks of everyone in it (§5), which is the answer to
 * "why can I not delete this".
 */
function BinnedRoundActions({ cycle }: { cycle: WorkerCycleRow }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<null | "restore" | "destroy">(null);
  const [error, setError] = React.useState<string | null>(null);

  async function run(which: "restore" | "destroy") {
    setBusy(which);
    setError(null);
    const result =
      which === "restore"
        ? await restoreWorkerRound(cycle.id)
        : await deleteWorkerRoundForever(cycle.id);
    setBusy(null);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex min-w-0 flex-col items-end gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          onClick={() => void run("restore")}
          disabled={busy !== null}
          className="min-h-11"
        >
          {busy === "restore" ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <RotateCcw className="size-4" aria-hidden />
          )}
          Restore
        </Button>
        <Button
          variant="ghost"
          onClick={() => void run("destroy")}
          disabled={busy !== null}
          className="min-h-11 text-critical hover:text-critical"
        >
          {busy === "destroy" ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Trash2 className="size-4" aria-hidden />
          )}
          Delete for good
        </Button>
      </div>

      {error ? (
        <p role="alert" className="max-w-prose text-right font-sans text-body-sm text-critical">
          {error}
        </p>
      ) : null}
    </div>
  );
}
