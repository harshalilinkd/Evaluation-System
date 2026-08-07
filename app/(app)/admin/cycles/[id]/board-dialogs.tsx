"use client";

/** Post-launch edits. P10 edge cases — each one audited, none of them silent. */

import * as React from "react";
import { Loader2 } from "lucide-react";

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
import { excludeParticipant, reassignLead, updateCycle } from "@/lib/cycles/actions";
import type { SelectablePerson } from "@/lib/cycles/queries";
import { today } from "@/lib/cycles/schema";
import { formatDate } from "@/lib/utils/date";

type Target = { id: string; name: string } | null;

/* ---------- Reassign a lead ---------- */

export function ReassignDialog({
  target,
  candidates,
  onClose,
  onDone,
}: {
  target: Target;
  candidates: SelectablePerson[];
  onClose: () => void;
  onDone: () => void;
}) {
  // Fields start empty and stay that way for one target. Resetting them in an
  // effect when `target` changes is the cascading-render pattern the compiler
  // rejects; the caller keys this component on the target instead, so a new
  // person gets a genuinely new component rather than an old one being wiped.
  const [leadId, setLeadId] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notify, setNotify] = React.useState<{ old: string | null; next: string } | null>(null);

  const submit = async () => {
    if (!target || !leadId || !reason.trim()) return;
    setPending(true);
    setError(null);

    const result = await reassignLead(target.id, leadId, reason.trim());
    setPending(false);

    if (!result.ok) {
      setError(result.error.message);
      return;
    }

    // The automatic notification lands in P11 with notifications_log. Until
    // then the two names are shown so HR can tell them, rather than the app
    // pretending a message went out.
    const nameOf = (id: string | null) => candidates.find((c) => c.id === id)?.name ?? null;
    setNotify({ old: nameOf(result.data.oldLeadId), next: nameOf(result.data.newLeadId) ?? "the new lead" });
  };

  return (
    <Dialog open={Boolean(target)} onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reassign {target?.name}&rsquo;s lead</DialogTitle>
          <DialogDescription>
            Allowed until the review is written. After that the lead&rsquo;s name is attached to what
            they wrote and cannot be swapped.
          </DialogDescription>
        </DialogHeader>

        {notify ? (
          <div className="space-y-3">
            <p className="rounded-control bg-success-tint px-3 py-2 text-body-sm text-ink">
              Reassigned and logged.
            </p>
            <p className="text-body-sm text-ink-muted">
              Automatic notifications arrive with the distribution phase. For now, please tell{" "}
              <span className="font-medium text-ink">{notify.next}</span>
              {notify.old ? (
                <>
                  {" "}
                  that they have a new review, and{" "}
                  <span className="font-medium text-ink">{notify.old}</span> that they no longer do.
                </>
              ) : (
                " that they have a new review."
              )}
            </p>
            <DialogFooter>
              <Button type="button" className="min-h-11" onClick={onDone}>
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <div className="space-y-4">
              <div>
                <Label htmlFor="new-lead">New lead</Label>
                <select
                  id="new-lead"
                  value={leadId}
                  onChange={(e) => setLeadId(e.target.value)}
                  className="mt-1.5 h-11 w-full rounded-input border border-rule bg-surface px-3 text-body text-ink"
                >
                  <option value="">Choose someone</option>
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <Label htmlFor="reassign-reason">Reason</Label>
                <Textarea
                  id="reassign-reason"
                  className="mt-1.5"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Why the review is moving. This goes on the audit trail."
                  required
                />
              </div>
            </div>

            {error ? (
              <p role="alert" className="rounded-control bg-critical-tint px-3 py-2 text-body-sm text-critical">
                {error}
              </p>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" className="min-h-11" onClick={onClose} disabled={pending}>
                Cancel
              </Button>
              <Button
                type="button"
                className="min-h-11"
                disabled={!leadId || !reason.trim() || pending}
                onClick={() => void submit()}
              >
                {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                Reassign
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Withdraw somebody ---------- */

export function WithdrawDialog({
  target,
  onClose,
  onDone,
}: {
  target: Target;
  onClose: () => void;
  onDone: () => void;
}) {
  // Keyed on the target by the caller — see the note in ReassignDialog.
  const [reason, setReason] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const submit = async () => {
    if (!target || !reason.trim()) return;
    setPending(true);
    setError(null);

    const result = await excludeParticipant(target.id, reason.trim());
    setPending(false);

    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    onDone();
  };

  return (
    <Dialog open={Boolean(target)} onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Withdraw {target?.name} from this cycle?</DialogTitle>
          <DialogDescription>
            Their evaluation is archived, not deleted — anything already answered is kept and stays
            readable. They will not appear on the board or in the counts.
          </DialogDescription>
        </DialogHeader>

        <div>
          <Label htmlFor="withdraw-reason">Reason</Label>
          <Textarea
            id="withdraw-reason"
            className="mt-1.5"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Left the company, on long leave, joined after the cycle opened…"
            required
          />
        </div>

        {error ? (
          <p role="alert" className="rounded-control bg-critical-tint px-3 py-2 text-body-sm text-critical">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" className="min-h-11" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            type="button"
            className="min-h-11"
            disabled={!reason.trim() || pending}
            onClick={() => void submit()}
          >
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Withdraw
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Extend the deadlines ---------- */

export function ExtendDatesDialog({
  open,
  cycle,
  onClose,
  onDone,
}: {
  open: boolean;
  cycle: { id: string; selfDueOn: string | null; leadDueOn: string | null; mdDueOn: string | null };
  onClose: () => void;
  onDone: () => void;
}) {
  // Seeded from the cycle's current dates. Keyed on `open` by the caller, so
  // reopening after a save picks up the newly saved values rather than needing
  // an effect to copy them across.
  const [dates, setDates] = React.useState({
    self_due_on: cycle.selfDueOn ?? "",
    lead_due_on: cycle.leadDueOn ?? "",
    md_due_on: cycle.mdDueOn ?? "",
  });
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const submit = async () => {
    setPending(true);
    setError(null);
    const result = await updateCycle(cycle.id, dates);
    setPending(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    onDone();
  };

  const fields = [
    ["self_due_on", "Self-evaluation due", cycle.selfDueOn],
    ["lead_due_on", "Lead review due", cycle.leadDueOn],
    ["md_due_on", "MD decision due", cycle.mdDueOn],
  ] as const;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Extend the deadlines</DialogTitle>
          <DialogDescription>
            Deadlines can only move later. Pulling one back would make submissions late that were on
            time when they were made.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {fields.map(([field, label, current]) => (
            <div key={field}>
              <Label htmlFor={field}>{label}</Label>
              <Input
                id={field}
                type="date"
                className="mt-1.5 max-w-56"
                // Floored at whichever is later: the current value or today. The
                // server enforces the same rule (§9); this just means the picker
                // does not offer a date that will be refused.
                min={current && current > today() ? current : today()}
                value={dates[field]}
                onChange={(e) => setDates({ ...dates, [field]: e.target.value })}
              />
              <p className="tabular mt-1 text-body-sm text-ink-muted">
                Currently {formatDate(current)}
              </p>
            </div>
          ))}
        </div>

        {error ? (
          <p role="alert" className="rounded-control bg-critical-tint px-3 py-2 text-body-sm text-critical">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" className="min-h-11" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" className="min-h-11" disabled={pending} onClick={() => void submit()}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Save dates
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
