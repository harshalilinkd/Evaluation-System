"use client";

/** The four-step cycle wizard. P10 screen 2 — one page, stepper at the top. */

import * as React from "react";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";
import { Loader2, Rocket } from "lucide-react";

import { AutosaveIndicator } from "@/components/appraise/autosave-indicator";
import { BackLink } from "@/components/appraise/back-link";
import { StepRail } from "@/components/appraise/progress-rail";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  createCycle,
  launchCycle,
  setCycleParticipants,
  updateCycle,
  validateCycleForLaunch,
} from "@/lib/cycles/actions";
import type { InviteRecipients } from "@/lib/cycles/dispatch-launch";
import type { SelectablePerson } from "@/lib/cycles/queries";
import {
  CYCLE_KIND_CHOICES,
  CYCLE_TYPE_CHOICES,
  INCREMENT_KIND_CHOICES,
  DISCLOSURE_CHOICES,
  defaultDisclosureFor,
  describeLaunchBlock,
  plural,
  type ReadinessReport,
} from "@/lib/cycles/schema";
import { LaunchDialog } from "@/app/(app)/admin/cycles/new/launch-dialog";
import { StepPeople, isIncrementDue, type PersonState } from "@/app/(app)/admin/cycles/new/step-people";
import { StepReview } from "@/app/(app)/admin/cycles/new/step-review";

/* -- THREE STEPS. THE DATES STEP IS GONE, at the owner's instruction.
      "Remove the dates step entirely. Don't ask HR for start/end dates."

      A cycle now opens the day it is launched and runs for a week. Every screen
      that asked for a date asked for the same three answers every time, and the
      third — the manager's — was only ever the second plus a few days.

      WHAT THE WEEK IS AND IS NOT. It is a REMINDER schedule, not a deadline that
      locks anything: §8 locks a layer when it is SUBMITTED and on no other
      condition, and no guard anywhere reads a due date. So a form left open past
      Friday stays open and simply starts being chased — which is what the owner
      asked for in the same sentence, and was already true. -- */
const STEPS = ["Basics", "People", "Review"] as const;

/** How long a cycle runs. One week, for everybody, from the day it launches. */
const CYCLE_DAYS = 7;

