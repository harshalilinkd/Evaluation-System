"use client";

/** The distribution table. P11 screen — one row per person, one outcome per row. */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Copy,
  Loader2,
  Mail,
  MessageCircle,
  MoreHorizontal,
  RotateCw,
  Search,
} from "lucide-react";

import { SegmentedProgress } from "@/components/appraise/segmented-bar";
import {
  SCREEN_SELECT_CLASS,
  ScreenBody,
  ScreenHeader,
  ScreenToolbar,
  TableScreen,
  Tally,
} from "@/components/appraise/screen";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { plural } from "@/lib/cycles/schema";
import type { Channel } from "@/lib/notify/dispatch";
import type { Preflight } from "@/lib/notify/preflight";
import {
  issueCopyableLink,
  sendBulk,
  sendEvaluationLink,
  updatePhone,
  type SendOutcome,
} from "@/lib/notify/actions";
import type { DistributionBoard, DistributionRow, LinkStatus } from "@/lib/notify/queries";
import { HistoryDrawer } from "@/app/(app)/admin/cycles/[id]/distribute/history-drawer";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/utils/date";

/** DESIGN.md §5.3 pills. Tier tints carry tier meaning — cyan is the employee. */
const LINK_STATUS: Record<LinkStatus, { label: string; classes: string }> = {
  NOT_SENT: { label: "Not sent", classes: "bg-surface-mute text-ink-muted" },
  // Lead tint for "we have acted"; the employee has not yet.
  SENT: { label: "Sent", classes: "bg-lead-tint text-lead" },
  // Self tint: the employee has done something — they opened it.
  OPENED: { label: "Opened", classes: "bg-self-tint text-self" },
  // Final, solid: the strongest state on this screen.
  SUBMITTED: { label: "Submitted", classes: "bg-final text-ink-invert" },
};

