"use client";

/** The dialogs a production round needs: start it, add to it, bin it. */

import * as React from "react";
import { useRouter } from "next/navigation";
import { HardHat, Loader2 } from "lucide-react";

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
import { isIncrementDue } from "@/lib/utils/increment-due";
import {
  addWorkersToRound,
  createWorkerCycle,
  launchWorkerCycle,
  moveWorkerRoundToBin,
} from "@/lib/worker/cycle-actions";
import { cn } from "@/lib/utils";

export type WorkerRow = {
  id: string;
  name: string;
  employeeCode: string | null;
  /** Their `reports_to`. The DEFAULT rater, not the only possible one. */
  supervisorId: string | null;
  supervisorName: string | null;
  /**
   * `employment_records.next_increment_date`, so the dialog can tick the people
   * an increment is owed to when it is opened from the calendar.
   *
   * Null where no employment record exists — which is not "not due", it is "we
   * do not know", and the two must not be conflated (§11's missing-is-not-zero,
   * applied to a date).
   */
  nextIncrementOn?: string | null;
};

/** A week out, ISO. The round's reminder deadline, derived rather than typed. */
function inAWeek(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

/** "August 2026" — §0.10's timezone, so a late-evening press names today's month. */
function thisMonthLabel(): string {
  return new Date().toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

export type RaterRow = {
  id: string;
  name: string;
  designation: string | null;
};

/* -- THE ROUNDS LIST WAS HERE, and it is gone at the owner's instruction.

      It rendered a card per round — "test · august · Running" above "test · Aug
      · Running", because rounds are free to share a name — and stood between the
      menu item and the work. FIX-40 redirected past it when there was only one
      round, which was a patch on the same complaint; what was asked for is that
      there is no list at all. `/admin/worker-appraisals` renders the full table
      of every appraisal in every round now, with the round as a column.

      DELETED rather than left unused: an orphaned component sitting where the
      next person reaches for it is the landmine P22 had to remove a template
      for. The dialogs below are still live and are what this file is now for.

      The recycle-bin line it carried is not lost — binning, restoring and
      deleting a round live in Settings › Recycle bin (FIX-32). -- */

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
  preselect,
  preselectIds,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workers: WorkerRow[];
  raters: RaterRow[];
  /**
   * "increment-due" arrives from the increment calendar's "Start for Production
   * team" button: the name and period are filled in and everybody an increment
   * is owed to is ticked, so HR reviews and starts.
   *
   * WHAT to tick, never who — the list is resolved here from the same rule the
   * button counts by, so the URL carries a word rather than a page of uuids
   * (PR-8), and the two cannot report different people.
   */
  preselect?: "increment-due" | "these-people";
  /**
   * Exactly who arrives ticked, when the caller names them.
   *
   * "Start increment" on one row of the increment calendar. That button used to
   * send EVERY worker to the staff wizard — the office 0–5 form, for somebody
   * appraised on a tick sheet by their supervisor (§7). One person is this same
   * round with one tick, which is why it is a list rather than a third mode.
   */
  preselectIds?: string[];
}) {
  const router = useRouter();

  /* -- KEYED TO THE DIALOG'S OWN INITIAL STATE, not synced by an effect.
        A `useState` initialiser reads `preselect` on the mount that opens the
        dialog, and the board mounts it fresh (`open` gates the render), so
        there is nothing to keep in step afterwards. An effect copying props
        into state is the cascading-render shape the compiler rejects — and it
        would also fight HR the moment they unticked somebody. -- */
  const dueNow = React.useMemo(() => {
    /* A named list wins over the rule: it is the caller saying exactly who.
       "Start increment" on one calendar row sends one id — and a worker paid
       early is precisely why that button exists, so the due rule must not be
       allowed to overrule it. */
    if (preselect === "these-people") {
      const wanted = new Set(preselectIds ?? []);
      return workers.filter((w) => wanted.has(w.id));
    }
    if (preselect === "increment-due") {
      return workers.filter((w) => isIncrementDue(w.nextIncrementOn ?? null));
    }
    return [];
  }, [preselect, preselectIds, workers]);

  /* -- ALWAYS PREFILLED, whichever way in.
        "Appraisal · August 2026", at the owner's instruction, and unconditional
        for the reason they gave about the staff wizard: "doesn't matter [if] we
        are starting evaluation round or increment round and from which screen
        redirecting — cycle name and period label always should be pre filled."
        It was tied to `preselect`, so pressing "Start a round" on the board got
        two empty fields and two placeholders in a different format again.
        `preselect` now decides only who is TICKED, which is all it was ever
        about. The middle dot is the separator every other generated name in the
        product uses. -- */
  const [name, setName] = React.useState(() => `Appraisal · ${thisMonthLabel()}`);
  const [period, setPeriod] = React.useState(() => thisMonthLabel());
  const [chosen, setChosen] = React.useState<Set<string>>(() => new Set(dueNow.map((w) => w.id)));

  /* -- Who rates each worker, seeded from their Reports-to and CHANGEABLE here.
        Inheriting it silently is what put "Rated by test MD" on a shop-floor
        worker: the field was set once on a profile, for a different purpose,
        and nothing since had asked whether it was right for this. A default is
        fine; a default nobody can see or override is not. -- */
  const [raterOf, setRaterOf] = React.useState<Record<string, string>>({});
  const raterFor = (w: WorkerRow) => raterOf[w.id] ?? w.supervisorId ?? "";
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  /* Everybody is listed. A worker with no Reports-to is not excluded — they
     simply start with no rater chosen, which is a thing HR can fix here instead
     of being told to go and edit a profile. */
  /* -- TICKED FIRST, and the order is FROZEN at open.
        The list is alphabetical, so five ticked people out of twenty-eight were
        scattered down a scrolling box and the first screenful was four unticked
        names — HR could not see what they were being asked to review without
        scrolling the whole list.

        Frozen rather than live: sorting on the CURRENT ticks would make a row
        jump to the bottom the instant it was unticked, moving the next row up
        under the pointer. That turns one deliberate untick into an accidental
        second one. The `useMemo` depends on `dueNow`, which is computed from
        props, so nothing HR does afterwards re-orders it. -- */
  const eligible = React.useMemo(() => {
    if (dueNow.length === 0) return workers;
    const first = new Set(dueNow.map((w) => w.id));
    return [...workers.filter((w) => first.has(w.id)), ...workers.filter((w) => !first.has(w.id))];
  }, [workers, dueNow]);
  const allChosen = eligible.length > 0 && chosen.size === eligible.length;

  /* -- SEARCH, at the owner's instruction. Twenty-eight people in a 320px box
        is four visible rows and a lot of scrolling to find one name.

        IT IS A VIEW, NEVER THE SELECTION. `shown` is a separate list from
        `eligible`, and every tick still writes to `chosen` by id — so filtering
        cannot silently drop somebody who was already ticked, and clearing the
        box brings them back still ticked. The count above the list keeps
        reporting against `eligible`, not against the filtered view, because "1
        of 28 chosen" is the fact HR is deciding on; "1 of 3 chosen" while a
        filter is on would be a different and misleading sentence.

        The same distinction P31-4 had to draw in the form builder, where a
        filtered list handed to a reorder moved a row to its index among the
        MATCHES rather than among its neighbours. -- */
  const [query, setQuery] = React.useState("");
  const shown = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return eligible;
    return eligible.filter((w) => w.name.toLowerCase().includes(q));
  }, [eligible, query]);

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
        /* Workers do not rate themselves in this module (WORKER-1), so there is
           no self stage to give a deadline to. Left null rather than filled in
           with a date nothing works towards. */
        selfDueOn: "",
        supervisorDueOn: inAWeek(),
        // Removed earlier, same instruction. Nullable; the action coerces "".
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
      <DialogContent
        tabIndex={-1}
        /* -- DO NOT AUTOFOCUS A PREFILLED NAME.
              Radix focuses the first focusable child on open and SELECTS its
              text when it is an input — which is helpful on an empty field and
              destructive on a correct one: the name arrives right, highlighted,
              and the next keystroke replaces it. Reported as "why is Production
              increment · August 2026 selected".
              Focus moves to the dialog itself instead, so the trap and the
              announcement are unaffected — Escape, Tab and the screen-reader
              title all behave as before. Only when there IS something to
              protect; an empty round still opens with the cursor in Name. -- */
        onOpenAutoFocus={(event) => {
          if (!name) return;
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)?.focus();
        }}
        className="flex max-h-[92vh] w-[min(96vw,720px)] max-w-none flex-col gap-0 overflow-hidden p-0"
      >
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
          {/* -- The placeholders are gone with the empty fields.
                "Production Q3" and "Oct-Dec 25" showed a convention neither
                field is ever filled with now, so the only time they could
                appear is after somebody clears one — where they would suggest
                the wrong format. The staff wizard dropped its own for the same
                reason. -- */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="wc_name">Name</Label>
              <Input
                id="wc_name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="min-h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wc_period">Period</Label>
              <Input
                id="wc_period"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                className="min-h-11"
              />
            </div>
          </div>

          {/* -- ALL THREE DATE FIELDS ARE GONE.
                "Final due" went first, at the owner's instruction — a
                production round is filled by the supervisor and reviewed by HR,
                so a third deadline was a date nobody worked to. "Worker due"
                and "Supervisor due" now follow, on the same instruction and for
                a sharper reason: workers do not rate themselves at all in this
                module, so "Worker due" was a deadline for something that never
                happens, and the remaining one was a date HR typed the same way
                every time.

                The round opens today and runs a week — P36's rule for the staff
                cycle, applied here so the two behave alike. It is a REMINDER
                schedule and not a lock: nothing in §8's worker table reads a due
                date, so a sheet does not close when the week is up.

                All three COLUMNS stay. They are nullable, and dropping one
                nobody asked to drop is a schema change (§0.2). -- */}

          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="font-sans text-body font-medium text-ink">Who is in it</p>
              <p className="tabular font-sans text-body-sm text-ink-muted">
                {chosen.size} of {eligible.length} chosen
              </p>
            </div>

            {/* -- WHY some people arrive ticked.
                  A pre-ticked list with no explanation is a decision the app
                  made that HR is presumed to have agreed with. Naming the rule
                  turns it into one they can check.
                  Everybody is listed either way, so adding somebody the
                  calendar did not catch is a tick rather than a trip back — the
                  "add" the staff roster needed a button for is already the list
                  below, and here that is true rather than a claim, because
                  nothing filters it. -- */}
            {preselect ? (
              <p className="mb-2 rounded-control border border-rule bg-surface-mute px-3 py-2 text-body-sm text-ink-muted">
                {preselect === "these-people"
                  ? dueNow.length === 0
                    ? "That person is not on the production team, so they are not listed here. Tick whoever you meant."
                    : `${dueNow[0]?.name ?? "One person"} is ticked because you started an increment for them. Everybody on the production team is listed, so add anyone else here rather than opening a second round.`
                  : dueNow.length === 0
                    ? "Nobody on the production team has an increment due this month or next. Tick anyone you want to appraise anyway."
                    : `${dueNow.length} ${dueNow.length === 1 ? "person is" : "people are"} ticked because their increment is due — this month, next month, or already overdue. Everybody on the production team is listed, so tick anyone else you want to add, or untick somebody.`}
              </p>
            ) : null}

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
                {/* -- The search sits INSIDE the box, above the toggle, so it
                      reads as belonging to this list rather than to the dialog.
                      `min-h-11` because §13.8 is about fingers. -- */}
                <div className="border-b border-rule bg-surface-mute px-3 py-2">
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search by name"
                    aria-label="Search the production team by name"
                    className="min-h-11 bg-surface"
                  />
                </div>

                {/* -- WHILE FILTERED, THIS TOGGLES WHAT YOU CAN SEE.
                      A select-all reaching past the filter is the classic way a
                      bulk action takes somebody nobody intended — F5-5 drew the
                      same line on the question bank. The label says which it is,
                      so the control cannot be misread. -- */}
                <label className="flex items-center gap-3 border-b border-rule bg-surface-mute px-4 py-2.5">
                  <Checkbox
                    checked={
                      shown.length === 0
                        ? false
                        : shown.every((w) => chosen.has(w.id))
                          ? true
                          : shown.some((w) => chosen.has(w.id))
                            ? "indeterminate"
                            : false
                    }
                    onCheckedChange={() =>
                      setChosen((prev) => {
                        const next = new Set(prev);
                        const allShownChosen = shown.length > 0 && shown.every((w) => next.has(w.id));
                        for (const w of shown) {
                          if (allShownChosen) next.delete(w.id);
                          else next.add(w.id);
                        }
                        return next;
                      })
                    }
                    aria-label={
                      query.trim() === ""
                        ? allChosen
                          ? "Clear everyone"
                          : "Choose everyone"
                        : `Choose all ${shown.length} shown`
                    }
                  />
                  <span className="font-sans text-body-sm text-ink">
                    {query.trim() === ""
                      ? "Everyone on the Production Team"
                      : `All ${shown.length} shown`}
                  </span>
                </label>

                {/* 320px rather than 256px: five rows is the common preselected
                    round, and a box that cuts the fifth in half reads as though
                    something is missing. Still bounded, so twenty-eight people
                    do not push the footer off a laptop screen. */}
                <ul className="max-h-80 overflow-y-auto">
                  {shown.length === 0 ? (
                    /* §13.4: a list that empties without saying why reads as
                       broken. It also says the ticks survive, because the box
                       looking empty is exactly when somebody fears otherwise. */
                    <li className="px-4 py-6 text-center font-sans text-body-sm text-ink-muted">
                      Nobody on the production team matches &ldquo;{query.trim()}&rdquo;.
                      <br />
                      Clear the search to see everyone — anybody already ticked stays ticked.
                    </li>
                  ) : null}
                  {shown.map((w) => {
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

                        {/* -- WHY there is no default, per row.
                              The global case — nobody holds Supervisor at all —
                              is explained above. This is the other one: the
                              worker's Reports-to is set to somebody who does not
                              hold the access level, so the seeded value was
                              dropped and the select fell back to blank. Without
                              this the row says "Nobody chosen" and nothing else,
                              which is the dead end §13.4 forbids — and the fix
                              is a role grant, not a different pick here. -- */}
                        {!raterId && w.supervisorId && !raters.some((r) => r.id === w.supervisorId) ? (
                          <span className="w-full font-sans text-body-sm text-ink-muted">
                            {w.supervisorName ?? "Their manager"} is their Reports-to but does not hold
                            the Supervisor access level, so they are not offered here. Grant it in
                            Settings, Users — or pick somebody else.
                          </span>
                        ) : !raterId && !w.supervisorId ? (
                          <span className="w-full font-sans text-body-sm text-ink-muted">
                            No Reports-to is set for {w.name}, so there is nobody to default to.
                          </span>
                        ) : null}

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
            {/* -- "Start for Production team", at the owner's instruction, so it
                  reads back the button that opened it. The count stays: this is
                  the last press before real sheets go live for real people, and
                  how many is the one thing worth confirming (§13.3). -- */}
            Start for Production team ({chosen.size})
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
 * EXPORTED NOW. It used to be rendered by the rounds list, and deleting that
 * list would have taken with it the only way to bin a round at all — Settings ›
 * Recycle bin lists what is already binned and restores it, but nothing there
 * puts a round in. The round's own board renders this instead, which is the
 * better home anyway: you are looking at the round you are binning.
 *
 * It says what binning does and what it does NOT do, because the word "delete"
 * on the button that opened this dialog is the thing somebody is afraid of.
 */
export function BinRoundDialog({
  cycle,
  onClose,
}: {
  /* It reads the id and the name and nothing else, so it asks for those. The
     six-field row type it used to take was inherited from the list that
     rendered it, and asking a caller for four fields you never read is how a
     component ends up impossible to reuse. */
  cycle: { id: string; name: string } | null;
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