function isoDaysFromToday(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * "August 2026" — the month a round is being run in.
 *
 * `en-IN` and Asia/Kolkata, per §0.10: a cycle started at 9pm in Mumbai must
 * not be labelled with yesterday's month because the server keeps UTC.
 */
function thisMonthLabel(): string {
  return new Date().toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

export type WizardInitial = {
  id: string;
  name: string;
  periodLabel: string;
  varianceThreshold: number;
  disclosure: string;
  cycleType: "EVALUATION" | "INCREMENT";
  cycleKind: "BATCH" | "ROLLING";
  defaultSelfDays: number;
  defaultLeadDays: number;
  /** Item 4: the type is LOCKED once launched. */
  isLaunched: boolean;
  startsOn: string | null;
  selfDueOn: string | null;
  leadDueOn: string | null;
  mdDueOn: string | null;
  /** Existing roster, when editing a draft. */
  participants: Array<{ profileId: string; leadId: string | null }>;
};

/* ---------- Where somebody had got to ---------- */

/**
 * The step a draft was last left on, per cycle.
 *
 * IN THE BROWSER, NOT THE DATABASE. It is where one person had got to in a
 * form, not a property of the cycle — two administrators editing the same draft
 * should each come back to their own place, and §0.4 wants a reason before a
 * column exists. `localStorage` rather than `sessionStorage` because "carry on
 * where I left off" has to survive closing the tab, which is the whole point;
 * nothing here is anybody's appraisal, so F4-1's reasoning does not apply.
 *
 * Every access is wrapped: storage throws rather than returning null in more
 * cases than is comfortable — Safari private browsing, a full quota, an
 * embedded webview — and a wizard that will not open because it could not read
 * a convenience is worse than one that forgets.
 */
const STEP_KEY = "appraise.cycle-step.";

function rememberStep(cycleId: string | null, step: number): void {
  if (!cycleId) return;
  try {
    window.localStorage.setItem(STEP_KEY + cycleId, String(step));
  } catch {
    /* Not being able to remember is not a failure worth reporting. */
  }
}

/**
 * Nothing else writes this key, so there is nothing to subscribe to.
 *
 * `useSyncExternalStore` still wants a subscribe function; returning a no-op
 * unsubscribe is the documented way to say "this value does not change while
 * the component is mounted". It is read once at mount and written by `goTo`,
 * which already sets the step it is recording.
 */
function noStorageEvents(): () => void {
  return () => {};
}

function rememberedStep(cycleId: string | null): number | null {
  if (!cycleId) return null;
  try {
    const raw = window.localStorage.getItem(STEP_KEY + cycleId);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export function WizardClient({
  people,
  jobSkillCounts,
  initial,
  initialStep,
  presetCycleType,
  preselect,
  evaluationDueIds,
}: {
  people: SelectablePerson[];
  jobSkillCounts: Record<string, number>;
  initial: WizardInitial | null;
  /** Which step to open on. Used by "Review and launch" on the cycle board. */
  initialStep?: number;
  /** A NEW cycle that already knows its type, from a link. Never used in edit mode. */
  presetCycleType?: "EVALUATION" | "INCREMENT";
  /**
   * A whole round, arriving from the increment calendar.
   *
   * The wizard works out WHO from the same rule the calendar counts by, rather
   * than being handed a list of ids: a URL carrying fifty uuids breaks at the
   * browser length limit and cannot be typed, bookmarked or reasoned about.
   */
  preselect?: "increment-due" | "evaluation-due";
  /**
   * Whose evaluation is due, resolved on the SERVER from the same pending items
   * the Evaluation Due screen lists — so its count and these ticks cannot
   * describe different sets. Only sent for an evaluation round.
   */
  evaluationDueIds?: string[];
}) {
  const router = useRouter();

  // Item 4: once a cycle is launched its type is frozen, because the question
  // set was frozen with it (§5). Rendered read-only WITH the reason, never as a
  // silent disabled control.
  const locked = initial?.isLaunched ?? false;

  /* -- `initialStep` exists so the board's "Review and launch" lands where it
        says it will. Without it that link opened step one and left somebody to
        press Next three times through a form they had already filled in — a
        link that does not do what its label promises.

        Clamped, because it arrives from a query string. Only a DRAFT reaches
        this screen (the edit route redirects anything else), so the worst a bad
        value can do is open the wrong step of a form. -- */
  const [step, setStep] = React.useState(() => {
    // `?step=abc` gives NaN, and NaN survives both Math.max and Math.min — the
    // wizard would then render no step at all. Checked before it is clamped.
    if (initialStep === undefined || !Number.isFinite(initialStep)) return 0;
    return Math.min(Math.max(initialStep, 0), STEPS.length - 1);
  });
  const [furthest, setFurthest] = React.useState(initial ? STEPS.length - 1 : 0);

  /* -- Which list step 3 opens on.
        UI state, not a column: it is a default filter, and both increment
        options store the same `cycle_kind`. Persisting it would be storing a
        thing the launch does not read (§0.4 — no schema without a reason). -- */
  const [peoplePreset, setPeoplePreset] = React.useState<"due" | "all">(
    /* An increment cycle opens on the due list, matching what is ticked. A
       filter showing fifty-two people while five are selected reads as a bug. */
    (presetCycleType ?? "EVALUATION") === "INCREMENT" ? "due" : "all",
  );

  // Null until the draft is first saved. Everything after step 1 needs a cycle
  // row to attach to, which is why saving happens on leaving step 1 rather than
  // at the end: a wizard that loses 40 ticked checkboxes because the tab was
  // closed is a wizard people stop using.
  const [cycleId, setCycleId] = React.useState<string | null>(initial?.id ?? null);

  const [basics, setBasics] = React.useState({
    /* -- PREFILLED FOR A ROUND, at the owner's instruction: "the system then
          prefills the Cycle name and Period label automatically."

          "Increment round · August 2026" and "August 2026" — the month it is
          being run in, which is the one thing that distinguishes one round from
          the next. Both fields stay editable and are still required, so nothing
          is decided that HR cannot see; what is removed is typing the same two
          strings every month.

          Only when a round is being started from the calendar. A cycle created
          from scratch still opens blank, because there is nothing to guess. -- */
    name:
      initial?.name ??
      (preselect === "increment-due"
        ? `Increment round · ${thisMonthLabel()}`
        : preselect === "evaluation-due"
          ? `Evaluation round · ${thisMonthLabel()}`
          : ""),
    period_label: initial?.periodLabel ?? (preselect ? thisMonthLabel() : ""),
    variance_threshold: String(initial?.varianceThreshold ?? 2),
    disclosure: initial?.disclosure ?? "SCORE_ONLY",
    /* -- `presetCycleType` is for a NEW cycle arriving from a link that already
          knows what it is — "Start increment" on the increment calendar. It is
          only a starting value: the picker is right there and unchanged, so
          nothing is decided that HR cannot see and change.

          `initial` still wins, because that is edit mode reading a stored
          cycle, and a query string must never override what is saved. -- */
    cycle_type: initial?.cycleType ?? presetCycleType ?? "EVALUATION",
    cycle_kind: initial?.cycleKind ?? "BATCH",
    default_self_days: String(initial?.defaultSelfDays ?? 14),
    default_lead_days: String(initial?.defaultLeadDays ?? 21),
  });

  /* -- DERIVED, not asked for. Opens today, everything due in a week.
        An existing draft keeps whatever it was saved with, so reopening one
        made before this change does not silently move its dates — and a draft
        that has none gets the week the moment it is saved. -- */
  const dates = React.useMemo(
    () => ({
      starts_on: initial?.startsOn || isoDaysFromToday(0),
      self_due_on: initial?.selfDueOn || isoDaysFromToday(CYCLE_DAYS),
      lead_due_on: initial?.leadDueOn || isoDaysFromToday(CYCLE_DAYS),
      /* §8 keeps the MD's own date after the manager's, and a CHECK enforces
         self ≤ lead ≤ md. Same day is allowed and is what "one week" means. */
      md_due_on: initial?.mdDueOn || isoDaysFromToday(CYCLE_DAYS),
    }),
    [initial?.startsOn, initial?.selfDueOn, initial?.leadDueOn, initial?.mdDueOn],
  );

  const [state, setState] = React.useState<Record<string, PersonState>>(() => {
    const out: Record<string, PersonState> = {};
    const existing = new Map((initial?.participants ?? []).map((p) => [p.profileId, p.leadId]));
    for (const person of people) {
      /* -- AN INCREMENT CYCLE STARTS WITH THE PEOPLE WHO ARE DUE, not with
            everybody, at the owner's instruction: "do not pre-load all
            employees … only pre-select employees whose increment is due in the
            next month or overdue."

            Ticking all fifty-two and asking HR to untick forty-seven is the
            work this screen exists to save, and the list of who is due is one
            the system already keeps. Anybody else is still one tick away — the
            full roster is right there, and the filter above it is a VIEW rather
            than a restriction.

            An EVALUATION cycle is unchanged: everybody, ticked (P10). -- */
      /* -- WHO STARTS TICKED.
            An EVALUATION ROUND from the due screen: the people whose review is
            due or already late, and nobody else.
            An INCREMENT cycle: the people whose increment is due.
            A cycle created from scratch: everybody — P10's default, and the
            right one when nothing else is known. -- */
      const startsIncluded =
        preselect === "evaluation-due"
          ? (evaluationDueIds ?? []).includes(person.id)
          : preselect === "increment-due" || (presetCycleType ?? "EVALUATION") === "INCREMENT"
            ? isIncrementDue(person.nextIncrementOn)
            : true;

      out[person.id] = initial
        ? { included: existing.has(person.id), leadId: existing.get(person.id) ?? person.reportsTo }
        : // P10: "Include (checkbox, default on)" and the lead defaults from
          // profiles.reports_to — the reporting line the company already keeps.
          { included: startsIncluded, leadId: person.reportsTo };
    }
    return out;
  });

  const [report, setReport] = React.useState<ReadinessReport | null>(null);
  const [acknowledged, setAcknowledged] = React.useState<Record<string, boolean>>({});

  const [saving, setSaving] = React.useState(false);
  const [savedAt, setSavedAt] = React.useState<Date | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [launching, setLaunching] = React.useState(false);
  const [launchError, setLaunchError] = React.useState<string | null>(null);
  /** Launched, but no invite could be sent. Not an error — see `onLaunch`. */
  const [launchNotice, setLaunchNotice] = React.useState<string | null>(null);
  /* -- Set once the launch has worked and the invites are away. The dialog
        holds on it rather than closing, so the confirmation lands where the
        button was pressed instead of as a banner on the next screen — which
        reads as the app having moved on rather than as the thing having
        worked. -- */
  const [launchSent, setLaunchSent] = React.useState<{ total: number; failed: number } | null>(null);
  /** Where "Open the cycle" goes, held so the dialog owns the navigation. */
  const [launchDestination, setLaunchDestination] = React.useState<string | null>(null);

  /* ---------- saving ---------- */

  // Held in a ref so the 20-second autosave timer always sees current values
  // without being torn down and rebuilt on every keystroke.
  //
  // Written in an effect, not during render: a ref mutated mid-render is state
  // the compiler cannot see, and it flags it. The one-render lag this
  // introduces is irrelevant here — the timer next fires seconds later, long
  // after the effect has run.
  const latest = React.useRef({ basics, dates, state, cycleId });
  React.useEffect(() => {
    latest.current = { basics, dates, state, cycleId };
  }, [basics, dates, state, cycleId]);

  /*
    THE CYCLE ID LIVES IN ITS OWN REF, WRITTEN SYNCHRONOUSLY.

    This is the duplicate-cycle bug. `latest` is written in an EFFECT, so it
    lags a render — and `save()` decided between createCycle and updateCycle by
    reading `latest.current.cycleId`. In the window between `setCycleId(newId)`
    and the effect that copies it into `latest`, a second save still saw null
    and created a SECOND cycle: same name, same period, one of them a draft
    nobody meant to make.

    Written the instant the server returns an id, so the next save cannot miss
    it however soon it starts.
  */
  const cycleIdRef = React.useRef<string | null>(initial?.id ?? null);

  /*
    ONE SAVE AT A TIME.

    The 20-second timer and every step change both call save(). Two of them
    starting before either finished is the same bug from the other direction —
    both read a null id, both create. Serialising means the second waits, then
    reads the id the first has already written.
  */
  const inFlight = React.useRef<Promise<string | null> | null>(null);

  const save = React.useCallback(async (): Promise<string | null> => {
    // Whatever is already running may be the call that creates the row.
    const running = inFlight.current;
    if (running) await running.catch(() => null);

    const run = (async (): Promise<string | null> => {
      const { basics: b, dates: d, state: s } = latest.current;
      const id = cycleIdRef.current;
      if (!b.name.trim() || !b.period_label.trim()) return id;

      setSaving(true);
      setError(null);

      const payload = {
        name: b.name,
        period_label: b.period_label,
        variance_threshold: Number(b.variance_threshold) || 2,
        disclosure: b.disclosure,
        cycle_type: b.cycle_type,
        cycle_kind: b.cycle_kind,
        default_self_days: b.default_self_days,
        default_lead_days: b.default_lead_days,
        starts_on: d.starts_on || undefined,
        self_due_on: d.self_due_on || undefined,
        lead_due_on: d.lead_due_on || undefined,
        /* Derived, never typed. The cycle's last deadline is the lead's
           review; the MD's step follows whenever HR sends it on. */
        md_due_on: d.md_due_on || d.lead_due_on || undefined,
      };

      let workingId = id;
      const result = workingId ? await updateCycle(workingId, payload) : await createCycle(payload);

      if (!result.ok) {
        // NO_CHANGE is the autosave finding nothing to do, which is not an
        // error worth showing somebody mid-sentence.
        if (result.error.code !== "NO_CHANGE") setError(result.error.message);
        setSaving(false);
        return workingId;
      }

      workingId = result.data.id;
      // Synchronously, BEFORE the await below. Everything after this point can
      // yield, and the next save must find the id whenever it looks.
      cycleIdRef.current = workingId;
      if (workingId !== id) setCycleId(workingId);

      const rows = Object.entries(s).map(([profileId, row]) => ({
        profileId,
        leadId: row.leadId,
        included: row.included,
      }));

      const participants = await setCycleParticipants(workingId, rows);
      if (!participants.ok) setError(participants.error.message);

      setSaving(false);
      setSavedAt(new Date());
      return workingId;
    })();

    inFlight.current = run;
    try {
      return await run;
    } finally {
      // Only clear if nothing newer has taken the slot.
      if (inFlight.current === run) inFlight.current = null;
    }
  }, []);

  // §13.6: "Autosave visible: 'Saved HH:MM', never lose a half-filled form."
  React.useEffect(() => {
    const timer = setInterval(() => {
      void save();
    }, 20_000);
    return () => clearInterval(timer);
  }, [save]);

  /* ---------- readiness ---------- */

  const refreshReport = React.useCallback(async (id: string) => {
    const result = await validateCycleForLaunch(id);
    setReport(result.ok ? result.data : null);
    if (!result.ok) setError(result.error.message);
  }, []);

  /* -- THE CHECK ALSO RUNS ON ARRIVAL, not only on navigation.
        `refreshReport` was reachable from `goTo` alone, so a wizard that OPENED
        on the last step never ran it — and that is exactly what the board's
        "Review and launch" does, with `?step=4`. The report stayed null for
        ever: "Checking readiness…" on screen and Launch disabled reading
        "Readiness has not been checked yet."

        So the one action a DRAFT cycle offers led to a screen that could not
        launch it. Reported as "when I try to launch draft cycle again it's
        opening like this".

        ONCE PER MOUNT, guarded by a ref. A failed check sets the report back to
        null — deliberately, so the screen never shows a stale verdict — and
        without the guard this would retry in a loop against a server that has
        just said no. -- */
  const checkedOnArrival = React.useRef(false);
  React.useEffect(() => {
    if (checkedOnArrival.current) return;
    if (step !== STEPS.length - 1 || !cycleId) return;
    checkedOnArrival.current = true;
    /* -- DEFERRED BY A TIMEOUT, F4-7's device. `refreshReport` only sets state
          after an await, so nothing here is synchronous — but the compiler
          cannot see through the async boundary and flags the call. A timeout
          makes it provable rather than argued, and costs one frame on a screen
          that is about to make a network round trip anyway. -- */
    const timer = setTimeout(() => {
      void refreshReport(cycleId);
    }, 0);
    return () => clearTimeout(timer);
  }, [step, cycleId, refreshReport]);

  /* -- RESUME WHERE THEY LEFT OFF, when the URL does not say otherwise.
        A draft saved on step 2 and reopened started at Basics again, so
        somebody walked forward through a form they had already filled in — the
        exact complaint `initialStep` was added to fix for ONE link, and left
        everywhere else.

        `initialStep` still wins: "Review and launch" says where it goes and
        must go there. This only fills the gap when nothing was asked for.

        READ THROUGH `useSyncExternalStore` AND APPLIED DURING RENDER, which is
        the shape this codebase settled on for browser state (UI2-11, PC-7,
        F4-5). The obvious version — read localStorage in an effect and call
        setStep — is the cascading-render pattern the compiler rejects, and it
        also paints step 1 for a frame before jumping, which reads as a glitch.
        The server snapshot is null, so SSR and the first paint agree.

        The guard is STATE, not a ref: this is read during render, and a ref
        read at render time is exactly what fails to re-render when it changes
        (PC-5, F6-3). -- */
  const resumeTo = React.useSyncExternalStore(
    noStorageEvents,
    () => (initialStep === undefined ? rememberedStep(cycleId) : null),
    () => null,
  );
  const [resumedFor, setResumedFor] = React.useState<string | null>(null);
  if (resumeTo !== null && cycleId && resumedFor !== cycleId) {
    setResumedFor(cycleId);
    const target = Math.min(Math.max(resumeTo, 0), STEPS.length - 1);
    if (target > step) {
      setStep(target);
      setFurthest((f) => Math.max(f, target));
    }
  }

  const goTo = async (next: number) => {
    // Every step change saves first, so the roster the report is computed from
    // is the roster on screen.
    const id = await save();
    if (next === STEPS.length - 1 && id) await refreshReport(id);
    setStep(next);
    setFurthest((f) => Math.max(f, next));
    // A later arrival at step 4 goes through `goTo`, which has just refreshed.
    checkedOnArrival.current = true;
    rememberStep(cycleId ?? id, next);
  };

  /* ---------- launch ---------- */

  const warningsOutstanding =
    report?.warnings.filter((w) => acknowledged[w.code] !== true).length ?? 0;

  const blockedBecause = report ? describeLaunchBlock(report) : "Readiness has not been checked yet.";

  /* -- Who is told when the cycle opens.
        `null` until HR chooses, deliberately — no default. A pre-ticked
        "both" is a decision the app made and HR is presumed to have agreed
        with, and this one sends a WhatsApp to every participant the moment
        Launch is pressed. It is the last reversible moment before an
        irreversible act, so it asks rather than assumes. -- */
  const [recipients, setRecipients] = React.useState<InviteRecipients | null>(null);

  const canOpenDialog =
    Boolean(report?.canLaunch) &&
    warningsOutstanding === 0 &&
    recipients !== null &&
    Boolean(cycleId);

  const disabledReason = !report
    ? "Readiness has not been checked yet."
    : blockedBecause
      ? blockedBecause
      : warningsOutstanding > 0
        ? `Tick ${plural(warningsOutstanding, "acknowledgement")} above first.`
        : recipients === null
          ? "Choose who gets the link first."
          : null;

  const onLaunch = async () => {
    if (!cycleId) return;

    /* -- The "already launched, do not launch again" guard now lives in
          `onConfirm`, which routes to `launchDestination` whenever one is set.
          That covers BOTH endings — the success panel and the no-links-went-out
          notice — where this only ever covered the second, so the button on a
          successful launch would have re-launched. One guard, both paths. -- */

    setLaunching(true);
    setLaunchError(null);

    const result = await launchCycle(cycleId, recipients ?? []);

    setLaunching(false);
    if (!result.ok) {
      setLaunchError(result.error.message);
      // The report may be stale — something changed between step 4 rendering
      // and the button being pressed, which is exactly what the server-side
      // re-check exists to catch.
      void refreshReport(cycleId);
      return;
    }

    /* -- Launched. If nothing could be SENT, hold here and say so rather than
          navigating past it: the cycle is live and nobody has been told, which
          is the one thing HR has to know before they walk away from this
          screen. Not an error — the launch worked (PW-2, PR-11). -- */
    if (result.data.messagesBlocked) {
      setLaunchNotice(result.data.messagesBlocked);
      /* -- The destination is set on THIS path too, and it matters.
            Its footer button reads "Open the cycle" and shares `onConfirm`
            with Launch. Without a destination that press would call the launch
            again — on a cycle that is already live. The server refuses a second
            launch by name, so it was never destructive, but it put an error in
            front of somebody whose launch had worked. -- */
      setLaunchDestination(`/admin/cycles/${cycleId}?launched=1`);
      return;
    }

    /* -- HOLD, and say so. The navigation is now the button in the dialog.

          The dispatch outcome still travels to the board, because the board is
          where HR reads it afterwards and it cannot be recomputed there.

          Without this the confirmation said "Send the links when you are ready"
          on every launch — copy from before P17 reversed PW-3 and made LAUNCH
          the moment the invites go out. It is still true when HR picks nobody
          (`recipients` may be empty), and false the rest of the time, and the
          banner had no way to tell the two apart.

          Counts only. §10 keeps a token, a name and an address out of every
          URL, and none of those is needed to say how many messages went. -- */
    const outcome = new URLSearchParams({
      launched: "1",
      sent: String(result.data.messagesSent),
      queued: String(result.data.messagesQueued),
      failed: String(result.data.messagesFailed),
    });
    setLaunchSent({
      total: result.data.messagesSent + result.data.messagesQueued,
      failed: result.data.messagesFailed,
    });
    setLaunchDestination(`/admin/cycles/${cycleId}?${outcome.toString()}`);
  };

  /* -- CHOOSING THE TYPE RESHAPES THE CYCLE. All of it, in one handler.

        The first version of this did the work in the state INITIALISER, so it
        only ever fired for a cycle arriving from the increment calendar with
        the type already in the URL. Somebody who opened the wizard and pressed
        "Increment" on this very screen got the evaluation defaults — all
        fifty-two ticked and two empty fields — which is exactly what was
        reported, and is the more common way in.

        The type is the one answer everything else follows from, so it is the
        one place to react to. A HANDLER rather than an effect: this happens
        because somebody pressed a button, so there is nothing to synchronise
        and no cascading render to argue about.

        WHAT IT DOES NOT DO: it never clears a name HR has typed. Prefilling an
        empty field is a convenience; overwriting one is losing somebody's
        work. -- */
  function chooseCycleType(next: "EVALUATION" | "INCREMENT") {
    setBasics((b) => ({
      ...b,
      cycle_type: next,
      disclosure: defaultDisclosureFor(next),
      name: b.name.trim() || (next === "INCREMENT" ? `Increment round · ${thisMonthLabel()}` : ""),
      period_label: b.period_label.trim() || (next === "INCREMENT" ? thisMonthLabel() : ""),
    }));

    /* The roster default follows the type: an increment round is about the
       people who are due, an evaluation is about everybody. Only `included`
       moves — whoever HR has chosen as a rater stays chosen. */
    setState((current) => {
      const out: Record<string, PersonState> = {};
      for (const person of people) {
        const existing = current[person.id];
        out[person.id] = {
          leadId: existing?.leadId ?? person.reportsTo,
          included: next === "INCREMENT" ? isIncrementDue(person.nextIncrementOn) : true,
        };
      }
      return out;
    });

    // …and the people step opens on the list that matches what is ticked.
    setPeoplePreset(next === "INCREMENT" ? "due" : "all");
  }

  const includedCount = people.filter((p) => state[p.id]?.included).length;

  /* -- WHY CONTINUE IS BLOCKED, in words, or null.
        One expression rather than a boolean, because the button and the
        sentence beside it must never disagree — a disabled control with no
        explanation is a dead end (§13.4), and two separate conditions is how
        one ends up saying nothing.

        THE MANAGER RULE IS AN INCREMENT RULE, at the owner's instruction: "HR
        must not be able to move past the setup step of an increment cycle until
        an HOD has been added." It is caught at LAUNCH for every cycle already —
        the readiness report refuses one — but on an increment that is three
        screens too late, because the whole point of the pay round is that
        somebody rates the person whose salary is being decided. -- */
  const includedWithoutLead = people.filter(
    (p) => state[p.id]?.included && !state[p.id]?.leadId,
  );

  const continueBlockedBecause: string | null = (() => {
    if (!basics.name.trim()) return "Give the cycle a name to continue.";
    if (!basics.period_label.trim()) return "Give the cycle a period to continue.";
    if (step === 1) {
      if (includedCount === 0) return "Include at least one person to continue.";
      if (basics.cycle_type === "INCREMENT" && includedWithoutLead.length > 0) {
        const [first] = includedWithoutLead;
        return includedWithoutLead.length === 1
          ? `${first?.name ?? "One person"} has no manager. A pay decision needs somebody to rate them — set one in the row, or untick them.`
          : `${includedWithoutLead.length} people have no manager. A pay decision needs somebody to rate them — set one in each row, or untick them.`;
      }
    }
    return null;
  })();
  /* `describeWindows` said "Employees get N days. Leads get N days after that."
     Nobody chooses those numbers any more, so the sentence described a decision
     that is no longer taken. The Basics step says the week in one line instead. */

  return (
    // The header was a back link, a title, a caption and a full card holding
    // One centred column, so the header, the rail and the step share the same
    // left and right edges. The step used to sit in a 760px card under a
    // full-width rail, which is what made the form look like it hung off the
    // left edge of its own progress bar.
    // Full bleed, like every other screen in this section. Step 3 is a
    // ten-column roster and no fixed cap was going to hold it; the gutters come
    // back as padding here so the cards still breathe at the edges.
    <div data-full-bleed className="space-y-4 px-4 py-4 lg:px-6">
      {/*
        ONE STRIP: where you came from, what this is, where you are in it, and
        whether it is saved. Four separate rows of chrome before a four-step
        form is most of a screen spent on orientation.

        `flex-wrap` rather than a fixed split: at 900px all four sit on one
        line, and on a narrower screen the rail drops to its own line instead of
        crushing the title. `min-w-[420px]` on the rail is what makes it choose
        — below that it takes the whole row rather than squeezing four labels
        into half of one.
      */}
      <header className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-card border border-rule bg-surface px-4 py-1.5">
        <div className="flex shrink-0 items-center gap-3">
          <BackLink href="/admin/cycles" label="All cycles" />
          <span aria-hidden className="h-5 w-px bg-rule" />
          <h1 className="whitespace-nowrap text-body font-semibold text-ink">
            {/* -- It said "New evaluation cycle" whatever the type, so an
                  increment round was labelled an evaluation for its whole
                  setup — and the screen where the two are told apart is this
                  one. The title follows the choice. -- */}
            {initial
              ? "Edit cycle"
              : basics.cycle_type === "INCREMENT"
                ? "New increment round"
                : "New evaluation cycle"}
          </h1>
        </div>

        <div className="min-w-[420px] flex-1">
          <StepRail steps={STEPS} current={step} furthest={furthest} onSelect={(i) => void goTo(i)} />
        </div>

        {/* shrink-0: without it the flex-1 rail pushed this on top of its own
            last step, so "4 · Review" and "Saved 12:51" overlapped. */}
        <div className="shrink-0">
          <AutosaveIndicator state={saving ? "saving" : savedAt ? "saved" : "idle"} savedAt={savedAt} />
        </div>
      </header>

      {error ? (
        <p role="alert" className="rounded-card bg-critical-tint px-4 py-3 text-body-sm text-critical">
          {error}
        </p>
      ) : null}

      {/* ---------- Step 1 ---------- */}
      {step === 0 ? (
        <section className="card-surface space-y-4 p-6">
          <h2 className="text-display-sm text-ink">Basics</h2>

          {/* ---------- item 4: what kind of cycle ---------- */}
          {/* Cards, not a dropdown: this choice decides what happens at the end
              and must not be made by scrolling past it. It is also the FIRST
              field, because everything below depends on it. */}
          <fieldset>
            <legend className="text-body font-medium text-ink">
              What kind of cycle is this?
            </legend>
            {locked ? (
              // §13.4: a disabled control with no explanation is a dead end.
              // Read-only WITH the reason, never greyed out in silence.
              <p className="mt-2 rounded-card bg-surface-mute px-4 py-3 text-body-sm text-ink">
                <strong className="font-semibold">
                  {basics.cycle_type === "INCREMENT" ? "Increment" : "Evaluation"}
                </strong>{" "}
                — locked. The question set was frozen for every person when this cycle launched
                (§5), and changing the type now would mean a different set. Create a new cycle
                instead.
              </p>
            ) : (
              <>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {CYCLE_TYPE_CHOICES.map((choice) => (
                    <button
                      key={choice.value}
                      type="button"
                      aria-pressed={basics.cycle_type === choice.value}
                      onClick={() => chooseCycleType(choice.value)}
                      className={cn(
                        "rounded-card border p-4 text-left transition-colors",
                        basics.cycle_type === choice.value
                          ? "border-primary bg-primary/[0.06]"
                          : "border-border bg-canvas hover:border-primary/40",
                      )}
                    >
                      <span
                        className={cn(
                          "block text-body font-semibold",
                          basics.cycle_type === choice.value ? "text-primary" : "text-ink",
                        )}
                      >
                        {choice.label}
                      </span>
                      <span className="mt-1 block text-body-sm leading-snug text-ink-muted">
                        {choice.hint}
                      </span>
                    </button>
                  ))}
                </div>
                {basics.cycle_type === "INCREMENT" ? (
                  <p className="mt-2 text-body-sm text-ink-muted">
                    Employees will also be asked what salary they consider fair. Their answer goes
                    only to you and the MD.
                  </p>
                ) : null}
              </>
            )}
          </fieldset>

          {/* ---------- item 5: how people are added ---------- */}
          <fieldset>
            <legend className="text-body font-medium text-ink">How are people added?</legend>
            {/* An increment asks the same question with different answers: the
                people it is owed to, or everybody. Both are BATCH — the choice
                decides which list step 3 opens on, not how the cycle runs. */}
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {(basics.cycle_type === "INCREMENT"
                ? INCREMENT_KIND_CHOICES
                : CYCLE_KIND_CHOICES
              ).map((choice) => {
                // Both increment cards store BATCH, so the preset is what tells
                // them apart. Selection has to compare on the pair.
                const selected =
                  basics.cycle_kind === choice.value && peoplePreset === choice.preset;

                return (
                  <button
                    key={`${choice.value}-${choice.preset}`}
                    type="button"
                    disabled={locked}
                    aria-pressed={selected}
                    onClick={() => {
                      setBasics({ ...basics, cycle_kind: choice.value });
                      setPeoplePreset(choice.preset);
                    }}
                    className={cn(
                      "rounded-card border p-4 text-left transition-colors",
                      selected
                        ? "border-primary bg-primary/[0.06]"
                        : "border-border bg-canvas hover:border-primary/40",
                      locked && "opacity-60",
                    )}
                  >
                    <span
                      className={cn(
                        "block text-body font-semibold",
                        selected ? "text-primary" : "text-ink",
                      )}
                    >
                      {choice.label}
                    </span>
                    <span className="mt-1 block text-body-sm leading-snug text-ink-muted">
                      {choice.hint}
                    </span>
                  </button>
                );
              })}
            </div>

          </fieldset>

          {/* Three short fields on one row. Stacked, they were three full-width
              inputs holding "Q3 FY26", "Oct-Dec 25 (Q3)" and the number 2 —
              most of the width empty and the form three rows longer for it.
              The hints move under the row so the inputs stay level. */}
          <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto]">
            <div>
              <Label htmlFor="cycle-name">Cycle name</Label>
              <Input
                id="cycle-name"
                className="mt-1.5"
                value={basics.name}
                onChange={(e) => setBasics({ ...basics, name: e.target.value })}
                placeholder="Q3 FY26"
                required
              />
            </div>

            <div>
              <Label htmlFor="period-label">Period label</Label>
              <Input
                id="period-label"
                className="mt-1.5"
                value={basics.period_label}
                onChange={(e) => setBasics({ ...basics, period_label: e.target.value })}
                placeholder="Oct-Dec 25 (Q3)"
                required
              />
            </div>

            <div>
              <Label htmlFor="variance">Flag differences of</Label>
              <Input
                id="variance"
                type="number"
                min={1}
                max={10}
                className="mt-1.5 w-28"
                value={basics.variance_threshold}
                onChange={(e) => setBasics({ ...basics, variance_threshold: e.target.value })}
              />
            </div>
          </div>


          <fieldset>
            {/* §13.1: never show a raw enum to a person, and HR is a person. The
                stored values are untouched — only the labels are human. */}
            <legend className="text-body font-medium text-ink">
              What the employee sees when this closes
            </legend>
            <RadioGroup
              className="mt-3 space-y-3"
              value={basics.disclosure}
              onValueChange={(value) => setBasics({ ...basics, disclosure: value })}
            >
              {DISCLOSURE_CHOICES.map((choice) => (
                <div key={choice.value} className="flex items-start gap-3">
                  <RadioGroupItem value={choice.value} id={`disclosure-${choice.value}`} className="mt-1" />
                  <div>
                    <Label htmlFor={`disclosure-${choice.value}`} className="text-body text-ink">
                      {choice.label}
                    </Label>
                    <p className="text-body-sm text-ink-muted">{choice.hint}</p>
                  </div>
                </div>
              ))}
            </RadioGroup>

            {/* Permanent, not dismissible. It is the sentence that makes the
                whole two-sided design make sense, and somebody choosing a
                disclosure policy is exactly who needs to read it. */}
            <p className="mt-3 rounded-card bg-accent px-4 py-3 text-body-sm text-accent-foreground">
              The Manager&rsquo;s ratings and written comments are never shown to the employee, in any
              option. That is what makes the two-sided rating honest.
            </p>
          </fieldset>
        </section>
      ) : null}

      {/* -- The DATES step used to be here. It is gone (see STEPS): a cycle
              opens the day it launches and runs for a week, so there was
              nothing left to ask. The dates are still SAVED — the launch guard
              needs all four and messages carry the due date — they are just
              derived rather than typed. -- */}

      {/* ---------- Step 2 · People ---------- */}
      {step === 1 ? (
        <section className="card-surface space-y-4 p-6">
          <h2 className="text-display-sm text-ink">People</h2>
          <StepPeople
            people={people}
            state={state}
            onChange={setState}
            preset={peoplePreset}
            roundNote={
              preselect === "evaluation-due"
                ? `${includedCount} ${includedCount === 1 ? "person is" : "people are"} ticked because their evaluation is due or already late.`
                : preselect === "increment-due"
                  ? `${includedCount} ${includedCount === 1 ? "person is" : "people are"} ticked because their increment is due.`
                  : undefined
            }
          />
        </section>
      ) : null}

      {/* ---------- Step 3 · Review ---------- */}
      {step === 2 ? (
        <StepReview
          people={people}
          state={state}
          jobSkillCounts={jobSkillCounts}
          report={report}
          acknowledged={acknowledged}
          onAcknowledge={(code, value) => setAcknowledged((a) => ({ ...a, [code]: value }))}
          recipients={recipients}
          onRecipientsChange={setRecipients}
        />
      ) : null}

      {/* ---------- Footer ---------- */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex gap-3">
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={step === 0}
            onClick={() => void goTo(step - 1)}
          >
            Back
          </Button>
          <Button type="button" variant="ghost" className="min-h-11" onClick={() => void save()}>
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Save as draft
          </Button>
        </div>

        {step < STEPS.length - 1 ? (
          <div className="flex flex-wrap items-center justify-end gap-3">
            {/* §13.4 / P10: never a silent disabled button. The sentence sits
                beside the control rather than in a tooltip, which is invisible
                on a phone and to anybody who does not think to hover. */}
            {continueBlockedBecause ? (
              <p className="max-w-md text-right text-body-sm text-critical">{continueBlockedBecause}</p>
            ) : null}
            <Button
              type="button"
              className="min-h-11"
              disabled={Boolean(continueBlockedBecause)}
              onClick={() => void goTo(step + 1)}
            >
              Continue
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-end gap-3">
            {/* P10: "never a silent disabled button." The sentence sits beside
                the control, not in a tooltip — a tooltip is invisible on a
                phone and to anybody who does not think to hover. */}
            {disabledReason ? (
              <p className="max-w-md text-right text-body-sm text-ink-muted">{disabledReason}</p>
            ) : null}
            <Button
              type="button"
              className="min-h-11"
              disabled={!canOpenDialog}
              onClick={() => setDialogOpen(true)}
            >
              <Rocket className="size-4" aria-hidden />
              Launch cycle
            </Button>
          </div>
        )}
      </div>

      {/* Keyed on `open` so a reopened dialog starts with the name box clear. */}
      <LaunchDialog
        key={`launch-${dialogOpen}`}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        cycleName={basics.name || "this cycle"}
        participantCount={report?.participantCount ?? includedCount}
        // Distinct HODs, not one per person: a HOD rating four people is one
        // HOD, and the dialog is telling HR how many people it is about to
        // message.
        leadCount={
          new Set(
            people
              .filter((p) => state[p.id]?.included)
              .map((p) => state[p.id]?.leadId)
              .filter((v): v is string => Boolean(v)),
          ).size
        }
        cycleKind={basics.cycle_kind}
        pending={launching}
        error={launchError}
        notice={launchNotice}
        sent={launchSent}
        /* -- Once it has launched, the button is the way OUT rather than a
              second launch. `launchDestination` is set only on success, so
              there is no state in which pressing this could launch twice. -- */
        onConfirm={() =>
          launchDestination ? router.push(launchDestination) : void onLaunch()
        }
      />
    </div>
  );
}
