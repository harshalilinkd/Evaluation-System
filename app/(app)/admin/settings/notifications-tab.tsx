"use client";

/** Settings → Messages. The pause switch, what went out, and what each one says. */

import * as React from "react";
import { useRouter } from "next/navigation";
import { BellOff, BellRing, PlugZap, Search } from "lucide-react";

import { SectionCard } from "@/components/appraise/section-card";
import { EmptyState } from "@/components/appraise/states";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import {
  checkEmailTransport,
  setOutboundPaused,
  type EmailCheck,
  type MessageLog,
  type OutboundState,
} from "@/lib/notify/settings";
import type { EditableTemplate, TemplateProblem } from "@/lib/notify/overrides";
import { resetTemplate, saveTemplate } from "@/lib/notify/template-actions";
import { formatDateTime } from "@/lib/utils/date";
import { cn } from "@/lib/utils";

const SELECT_CLASS =
  "min-h-11 rounded-input border border-rule bg-surface px-3 font-sans text-body-sm text-ink";

/** Plain language, per §13.5 — nobody should read a status enum. */
const STATUS_LABELS: Record<string, string> = {
  QUEUED: "Waiting",
  SENT: "Sent",
  FAILED: "Failed",
  OPENED: "Opened",
};

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "FAILED"
      ? "border-critical/40 bg-critical-tint text-critical"
      : status === "QUEUED"
        ? "border-rule bg-surface-mute text-ink-muted"
        /* -- Sent is a DELIVERY STATE, not a layer. It wore `final`, which
              §13.1 reserves for "the MD said this" — so a message log read as
              though every delivered row carried an MD decision. Green is the
              done colour and is deliberately not a tier (UI2-2). -- */
        : "border-success/40 bg-success-tint text-success";

  return (
    <span className={cn("type-label rounded-pill border px-2 py-1", tone)}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

/* ---------- The template editor ---------- */

/**
 * One template, editable.
 *
 * KEYED ON THE TEMPLATE KEY by the caller, so switching templates REMOUNTS this
 * rather than syncing props into state — the pattern this codebase has settled
 * on since P8-9, and the one the React compiler accepts. A reset effect would
 * also render once with the previous template's words showing.
 */
function TemplateEditor({ template }: { template: EditableTemplate }) {
  const router = useRouter();
  const [subject, setSubject] = React.useState(template.subject);
  const [body, setBody] = React.useState(template.body);
  const [busy, setBusy] = React.useState(false);
  const [problems, setProblems] = React.useState<TemplateProblem[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  const dirty = subject !== template.subject || body !== template.body;
  const problemFor = (field: "subject" | "body") =>
    problems.filter((p) => p.field === field).map((p) => p.message);

  async function save() {
    setBusy(true);
    setError(null);
    setProblems([]);
    const result = await saveTemplate({ key: template.key, subject, body });
    setBusy(false);
    if (result.ok) {
      setSaved(true);
      router.refresh();
      return;
    }
    setError(result.message);
    setProblems(result.problems ?? []);
  }

  async function reset() {
    setBusy(true);
    setError(null);
    const result = await resetTemplate(template.key);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    router.refresh();
  }

  /* -- READ-ONLY, AND IT SAYS WHY.
        Four templates cannot be reworded — the three digests build a list when
        they are sent, and the closing message changes with the cycle's
        disclosure setting. A field that silently refuses to save reads as a
        fault; a panel that names the reason reads as a decision (§13.4). -- */
  if (!template.editable) {
    return (
      <div className="space-y-3 rounded-control border border-rule bg-surface-mute p-5">
        <div>
          <p className="type-label text-ink-muted">Subject</p>
          <p className="font-sans text-body text-ink">{template.subject}</p>
        </div>
        <div>
          <p className="type-label text-ink-muted">Message</p>
          <p className="whitespace-pre-wrap font-sans text-body text-ink">{template.body}</p>
        </div>
        <p className="rounded-control border-l-2 border-warning bg-warning-tint p-3 font-sans text-body-sm text-ink">
          This wording cannot be changed. {template.lockedBecause}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-control border border-rule bg-surface-mute p-5">
      <div className="space-y-2">
        <Label htmlFor="tpl_subject" className="type-label text-ink-muted">
          Subject <span className="font-normal normal-case">(email only)</span>
        </Label>
        <Input
          id="tpl_subject"
          value={subject}
          onChange={(event) => {
            setSubject(event.target.value);
            setSaved(false);
          }}
          className="min-h-11 bg-surface"
        />
        {problemFor("subject").map((message) => (
          <p key={message} className="font-sans text-body-sm text-critical">
            {message}
          </p>
        ))}
      </div>

      <div className="space-y-2">
        <Label htmlFor="tpl_body" className="type-label text-ink-muted">
          Message
        </Label>
        <Textarea
          id="tpl_body"
          value={body}
          onChange={(event) => {
            setBody(event.target.value);
            setSaved(false);
          }}
          rows={14}
          className="bg-surface font-sans text-body"
        />
        {problemFor("body").map((message) => (
          <p key={message} className="font-sans text-body-sm text-critical">
            {message}
          </p>
        ))}
      </div>

      {/* -- WHAT MAY BE TYPED, listed rather than left to be guessed.
            Anything else is refused at save, so naming them here is the
            difference between a hint and a dead end. -- */}
      <div className="rounded-control border border-rule bg-surface p-3">
        <p className="type-label text-ink-muted">Things you can drop in</p>
        <ul className="mt-2 space-y-1">
          {template.placeholders.map((p) => (
            <li key={p.token} className="font-sans text-body-sm text-ink-muted">
              <code className="rounded bg-surface-mute px-1.5 py-0.5 text-ink">{p.token}</code>{" "}
              — {p.describes}
            </li>
          ))}
        </ul>
        <p className="mt-3 font-sans text-body-sm text-ink-muted">
          Do not paste a web address — write <code>{"{their personal link}"}</code> where the link
          should go and it is added when the message is sent. Wrap a line in *asterisks* to make it
          bold on WhatsApp.
        </p>
      </div>

      {error ? (
        <p role="alert" className="font-sans text-body-sm text-critical">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={save} disabled={busy || !dirty}>
          {busy ? "Saving…" : "Save wording"}
        </Button>
        {template.customised ? (
          <Button type="button" variant="ghost" onClick={reset} disabled={busy}>
            Back to the original
          </Button>
        ) : null}
        {saved && !dirty ? (
          <span className="font-sans text-body-sm text-ink-muted">Saved.</span>
        ) : null}
      </div>

      <p className="font-sans text-body-sm text-ink-muted">
        Your wording is used for both WhatsApp and email. The email keeps its header, button and
        sign-off — only the words are yours.
      </p>
    </div>
  );
}

export function NotificationsTab({
  state,
  log,
  templates,
}: {
  state: OutboundState;
  log: MessageLog;
  templates: EditableTemplate[];
}) {
  const router = useRouter();
  const [dialog, setDialog] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [status, setStatus] = React.useState("");
  const [channel, setChannel] = React.useState("");
  const [template, setTemplate] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [preview, setPreview] = React.useState(templates[0]?.key ?? "");

  const rows = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    return log.rows.filter((r) => {
      if (status && r.status !== status) return false;
      if (channel && r.channel !== channel) return false;
      if (template && r.template !== template) return false;
      if (needle) {
        const hay = `${r.personName ?? ""} ${r.recipient}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [log.rows, status, channel, template, search]);

  async function onToggle() {
    setBusy(true);
    setError(null);
    const result = await setOutboundPaused({ paused: !state.paused, reason });
    setBusy(false);
    if (!result.ok) setError(result.error.message);
    else {
      setDialog(false);
      setReason("");
      router.refresh();
    }
  }

  const shown = templates.find((t) => t.key === preview);

  return (
    <div className="space-y-8">
      <EmailTransportCard />
      {/* ---------- The switch ---------- */}
      <SectionCard
        title="Outbound messages"
        description="One switch over every WhatsApp and email the system sends."
      >
        <div
          className={cn(
            "flex flex-wrap items-start justify-between gap-4 rounded-control border p-5",
            state.paused
              ? "border-critical/40 bg-critical-tint"
              : "border-final/40 bg-final-tint",
          )}
        >
          <div className="space-y-1">
            <p
              className={cn(
                "flex items-center gap-2 font-sans text-body font-medium",
                state.paused ? "text-critical" : "text-final",
              )}
            >
              {state.paused ? (
                <BellOff className="size-4" aria-hidden />
              ) : (
                <BellRing className="size-4" aria-hidden />
              )}
              {state.paused ? "Messages are paused" : "Messages are going out normally"}
            </p>

            <p className="font-sans text-body-sm text-ink-muted">
              {state.paused
                ? "Nothing is being delivered. Everything raised while paused is kept as Waiting and can be retried once you resume."
                : "Invites, reminders and digests are delivered as they are raised."}
            </p>

            {state.paused && state.reason ? (
              <p className="font-sans text-body-sm text-ink-muted">
                &ldquo;{state.reason}&rdquo;
                {state.pausedByName ? ` — ${state.pausedByName}` : ""}
                {state.pausedAt ? `, ${formatDateTime(state.pausedAt)}` : ""}
              </p>
            ) : null}
          </div>

          <Button
            type="button"
            variant={state.paused ? "default" : "secondary"}
            className="min-h-11"
            onClick={() => {
              setReason("");
              setError(null);
              setDialog(true);
            }}
          >
            {state.paused ? "Resume sending" : "Pause everything"}
          </Button>
        </div>
      </SectionCard>

      {/* ---------- What went out ---------- */}
      <SectionCard
        title="What went out"
        description={`The last ${log.rows.length} messages. ${log.failed} failed, ${log.queued} waiting.`}
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
                aria-hidden
              />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or number"
                aria-label="Search messages"
                className="min-h-11 pl-9 sm:w-64"
              />
            </span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              aria-label="Filter by outcome"
              className={SELECT_CLASS}
            >
              <option value="">Any outcome</option>
              {["SENT", "FAILED", "QUEUED", "OPENED"].map((s) => (
                <option key={s} value={s}>{STATUS_LABELS[s] ?? s}</option>
              ))}
            </select>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              aria-label="Filter by channel"
              className={SELECT_CLASS}
            >
              <option value="">Both channels</option>
              <option value="WHATSAPP">WhatsApp</option>
              <option value="EMAIL">Email</option>
            </select>
            <select
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              aria-label="Filter by message"
              className={SELECT_CLASS}
            >
              <option value="">Every message</option>
              {log.templates.map((t) => (
                <option key={t} value={t}>
                  {templates.find((x) => x.key === t)?.label ?? t}
                </option>
              ))}
            </select>
          </div>

          {rows.length === 0 ? (
            <EmptyState
              title={log.rows.length === 0 ? "Nothing has been sent yet" : "Nothing matches"}
              body={
                log.rows.length === 0
                  ? "Messages appear here as invites, reminders and digests go out."
                  : "Clear a filter and try again."
              }
            />
          ) : (
            <div className="-mx-6 overflow-x-auto">
              <table className="w-full min-w-[820px] border-collapse">
                <thead>
                  <tr className="border-b border-rule bg-surface-mute">
                    {["When", "Who", "Message", "Channel", "Outcome"].map((h) => (
                      <th key={h} className="type-label px-6 py-2 text-left font-bold text-ink">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-rule last:border-b-0">
                      <td className="px-6 py-3 tabular text-body-sm text-ink-muted">
                        {formatDateTime(row.createdAt)}
                      </td>
                      <td className="px-6 py-3">
                        <span className="block font-sans text-body-sm text-ink">
                          {row.personName ?? "—"}
                        </span>
                        <span className="block tabular text-body-sm text-ink-muted">
                          {row.recipient}
                        </span>
                      </td>
                      <td className="px-6 py-3 font-sans text-body-sm text-ink-muted">
                        {templates.find((t) => t.key === row.template)?.label ?? row.template}
                      </td>
                      <td className="px-6 py-3 font-sans text-body-sm text-ink-muted">
                        {row.channel === "WHATSAPP" ? "WhatsApp" : "Email"}
                      </td>
                      <td className="px-6 py-3">
                        <span className="flex flex-col items-start gap-1">
                          <StatusPill status={row.status} />
                          {row.error ? (
                            // The provider's own words. Paraphrasing a delivery
                            // failure is how somebody chases the wrong problem.
                            <span className="font-sans text-body-sm text-critical">{row.error}</span>
                          ) : null}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </SectionCard>

      {/* ---------- What each message says ---------- */}
      <SectionCard
        title="What each message says"
        description="The wording that goes out. Edit any of these to say it in your own words — names, dates and links are filled in when the message is sent."
      >
        <div className="grid gap-6 md:grid-cols-[16rem_1fr]">
          <ul className="space-y-1">
            {templates.map((t) => (
              <li key={t.key}>
                <button
                  type="button"
                  onClick={() => setPreview(t.key)}
                  className={cn(
                    "flex min-h-11 w-full items-center justify-between gap-2 rounded-control px-3 text-left font-sans text-body-sm",
                    preview === t.key
                      ? "bg-accent text-primary"
                      : "text-ink-muted hover:bg-surface-mute",
                  )}
                >
                  <span>{t.label}</span>
                  {/* -- A WORD, not a coloured dot (§13.8). "Edited" is the one
                        thing somebody scanning this list needs to know, because
                        it is what tells them why a message does not match the
                        wording they remember. -- */}
                  {t.customised ? (
                    <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                      Edited
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>

          {shown ? <TemplateEditor key={shown.key} template={shown} /> : null}
        </div>
      </SectionCard>

      {/* ---------- The confirmation ---------- */}
      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{state.paused ? "Resume sending" : "Pause everything"}</DialogTitle>
            <DialogDescription>
              {state.paused
                ? "Messages will start going out again immediately. Anything queued while paused stays queued — retry it from the distribution screen."
                : "Every WhatsApp and email stops until you resume. Nothing is lost: messages raised while paused are recorded as Waiting."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="pause_reason" className="type-label text-ink-muted">
              Reason
            </Label>
            <Textarea
              id="pause_reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder={state.paused ? "Why is it safe to resume?" : "Why are you pausing?"}
            />
            <p className="font-sans text-body-sm text-ink-muted">
              Recorded against your name. &ldquo;Why is everything silent?&rdquo; is a question
              somebody asks days later.
            </p>
            {error ? (
              <p role="alert" className="font-sans text-body-sm text-critical">
                {error}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialog(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={onToggle} disabled={busy || reason.trim().length < 5}>
              {busy ? "Working…" : state.paused ? "Resume" : "Pause"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ---------- Is email going to work? ---------- */
//
// Module scope, not defined inside NotificationsTab: a component created during
// render is a new type every render, so the subtree remounts and the filter
// inputs below would lose focus mid-keystroke (P14-12).
//
// This sits ABOVE the log because it answers the question somebody has BEFORE
// they send anything, and the log only answers it afterwards — by which point
// 47 messages have already been logged as failed attempts.
function EmailTransportCard() {
  const [result, setResult] = React.useState<EmailCheck | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function run() {
    setBusy(true);
    const outcome = await checkEmailTransport();
    setBusy(false);
    setResult(
      outcome.ok
        ? outcome.data
        : { transport: null, account: null, ok: false, message: outcome.error.message },
    );
  }

  return (
    <SectionCard
      title="Email delivery"
      description="Which account mail goes out from, and whether the credentials work."
    >
      <div className="space-y-3">
        <p className="text-body-sm text-ink-muted">
          WhatsApp sends independently of this. Email needs either a Google account over SMTP or a
          Resend key — whichever is set in the environment is the one used.
        </p>

        <Button type="button" variant="outline" onClick={() => void run()} disabled={busy}>
          <PlugZap aria-hidden className="size-4" />
          {busy ? "Checking…" : "Check the connection"}
        </Button>

        {result ? (
          <div
            role="status"
            aria-live="polite"
            className={cn(
              "space-y-1 rounded-card border p-4",
              result.ok ? "border-success/40 bg-success-tint" : "border-critical/40 bg-critical-tint",
            )}
          >
            <p className="text-body-sm font-semibold text-ink">
              {result.transport === "SMTP"
                ? `SMTP${result.account ? ` · ${result.account}` : ""}`
                : result.transport === "RESEND"
                  ? "Resend"
                  : "Not configured"}
            </p>
            {/* The provider's own wording, translated only where it sends people
                to the wrong fix — a rejected App Password reads as a bad account
                password, which it is not. */}
            <p className="text-body-sm text-ink">{result.message}</p>
            {result.transport === "SMTP" && result.ok ? (
              <p className="text-body-sm text-ink-muted">
                This proves the account and password. It does not prove a particular recipient will
                accept the mail.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}