export function DistributeClient({
  board,
  configured,
  preflight,
}: {
  board: DistributionBoard;
  configured: { whatsapp: boolean; email: boolean };
  /** Whether a link sent from here would actually be openable. Verdicts only. */
  preflight: { appUrl: Preflight; mailFrom: Preflight };
}) {
  const router = useRouter();

  const [search, setSearch] = React.useState("");
  const [department, setDepartment] = React.useState("all");
  const [statusFilter, setStatusFilter] = React.useState<"all" | LinkStatus | "FAILED" | "NO_CONTACT">("all");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  const [running, setRunning] = React.useState(false);
  const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null);
  const [outcomes, setOutcomes] = React.useState<SendOutcome[]>([]);
  const [confirm, setConfirm] = React.useState<{ channels: Channel[] } | null>(null);
  /* -- WHO the links go to.
        The screen has always sent to the employee and only the employee — it
        never read `lead_id` at all. P10-REV made the HOD a recipient from
        launch (PR-7), so the only time a HOD ever got their link was the launch
        dispatch; if that failed, there was no way to send it.

        Employee is the default because it is the common case and because a
        mis-aimed bulk send cannot be recalled. -- */
  const [recipients, setRecipients] = React.useState<Array<"SELF" | "LEAD">>(["SELF"]);
  const [copyWarning, setCopyWarning] = React.useState<DistributionRow | null>(null);
  const [copied, setCopied] = React.useState<{ link: string; name: string; layer: "SELF" | "LEAD" } | null>(null);
  const [fixing, setFixing] = React.useState<DistributionRow | null>(null);
  const [history, setHistory] = React.useState<DistributionRow | null>(null);

  const visible = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    return board.rows.filter((row) => {
      if (department !== "all" && row.departmentId !== department) return false;
      if (statusFilter === "FAILED" && row.lastResult?.status !== "FAILED") return false;
      if (statusFilter === "NO_CONTACT" && (row.phoneE164 || row.email)) return false;
      if (
        statusFilter !== "all" &&
        statusFilter !== "FAILED" &&
        statusFilter !== "NO_CONTACT" &&
        row.linkStatus !== statusFilter
      ) {
        return false;
      }
      if (needle && !row.name.toLowerCase().includes(needle) && !(row.employeeCode ?? "").toLowerCase().includes(needle)) {
        return false;
      }
      return true;
    });
  }, [board.rows, search, department, statusFilter]);

  const selectable = visible.filter((r) => r.sendable);
  const someSelected = selectable.filter((r) => selected.has(r.evaluationId)).length;
  const allSelected = selectable.length > 0 && someSelected === selectable.length;

  const failedRows = board.rows.filter((r) => r.lastResult?.status === "FAILED");

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  /* -- The run -- */
  const run = async (ids: string[], channels: Channel[], layers = recipients) => {
    setRunning(true);
    setOutcomes([]);
    setConfirm(null);

    const total = ids.length * channels.length * layers.length;
    setProgress({ done: 0, total });

    // Driven one person at a time from the client so each row updates as it
    // lands. The server action is sequential and paced internally; calling it
    // per person is what makes the progress real rather than a guess.
    const collected: SendOutcome[] = [];
    for (const id of ids) {
      const result = await sendBulk([id], channels, layers);
      if (result.ok) collected.push(...result.data.outcomes);
      else {
        collected.push({
          evaluationId: id,
          name: "",
          channel: channels[0] ?? "EMAIL",
          ok: false,
          message: result.error.message,
        });
      }
      setOutcomes([...collected]);
      setProgress({ done: collected.length, total });
    }

    setRunning(false);
    setProgress(null);
    setSelected(new Set());
    router.refresh();
  };

  const sendOne = async (
    row: DistributionRow,
    channel: Channel,
    layer: "SELF" | "LEAD" = "SELF",
  ) => {
    setRunning(true);
    const result = await sendEvaluationLink(row.evaluationId, channel, layer);
    setOutcomes(
      result.ok
        ? [result.data]
        : [{ evaluationId: row.evaluationId, name: row.name, channel, ok: false, message: result.error.message }],
    );
    setRunning(false);
    router.refresh();
  };

  const sentCount = board.totals.sent + board.totals.opened;

  /* -- The worst offender of the four: a back link, a title, a subtitle, up to
        three alert banners, a hero with two tiles beside it, and a toolbar whose
        three controls each carried a stacked <Label>. Over 700px before the
        first person. Same anatomy as the rest now, with the send progress as a
        3px rule under the toolbar instead of a 150px card. -- */
  return (
    <TooltipProvider delayDuration={200}>
      <TableScreen>
        <ScreenHeader
          title="Send links"
          subtitle={
            <span className="flex flex-wrap items-center gap-x-2">
              <Link
                href={`/admin/cycles/${board.cycle.id}`}
                className="inline-flex items-center gap-1 hover:text-ink"
              >
                <ArrowLeft className="size-3" aria-hidden />
                {board.cycle.name}
              </Link>
              <span aria-hidden>·</span>
              {board.cycle.periodLabel}
              {board.cycle.status === "DRAFT" ? (
                <>
                  <span aria-hidden>·</span>
                  <span className="text-warning">not launched yet</span>
                </>
              ) : null}
            </span>
          }
          stats={
            <>
              <Tally label="Sent" value={`${sentCount}/${board.totals.total}`} />
              <Tally label="Not sent" value={board.totals.notSent} />
              <Tally label="Opened" value={board.totals.opened} />
              {board.totals.failed > 0 ? (
                <Tally label="Failed" value={board.totals.failed} tone="critical" />
              ) : null}
            </>
          }
          action={
            failedRows.length > 0 ? (
              <Button
                variant="outline"
                className="min-h-11"
                disabled={running}
                onClick={() => void run(failedRows.map((r) => r.evaluationId), ["WHATSAPP"])}
              >
                <RotateCw className="size-4" aria-hidden />
                Retry all failed ({failedRows.length})
              </Button>
            ) : null
          }
        />

        {/* ---------- Toolbar ----------
            The stacked <Label> above each control is gone; each keeps its
            accessible name on the control itself, which is what a toolbar of
            three filters needs and what every other screen here does. */}
        {/* -- A DEAD END, MADE ACTIONABLE.
              A draft cycle has no evaluations, so it has no forms and no
              tokens — there is genuinely nothing to link to, and every row said
              so. But the same sentence repeated down a table is a diagnosis
              with no treatment: it explains the disabled checkboxes four times
              and never once says what to do (§13.4).

              Said once, at the top, with the button that fixes it. The per-row
              reason stays for the OTHER blocked cases, which are per-person —
              already submitted, no contact details — and genuinely differ row
              by row. -- */}
        {board.cycle.status === "DRAFT" ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule bg-warning-tint px-4 py-3 lg:px-6">
            <div className="min-w-0">
              <p className="font-sans text-body font-medium text-ink">
                This cycle has not been launched.
              </p>
              <p className="font-sans text-body-sm text-ink-muted">
                Nobody has a form yet, so there is no link to send. Launching creates everybody&rsquo;s
                evaluation and their invite links; you can send from here straight afterwards.
              </p>
            </div>
            <Button asChild className="min-h-11 shrink-0">
              <Link href={`/admin/cycles/${board.cycle.id}`}>Go to the cycle and launch it</Link>
            </Button>
          </div>
        ) : null}

        <ScreenToolbar>
          <div className="relative min-w-0 flex-1 sm:w-[260px] sm:flex-none">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
            />
            <Input
              id="dist-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name or employee code"
              aria-label="Search people"
              className="min-h-11 border-rule bg-surface pl-9"
            />
          </div>

          <select
            id="dist-department"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            aria-label="Filter by department"
            className={SCREEN_SELECT_CLASS}
          >
            <option value="all">All departments</option>
            {board.departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>

          <select
            id="dist-status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            aria-label="Filter by status"
            className={SCREEN_SELECT_CLASS}
          >
            <option value="all">Everyone</option>
            <option value="NOT_SENT">Not sent</option>
            <option value="SENT">Sent</option>
            <option value="OPENED">Opened</option>
            <option value="SUBMITTED">Submitted</option>
            <option value="FAILED">Failed</option>
            {/* A first-class view, per the brief: these people need a
                different action, not a retry. */}
            <option value="NO_CONTACT">No contact details ({board.totals.noContact})</option>
          </select>

          {/* ---------- WHO the links go to ----------
              Both people rate the same form at the same time (§1), so both need
              a link — and this screen only ever sent to the employee. Two
              checkboxes rather than a segmented control because "both" is a
              real and common choice, not a third mode.

              The HOD's message is a DIFFERENT template: `leadReviewInvite`
              states only that their form is open and when it is due. It says
              nothing about whether the employee has submitted, which is what
              blind rating withholds (PR-10). */}
          <fieldset className="flex min-h-11 items-center gap-3 rounded-control border border-rule bg-surface px-3">
            <legend className="sr-only">Who receives the link</legend>
            <span className="text-body-sm text-ink-muted">Send to</span>
            {(
              [
                { value: "SELF" as const, label: "Employee" },
                { value: "LEAD" as const, label: "HOD" },
              ]
            ).map((option) => (
              <label
                key={option.value}
                className="flex cursor-pointer items-center gap-1.5 text-body-sm text-ink"
              >
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={recipients.includes(option.value)}
                  onChange={(e) =>
                    setRecipients((prev) =>
                      e.target.checked
                        ? [...new Set([...prev, option.value])]
                        : /* Never empty: unticking the last one would leave a
                             Send button that silently messages nobody. */
                          prev.length === 1
                          ? prev
                          : prev.filter((r) => r !== option.value),
                    )
                  }
                />
                {option.label}
              </label>
            ))}
          </fieldset>
        </ScreenToolbar>

        {/* The hero's progress bar, kept — it is information — at 3px instead of
            inside a 150px card. */}
        <div className="shrink-0 border-b border-rule">
          <SegmentedProgress
            height="h-1.5"
            total={board.totals.total}
            self={sentCount}
            lead={board.totals.sent}
            final={board.totals.opened}
          />
        </div>

        <ScreenBody className="space-y-4 p-4 lg:p-5">
        {/* Providers that are not configured are stated once, up front, rather
            than as 47 identical failures after a bulk run. */}
        {!configured.whatsapp || !configured.email ? (
          <p className="flex items-start gap-2 rounded-card border border-warning/40 bg-warning-tint px-4 py-3 text-body-sm text-ink">
            <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
            <span>
              {!configured.whatsapp && !configured.email
                ? "Neither WhatsApp nor email is configured. Add the Maytapi and Resend keys to .env.local before sending."
                : !configured.whatsapp
                  ? "WhatsApp is not configured — add the three MAYTAPI_ keys to .env.local. Email will still work."
                  : "Email is not configured — add RESEND_API_KEY and MAIL_FROM to .env.local. WhatsApp will still work."}
            </span>
          </p>
        ) : null}

        {/* A key being present is not the same as a message being usable.
            These two are invisible until an employee says the link does
            nothing, so they are stated before the send button, not after. */}
        {!preflight.appUrl.ok ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-card border border-critical/40 bg-critical-tint px-4 py-3 text-body-sm text-ink"
          >
            <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-critical" />
            <div className="space-y-1">
              <p className="font-medium text-critical">{preflight.appUrl.title}</p>
              <p>{preflight.appUrl.detail}</p>
              <p className="text-ink-muted">{preflight.appUrl.fix}</p>
            </div>
          </div>
        ) : null}

        {preflight.appUrl.ok && !preflight.mailFrom.ok ? (
          <div
            role="status"
            className="flex items-start gap-2 rounded-card border border-warning/40 bg-warning-tint px-4 py-3 text-body-sm text-ink"
          >
            <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
            <div className="space-y-1">
              <p className="font-medium">{preflight.mailFrom.title}</p>
              <p>{preflight.mailFrom.detail}</p>
              <p className="text-ink-muted">{preflight.mailFrom.fix}</p>
            </div>
          </div>
        ) : null}

        {/* ---------- Outcomes from the last run ---------- */}
        {outcomes.length > 0 ? (
          <section className="card-surface p-4">
            <h2 className="text-body font-medium text-ink">
              Last run — {outcomes.filter((o) => o.ok).length} sent, {outcomes.filter((o) => !o.ok).length} failed
            </h2>
            <ul className="mt-2 space-y-1">
              {outcomes.filter((o) => !o.ok).map((o, i) => (
                <li key={`${o.evaluationId}-${i}`} className="flex items-start gap-2 text-body-sm text-critical">
                  <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                  {o.message}
                </li>
              ))}
              {outcomes.every((o) => o.ok) ? (
                <li className="flex items-center gap-2 text-body-sm text-success">
                  <Check aria-hidden className="size-3.5" />
                  Everything went out.
                </li>
              ) : null}
            </ul>
          </section>
        ) : null}

        {/* ---------- Table ---------- */}
        <section className="card-surface overflow-hidden">
          <div className="hidden overflow-x-auto lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    {/* Tri-state. A binary tick reads as "nobody selected"
                        while two of three are — on the control that decides
                        who a message goes to, which is not a place to be
                        vague about how many are in. */}
                    <Checkbox
                      checked={
                        someSelected === 0
                          ? false
                          : someSelected === selectable.length
                            ? true
                            : "indeterminate"
                      }
                      disabled={selectable.length === 0}
                      aria-label={
                        allSelected
                          ? `Clear all ${selectable.length} selected`
                          : `Select all ${selectable.length} people shown`
                      }
                      onCheckedChange={() =>
                        setSelected(allSelected ? new Set() : new Set(selectable.map((r) => r.evaluationId)))
                      }
                    />
                  </TableHead>
                  <TableHead>Person</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Link</TableHead>
                  <TableHead>Last sent</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>

              <TableBody>
                {visible.map((row) => (
                  <TableRow key={row.evaluationId} className={cn(!row.sendable && "bg-surface-mute/50")}>
                    <TableCell>
                      <Checkbox
                        checked={selected.has(row.evaluationId)}
                        disabled={!row.sendable}
                        aria-label={`Select ${row.name}`}
                        onCheckedChange={() => toggle(row.evaluationId)}
                      />
                    </TableCell>

                    <TableCell>
                      <div className="flex items-center gap-3">
                        <span
                          aria-hidden
                          className="flex size-8 shrink-0 items-center justify-center rounded-pill bg-accent text-body-sm font-medium text-primary"
                        >
                          {row.initials}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-ink">{row.name}</p>
                          <p className="tabular truncate text-body-sm text-ink-muted">
                            {row.employeeCode ?? "—"} · {row.departmentName ?? "No department"}
                          </p>
                        </div>
                      </div>
                    </TableCell>

                    <TableCell>
                      <div className="flex items-center gap-2">
                        <ContactIcon
                          kind="phone"
                          present={Boolean(row.phoneE164)}
                          // The specific reason, not "invalid" — the fix for a
                          // landline differs from the fix for a typo.
                          problem={row.phoneRaw && !row.phoneE164 ? row.phoneError?.message ?? null : null}
                          value={row.phoneE164 ?? row.phoneRaw}
                        />
                        <ContactIcon kind="email" present={Boolean(row.email)} problem={null} value={row.email} />

                        {row.phoneRaw && !row.phoneE164 ? (
                          <button
                            type="button"
                            onClick={() => setFixing(row)}
                            className="text-body-sm font-medium text-critical underline underline-offset-2"
                          >
                            Fix number
                          </button>
                        ) : null}
                      </div>
                    </TableCell>

                    <TableCell>
                      <span
                        className={cn(
                          "inline-flex items-center rounded-pill px-2.5 py-1 text-body-sm font-medium",
                          LINK_STATUS[row.linkStatus].classes,
                        )}
                      >
                        {LINK_STATUS[row.linkStatus].label}
                      </span>
                    </TableCell>

                    <TableCell className="tabular whitespace-nowrap text-body-sm text-ink-muted">
                      {row.lastSentAt ? (
                        <span className="flex items-center gap-2">
                          {formatDateTime(row.lastSentAt)}
                          {row.lastChannels.map((c) =>
                            c === "WHATSAPP" ? (
                              <MessageCircle key={c} aria-label="WhatsApp" className="size-3.5" />
                            ) : (
                              <Mail key={c} aria-label="Email" className="size-3.5" />
                            ),
                          )}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>

                    <TableCell className="max-w-64">
                      {!row.sendable ? (
                        // P11: "with the reason shown rather than the button
                        // silently disabled".
                        <span className="text-body-sm text-ink-muted">{row.blockedReason}</span>
                      ) : row.lastResult?.status === "FAILED" ? (
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="rounded-pill bg-critical-tint px-2 py-0.5 text-body-sm font-medium text-critical">
                            Failed
                          </span>
                          <span className="text-body-sm text-ink-muted">{row.lastResult.error}</span>
                          <button
                            type="button"
                            disabled={running}
                            onClick={() => void sendOne(row, "WHATSAPP")}
                            className="text-body-sm font-medium text-primary underline underline-offset-2"
                          >
                            Retry
                          </button>
                        </span>
                      ) : row.lastResult?.status === "SENT" ? (
                        <span className="text-body-sm text-ink-muted">Accepted by provider</span>
                      ) : (
                        <span className="text-body-sm text-ink-muted">—</span>
                      )}
                    </TableCell>

                    <TableCell>
                      <RowMenu
                        row={row}
                        configured={configured}
                        disabled={running}
                        onSend={(channel) => void sendOne(row, channel)}
                        onSendBoth={() => void run([row.evaluationId], ["WHATSAPP", "EMAIL"], ["SELF"])}
                        /* Explicitly the HOD, whatever the toolbar is set to:
                           chasing one missing HOD is the case this exists for,
                           and making it depend on a toggle elsewhere on the
                           screen is how the wrong person gets messaged. */
                        onSendLead={() => void sendOne(row, "WHATSAPP", "LEAD")}
                        onCopy={() => setCopyWarning(row)}
                        onHistory={() => setHistory(row)}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* -- ONE CARD PER PERSON ON A PHONE.
                Six columns inside `overflow-x-auto` puts the ⋯ menu — the only
                way to send one person their link — off the right-hand edge, and
                the tick that selects them for a bulk send off the left. The
                whole screen is about pressing those two things.

                The same cells re-laid out. Every control is the one the table
                renders, `RowMenu` included, so a phone can do everything a
                laptop can. -- */}
          <ul className="space-y-3 p-3 lg:hidden">
            {visible.map((row) => (
              <li
                key={row.evaluationId}
                className={cn("card-surface p-4", !row.sendable && "bg-surface-mute/50")}
              >
                <div className="flex items-start gap-3">
                  <Checkbox
                    checked={selected.has(row.evaluationId)}
                    disabled={!row.sendable}
                    aria-label={`Select ${row.name}`}
                    onCheckedChange={() => toggle(row.evaluationId)}
                    className="mt-1"
                  />
                  <span
                    aria-hidden
                    className="flex size-8 shrink-0 items-center justify-center rounded-pill bg-accent text-body-sm font-medium text-primary"
                  >
                    {row.initials}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-ink">{row.name}</p>
                    <p className="tabular truncate text-body-sm text-ink-muted">
                      {row.employeeCode ?? "—"} · {row.departmentName ?? "No department"}
                    </p>
                  </div>
                  <RowMenu
                    row={row}
                    configured={configured}
                    disabled={running}
                    onSend={(channel) => void sendOne(row, channel)}
                    onSendBoth={() => void run([row.evaluationId], ["WHATSAPP", "EMAIL"], ["SELF"])}
                    onSendLead={() => void sendOne(row, "WHATSAPP", "LEAD")}
                    onCopy={() => setCopyWarning(row)}
                    onHistory={() => setHistory(row)}
                  />
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-rule pt-3">
                  <span className="flex items-center gap-2">
                    <ContactIcon
                      kind="phone"
                      present={Boolean(row.phoneE164)}
                      problem={row.phoneRaw && !row.phoneE164 ? row.phoneError?.message ?? null : null}
                      value={row.phoneE164 ?? row.phoneRaw}
                    />
                    <ContactIcon kind="email" present={Boolean(row.email)} problem={null} value={row.email} />
                    {row.phoneRaw && !row.phoneE164 ? (
                      <button
                        type="button"
                        onClick={() => setFixing(row)}
                        className="min-h-11 text-body-sm font-medium text-critical underline underline-offset-2"
                      >
                        Fix number
                      </button>
                    ) : null}
                  </span>

                  <span
                    className={cn(
                      "inline-flex items-center rounded-pill px-2.5 py-1 text-body-sm font-medium",
                      LINK_STATUS[row.linkStatus].classes,
                    )}
                  >
                    {LINK_STATUS[row.linkStatus].label}
                  </span>

                  {row.lastSentAt ? (
                    <span className="tabular flex items-center gap-2 text-body-sm text-ink-muted">
                      {formatDateTime(row.lastSentAt)}
                      {row.lastChannels.map((c) =>
                        c === "WHATSAPP" ? (
                          <MessageCircle key={c} aria-label="WhatsApp" className="size-3.5" />
                        ) : (
                          <Mail key={c} aria-label="Email" className="size-3.5" />
                        ),
                      )}
                    </span>
                  ) : null}
                </div>

                {/* The result, on its own line: it is a sentence — a provider
                    error, or the reason this row cannot be sent at all — and
                    §13.4 keeps that beside the control it explains. */}
                {!row.sendable ? (
                  <p className="mt-2 text-body-sm text-ink-muted">{row.blockedReason}</p>
                ) : row.lastResult?.status === "FAILED" ? (
                  <p className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="rounded-pill bg-critical-tint px-2 py-0.5 text-body-sm font-medium text-critical">
                      Failed
                    </span>
                    <span className="text-body-sm text-ink-muted">{row.lastResult.error}</span>
                    <button
                      type="button"
                      disabled={running}
                      onClick={() => void sendOne(row, "WHATSAPP")}
                      className="min-h-11 text-body-sm font-medium text-primary underline underline-offset-2"
                    >
                      Retry
                    </button>
                  </p>
                ) : row.lastResult?.status === "SENT" ? (
                  <p className="mt-2 text-body-sm text-ink-muted">Accepted by provider</p>
                ) : null}
              </li>
            ))}
          </ul>

          {visible.length === 0 ? (
            <p className="py-10 text-center text-body-sm text-ink-muted">
              {statusFilter === "NO_CONTACT"
                ? "Everybody has a phone number or an email address."
                : "Nobody matches that filter."}
            </p>
          ) : null}
        </section>

        {/* ---------- Bulk bar ---------- */}
        {selected.size > 0 ? (
          <div className="sticky bottom-4 flex flex-wrap items-center justify-between gap-3 rounded-card bg-ink px-5 py-4 shadow-dashboard">
            <p className="text-body text-ink-invert">
              <span className="tabular font-medium">{selected.size}</span> selected ·{" "}
              {/* Naming the recipients here is the last chance to notice the
                  toggle is set the wrong way before forty messages go out. */}
              <span className="text-ink-invert-muted">
                {recipients.length === 2
                  ? "employees and HODs"
                  : recipients[0] === "LEAD"
                    ? "HODs only"
                    : "employees only"}
              </span>
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="min-h-11" disabled={running || !configured.whatsapp}
                onClick={() => setConfirm({ channels: ["WHATSAPP"] })}>
                <MessageCircle className="size-4" aria-hidden />
                WhatsApp
              </Button>
              <Button variant="outline" className="min-h-11" disabled={running || !configured.email}
                onClick={() => setConfirm({ channels: ["EMAIL"] })}>
                <Mail className="size-4" aria-hidden />
                Email
              </Button>
              <Button className="min-h-11" disabled={running || !configured.whatsapp || !configured.email}
                onClick={() => setConfirm({ channels: ["WHATSAPP", "EMAIL"] })}>
                Send to {selected.size} selected
              </Button>
            </div>
          </div>
        ) : null}

        {/* ---------- Progress ---------- */}
        {progress ? (
          /* -- ABOVE the bottom navigation, not on top of it.
                At `bottom-0 z-50` this sat over the nav — the inverse of the bug
                FIX-15 fixed, where the bar lost. Burying the navigation during a
                bulk send is worse than it looks: the run takes a minute, and a
                person who wants to leave has nothing to press. -- */
          <div
            className="fixed inset-x-0 bottom-[var(--bottom-nav-h)] z-30 bg-ink px-6 py-4 lg:bottom-0"
            role="status"
            aria-live="polite"
          >
            <div className="mx-auto flex max-w-3xl items-center gap-4">
              <Loader2 aria-hidden className="size-4 shrink-0 animate-spin text-ink-invert" />
              <p className="tabular shrink-0 text-body-sm text-ink-invert">
                {progress.done} of {progress.total}
              </p>
              <div className="h-2 flex-1 overflow-hidden rounded-pill bg-ink-invert/20">
                <span
                  className="block h-full rounded-pill bg-ink-invert transition-all"
                  style={{ width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%` }}
                />
              </div>
            </div>
          </div>
        ) : null}
        </ScreenBody>

        {/* ---------- Dialogs ----------
            Outside `ScreenBody`: a dialog portals to the document anyway, and
            leaving it inside a scroller only invites a stray overflow rule. */}
        <ConfirmSendDialog
          key={`confirm-${confirm?.channels.join("-") ?? "none"}`}
          open={confirm !== null}
          count={selected.size}
          channels={confirm?.channels ?? []}
          recipients={recipients}
          onRecipientsChange={setRecipients}
          onCancel={() => setConfirm(null)}
          onConfirm={() => void run([...selected], confirm?.channels ?? [], recipients)}
        />

        <CopyLinkDialog
          key={`copy-${copyWarning?.evaluationId ?? "none"}${copied ? "-done" : ""}`}
          row={copyWarning}
          copied={copied}
          onCancel={() => {
            setCopyWarning(null);
            setCopied(null);
          }}
          onConfirm={async (layer) => {
            if (!copyWarning) return;
            const result = await issueCopyableLink(copyWarning.evaluationId, layer);
            if (result.ok) setCopied(result.data);
            router.refresh();
          }}
        />

        <FixNumberDialog
          key={`fix-${fixing?.profileId ?? "none"}`}
          row={fixing}
          onCancel={() => setFixing(null)}
          onDone={() => {
            setFixing(null);
            router.refresh();
          }}
        />

        <HistoryDrawer
          key={`history-${history?.evaluationId ?? "none"}`}
          row={history}
          onClose={() => setHistory(null)}
        />
      </TableScreen>
    </TooltipProvider>
  );
}

/* ---------- Contact icons ---------- */

function ContactIcon({
  kind,
  present,
  problem,
  value,
}: {
  kind: "phone" | "email";
  present: boolean;
  problem: string | null;
  value: string | null;
}) {
  const Icon = kind === "phone" ? MessageCircle : Mail;
  const label = kind === "phone" ? "Phone" : "Email";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="relative inline-flex">
          <Icon
            aria-label={
              problem ? `${label}: ${problem}` : present ? `${label}: ${value}` : `No ${label.toLowerCase()}`
            }
            className={cn(
              "size-4",
              problem ? "text-critical" : present ? "text-ink-muted" : "text-ink-faint",
            )}
          />
          {/* Struck through when missing — §13.8: colour is never the only
              signal, and a greyed icon alone is invisible to a lot of people. */}
          {!present ? (
            <span aria-hidden className="absolute left-0 top-1/2 h-px w-4 -rotate-45 bg-ink-faint/60" />
          ) : null}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {problem ?? (present ? value : `No ${label.toLowerCase()} on record`)}
      </TooltipContent>
    </Tooltip>
  );
}

/* ---------- Row menu ---------- */

function RowMenu({
  row,
  configured,
  disabled,
  onSend,
  onSendBoth,
  onSendLead,
  onCopy,
  onHistory,
}: {
  row: DistributionRow;
  configured: { whatsapp: boolean; email: boolean };
  disabled: boolean;
  onSend: (channel: Channel) => void;
  onSendBoth: () => void;
  /** The HOD's rating link — a different person and a different message. */
  onSendLead: () => void;
  onCopy: () => void;
  onHistory: () => void;
}) {
  const canWhatsApp = row.sendable && Boolean(row.phoneE164) && configured.whatsapp;
  const canEmail = row.sendable && Boolean(row.email) && configured.email;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-11" aria-label={`Actions for ${row.name}`}>
          <MoreHorizontal className="size-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem disabled={disabled || !canWhatsApp} onSelect={() => onSend("WHATSAPP")}>
          Send WhatsApp
        </DropdownMenuItem>
        <DropdownMenuItem disabled={disabled || !canEmail} onSelect={() => onSend("EMAIL")}>
          Send email
        </DropdownMenuItem>
        <DropdownMenuItem disabled={disabled || !canWhatsApp || !canEmail} onSelect={() => onSendBoth()}>
          Send both
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* The HOD's own link. Separated by a rule because it goes to a
            DIFFERENT PERSON — the three items above all message the employee,
            and an item that quietly messages somebody else does not belong in
            the same group. Disabled with a reason when nobody is assigned. */}
        <DropdownMenuItem
          disabled={disabled || !row.sendable || !configured.whatsapp}
          onSelect={() => onSendLead()}
        >
          Send the Manager&rsquo;s rating link
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem disabled={!row.sendable} onSelect={() => onCopy()}>
          Copy link
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onHistory()}>View history</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ---------- Dialogs ---------- */

function ConfirmSendDialog({
  open,
  count,
  channels,
  recipients,
  onRecipientsChange,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  count: number;
  channels: Channel[];
  /** Whose links. Chosen HERE, at the moment of sending. */
  recipients: Array<"SELF" | "LEAD">;
  onRecipientsChange: (next: Array<"SELF" | "LEAD">) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const channelText =
    channels.length === 2 ? "WhatsApp and email" : channels[0] === "WHATSAPP" ? "WhatsApp" : "email";

  const who =
    recipients.length === 2
      ? "the employee and their Manager"
      : recipients[0] === "LEAD"
        ? "the Manager only"
        : "the employee only";

  /* -- A CEILING, AND NOW LABELLED AS ONE.
        `people × recipients × channels`. One person with both boxes ticked and
        both channels on is 1 × 2 × 2 = 4, which is arithmetically right and read
        as a surprise — "Send to 1 person?" above "Send 4 messages" invites the
        reader to think something has gone wrong.

        It is also a MAXIMUM rather than a count. A missing contact detail is not
        a failure and nothing is attempted (P11-11), so a HOD with no email
        receives three of these four. The row carries the employee's phone and
        address but not their HOD's, so the exact figure is not knowable on this
        screen — and a number presented as certain when it is an upper bound is
        the kind of thing somebody reconciles against `notifications_log` an hour
        later and reports as a bug.

        So the dialog shows the working instead of only the product. -- */
  const messages = count * channels.length * recipients.length;

  const perPerson = channels.length * recipients.length;
  /* `plural` appends an s, which gives "12 persons". The word is people. */
  const peopleText = count === 1 ? "1 person" : `${count} people`;
  const breakdown = `${peopleText} × ${plural(recipients.length, "recipient")} × ${plural(
    channels.length,
    "channel",
  )}`;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send to {plural(count, "person")}?</DialogTitle>
          <DialogDescription>
            Each recipient gets a fresh link over {channelText}. Any link already sent to that
            person stops working — one live link each, per channel.
          </DialogDescription>
        </DialogHeader>

        {/* ---------- WHO ----------
            Asked at the moment of sending rather than only in the toolbar. The
            toolbar setting is easy to have set the wrong way an hour ago; this
            is the last screen before forty messages go out, so the choice is
            restated here and is changeable without leaving the dialog.

            Both people rate the same form at the same time (§1), and they get
            DIFFERENT messages: the HOD's says only that their form is open and
            when it is due, never whether the employee has submitted (PR-10). */}
        <fieldset className="space-y-2">
          <legend className="type-label pb-1 text-ink-muted">Who receives a link</legend>
          {(
            [
              { value: "SELF" as const, label: "The employee", hint: "Their own self-evaluation." },
              { value: "LEAD" as const, label: "Their Manager", hint: "The rating they fill in about the employee." },
            ]
          ).map((option) => {
            const checked = recipients.includes(option.value);
            return (
              <label
                key={option.value}
                className={cn(
                  "flex min-h-11 cursor-pointer items-start gap-3 rounded-control border p-3",
                  checked ? "border-primary/40 bg-accent" : "border-rule bg-surface",
                )}
              >
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 accent-primary"
                  checked={checked}
                  onChange={(e) =>
                    onRecipientsChange(
                      e.target.checked
                        ? [...new Set([...recipients, option.value])]
                        : // Never empty — a Send button that messages nobody is
                          // worse than a checkbox that will not untick.
                          recipients.length === 1
                          ? recipients
                          : recipients.filter((r) => r !== option.value),
                    )
                  }
                />
                <span>
                  <span className="block text-body text-ink">{option.label}</span>
                  <span className="block text-body-sm text-ink-muted">{option.hint}</span>
                </span>
              </label>
            );
          })}
        </fieldset>

        <div className="rounded-control bg-surface-mute px-3 py-2 text-body-sm text-ink-muted">
          <p className="text-ink">
            Up to {plural(messages, "message")} to {who}, over {channelText}.
          </p>
          <p className="mt-0.5">
            {breakdown}
            {/* "N each" only says something when there is more than one person —
                at a count of one it restates the total and reads as a second,
                contradictory figure. */}
            {count > 1 && perPerson > 1 ? ` — ${plural(perPerson, "message")} each` : null}. Anybody
            missing a number or an address simply gets fewer; nothing is sent to a blank.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" className="min-h-11" onClick={onCancel}>Cancel</Button>
          <Button className="min-h-11" onClick={onConfirm}>
            Send links
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CopyLinkDialog({
  row,
  copied,
  onCancel,
  onConfirm,
}: {
  row: DistributionRow | null;
  copied: { link: string; name: string; layer: "SELF" | "LEAD" } | null;
  onCancel: () => void;
  onConfirm: (layer: "SELF" | "LEAD") => Promise<void>;
}) {
  const [pending, setPending] = React.useState(false);
  /* -- WHOSE LINK. A row has two people on it — the employee and their
        manager — and each has their own form. A single "copy the link" button
        was minting the employee's every time, so a link handed to a manager
        opened a form about themselves and the guard bounced them. -- */
  const [layer, setLayer] = React.useState<"SELF" | "LEAD">("SELF");

  return (
    <Dialog open={row !== null} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {copied
              ? copied.layer === "LEAD"
                ? `Manager’s link for ${copied.name}`
                : `${copied.name}’s own link`
              : "Which link do you need?"}
          </DialogTitle>
          <DialogDescription>
            {copied
              ? copied.layer === "LEAD"
                ? "Send this to their manager. It opens the form for rating this person."
                : "Send this to them. It opens their own self-evaluation."
              : "Each link opens a different form, and creating one stops the previous link of that kind working."}
          </DialogDescription>
        </DialogHeader>

        {!copied && row ? (
          <fieldset className="space-y-2">
            <legend className="type-label mb-1 text-ink-muted">Who is this link for?</legend>
            {([
              { value: "SELF", label: `${row.name} — their own self-evaluation` },
              // Not named: this board's rows are about the EMPLOYEE and carry no
              // lead. Fetching one for a label would be a query per row for a
              // dialog most people never open.
              { value: "LEAD", label: `Their manager — to rate ${row.name}` },
            ] as const).map((option) => (
              <label
                key={option.value}
                className="flex min-h-11 cursor-pointer items-center gap-3 rounded-control border border-rule px-3"
              >
                <input
                  type="radio"
                  name="copy_layer"
                  value={option.value}
                  checked={layer === option.value}
                  onChange={() => setLayer(option.value)}
                  className="size-4"
                />
                <span className="font-sans text-body-sm text-ink">{option.label}</span>
              </label>
            ))}
          </fieldset>
        ) : null}

        {copied ? (
          <div className="space-y-2">
            <Input readOnly value={copied.link} className="font-mono text-body-sm" onFocus={(e) => e.currentTarget.select()} />
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => void navigator.clipboard.writeText(copied.link)}
            >
              <Copy className="size-4" aria-hidden />
              Copy to clipboard
            </Button>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" className="min-h-11" onClick={onCancel}>
            {copied ? "Done" : "Cancel"}
          </Button>
          {!copied ? (
            <Button
              className="min-h-11"
              disabled={pending}
              onClick={async () => {
                setPending(true);
                await onConfirm(layer);
                setPending(false);
              }}
            >
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Create link
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FixNumberDialog({
  row,
  onCancel,
  onDone,
}: {
  row: DistributionRow | null;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [value, setValue] = React.useState(row?.phoneRaw ?? "");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  return (
    <Dialog open={row !== null} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Fix {row?.name}&rsquo;s number</DialogTitle>
          <DialogDescription>{row?.phoneError?.message}</DialogDescription>
        </DialogHeader>

        <div>
          <Label htmlFor="fix-phone">Phone number</Label>
          <Input
            id="fix-phone"
            className="mt-1.5"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <p className="mt-1.5 text-body-sm text-ink-muted">
            Ten digits is enough — +91 is added automatically.
          </p>
        </div>

        {error ? <p role="alert" className="text-body-sm text-critical">{error}</p> : null}

        <DialogFooter>
          <Button variant="outline" className="min-h-11" onClick={onCancel} disabled={pending}>Cancel</Button>
          <Button
            className="min-h-11"
            disabled={pending}
            onClick={async () => {
              if (!row) return;
              setPending(true);
              setError(null);
              const result = await updatePhone(row.profileId, value);
              setPending(false);
              if (result.ok) onDone();
              else setError(result.error.message);
            }}
          >
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
