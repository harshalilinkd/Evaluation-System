"use client";

/** Settings › Evaluation periods. When everybody's reviews fall (0076). */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { SectionCard } from "@/components/appraise/section-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveEvaluationSchedule, type EvaluationSchedule } from "@/lib/due/schedule";
import { cn } from "@/lib/utils";

/** "3, 9" ⇄ [3, 9]. What HR types is a list, and a list is how it reads back. */
function parseMonths(text: string): number[] {
  return text
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map(Number);
}

/**
 * The schedule, said as a sentence.
 *
 * THE POINT OF THE WHOLE SCREEN. Four numbers in four boxes do not tell
 * anybody when their people will be reviewed — the reader has to hold the
 * arithmetic themselves. This spells the year out, and it updates as the boxes
 * are typed in, so the effect of a change is visible BEFORE it is saved rather
 * than a month later when somebody is chased on the wrong day.
 */
function describe(months: number[], increment: number, anchor: string): string[] {
  const lines = months.map(
    (m) => `${m === 1 ? "1 month" : `${m} months`} after ${anchor} — evaluation`,
  );
  lines.push(`${increment} months after ${anchor} — increment`);
  return lines;
}

export function ScheduleTab({ schedule }: { schedule: EvaluationSchedule }) {
  const router = useRouter();

  /* Held as TEXT while it is being typed. A number input that reformats "3, "
     into "3" the moment a comma is pressed makes a list impossible to type. */
  const [joinerMonths, setJoinerMonths] = React.useState(schedule.joinerEvaluationMonths.join(", "));
  const [joinerIncrement, setJoinerIncrement] = React.useState(String(schedule.joinerIncrementMonths));
  const [cycleMonths, setCycleMonths] = React.useState(schedule.cycleEvaluationMonths.join(", "));
  const [cycleIncrement, setCycleIncrement] = React.useState(String(schedule.cycleIncrementMonths));
  const [noticeDays, setNoticeDays] = React.useState(String(schedule.noticeDays));

  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const joiner = parseMonths(joinerMonths);
  const cycle = parseMonths(cycleMonths);
  const joinerYear = Number(joinerIncrement) || 0;
  const cycleYear = Number(cycleIncrement) || 0;

  /* -- The same rule the database enforces, said BEFORE the save.
        An evaluation on or after the increment it precedes belongs to the next
        cycle and would be created twice. The trigger refuses it either way;
        this is so HR reads a sentence rather than a constraint violation
        (§0.7), and the two are worded the same so they cannot seem to disagree. -- */
  const problem =
    joinerYear < 1 || cycleYear < 1
      ? "An increment interval has to be at least one month."
      : joiner.some((m) => m >= joinerYear)
        ? `A new joiner's evaluation has to fall before their first increment at month ${joinerYear}.`
        : cycle.some((m) => m >= cycleYear)
          ? `An evaluation has to fall before the next increment at month ${cycleYear}.`
          : null;

  const dirty =
    joinerMonths !== schedule.joinerEvaluationMonths.join(", ") ||
    joinerIncrement !== String(schedule.joinerIncrementMonths) ||
    cycleMonths !== schedule.cycleEvaluationMonths.join(", ") ||
    cycleIncrement !== String(schedule.cycleIncrementMonths) ||
    noticeDays !== String(schedule.noticeDays);

  async function save() {
    setBusy(true);
    setMessage(null);
    const result = await saveEvaluationSchedule({
      joinerEvaluationMonths: joiner,
      joinerIncrementMonths: joinerYear,
      cycleEvaluationMonths: cycle,
      cycleIncrementMonths: cycleYear,
      noticeDays: Number(noticeDays) || 0,
    });
    setBusy(false);

    if (!result.ok) {
      setMessage({ tone: "error", text: result.message });
      return;
    }
    setMessage({
      tone: "ok",
      text: "Saved. Everybody's dates have been recalculated — anything already started is untouched.",
    });
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {/* -- WHO THIS GOVERNS, said once at the top.
            The two cards below read "a new joiner" and "everybody else", which
            sounds like the whole company. It is the office team: the production
            team is not reviewed on intervals at all — one increment a year, and
            an appraisal on their own rounds (§7, WORKER-1). Without this the
            fields look like they set a rule for people they do not reach, and
            changing them looks like it has done nothing. -- */}
      <p className="rounded-control border border-rule bg-surface-mute px-4 py-3 font-sans text-body-sm text-ink-muted">
        This is the office team&rsquo;s review schedule. The production team is not reviewed on
        intervals — they take one increment a year and are appraised on their own rounds, started
        from Production Appraisals.
      </p>

      <SectionCard
        title="When a new joiner is reviewed"
        description="Counted from their joining date. This is the schedule until their first increment."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="joiner_months" className="type-label text-ink-muted">
              Evaluations, in months after joining
            </Label>
            <Input
              id="joiner_months"
              value={joinerMonths}
              onChange={(e) => setJoinerMonths(e.target.value)}
              placeholder="1, 6"
              className="min-h-11 tabular"
            />
            <p className="font-sans text-body-sm text-ink-muted">
              Separate them with commas. How many you list is how many reviews a joiner gets.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="joiner_increment" className="type-label text-ink-muted">
              First increment, in months after joining
            </Label>
            <Input
              id="joiner_increment"
              type="number"
              min={1}
              max={120}
              value={joinerIncrement}
              onChange={(e) => setJoinerIncrement(e.target.value)}
              className="min-h-11 tabular"
            />
          </div>
        </div>

        <ul className="mt-4 space-y-1 rounded-control border border-rule bg-surface-mute p-3">
          {describe(joiner, joinerYear, "joining").map((line) => (
            <li key={line} className="font-sans text-body-sm text-ink">
              {line}
            </li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard
        title="When everybody else is reviewed"
        description="Counted from their last increment, and it starts again at every increment — so this is the loop somebody stays on for the rest of their time here."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="cycle_months" className="type-label text-ink-muted">
              Evaluations, in months after the last increment
            </Label>
            <Input
              id="cycle_months"
              value={cycleMonths}
              onChange={(e) => setCycleMonths(e.target.value)}
              placeholder="3, 9"
              className="min-h-11 tabular"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cycle_increment" className="type-label text-ink-muted">
              Next increment, in months
            </Label>
            <Input
              id="cycle_increment"
              type="number"
              min={1}
              max={120}
              value={cycleIncrement}
              onChange={(e) => setCycleIncrement(e.target.value)}
              className="min-h-11 tabular"
            />
            <p className="font-sans text-body-sm text-ink-muted">
              A person whose own record names a different frequency keeps theirs — a contract can
              differ from the company norm.
            </p>
          </div>
        </div>

        <ul className="mt-4 space-y-1 rounded-control border border-rule bg-surface-mute p-3">
          {describe(cycle, cycleYear, "their last increment").map((line) => (
            <li key={line} className="font-sans text-body-sm text-ink">
              {line}
            </li>
          ))}
          <li className="font-sans text-body-sm text-ink-muted">…then it starts again.</li>
        </ul>
      </SectionCard>

      <SectionCard
        title="How much warning HR gets"
        description="A date appears on Evaluation Due, and HR is messaged, this many days before it falls."
      >
        <div className="max-w-40 space-y-2">
          <Label htmlFor="notice_days" className="type-label text-ink-muted">
            Days
          </Label>
          <Input
            id="notice_days"
            type="number"
            min={0}
            max={180}
            value={noticeDays}
            onChange={(e) => setNoticeDays(e.target.value)}
            className="min-h-11 tabular"
          />
        </div>
      </SectionCard>

      {problem ? (
        <p role="alert" className="font-sans text-body-sm text-critical">
          {problem}
        </p>
      ) : null}
      {message ? (
        <p
          role={message.tone === "error" ? "alert" : "status"}
          className={cn(
            "font-sans text-body-sm",
            message.tone === "error" ? "text-critical" : "text-ink-muted",
          )}
        >
          {message.text}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" className="min-h-11" onClick={save} disabled={busy || !dirty || Boolean(problem)}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {busy ? "Saving…" : "Save the schedule"}
        </Button>
        <p className="font-sans text-body-sm text-ink-muted">
          Saving recalculates everybody&rsquo;s upcoming dates. An evaluation already started, or a
          date you have skipped, is left exactly as it is.
        </p>
      </div>
    </div>
  );
}
