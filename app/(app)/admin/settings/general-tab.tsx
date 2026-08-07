"use client";

/** Settings → General. Business-wide defaults that used to need a SQL console. */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";

import { SectionCard } from "@/components/appraise/section-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveHikeBands } from "@/lib/increment/actions";
import { cn } from "@/lib/utils";

/**
 * The quick-set increment percentages.
 *
 * P21 made these configurable and stored them, but nothing rendered an editor —
 * so changing the three buttons HR presses on every salary review meant an
 * UPDATE against `increment_settings`. This is that editor.
 */
export function GeneralTab({ hikeBands }: { hikeBands: number[] }) {
  const router = useRouter();
  const [bands, setBands] = React.useState<string[]>(
    hikeBands.length > 0 ? hikeBands.map(String) : ["5", "10", "15"],
  );
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const parsed = bands.map((b) => Number(b)).filter((n) => Number.isFinite(n) && n >= 0);
  const valid = parsed.length === bands.length && parsed.length >= 1 && parsed.length <= 6;

  async function onSave() {
    setBusy(true);
    setMessage(null);
    const result = await saveHikeBands(parsed);
    setBusy(false);
    if (!result.ok) setMessage({ tone: "error", text: result.error.message });
    else {
      setMessage({ tone: "ok", text: "Saved. The salary review uses these now." });
      router.refresh();
    }
  }

  return (
    <div className="space-y-8">
      <SectionCard
        title="Increment quick-set bands"
        description="The percentages offered as buttons on a salary review. They are a starting point, never a limit — HR can always type any figure."
      >
        <div className="max-w-form space-y-5">
          {message ? (
            <p
              role={message.tone === "error" ? "alert" : "status"}
              className={cn(
                "rounded-control border px-3 py-2 font-sans text-body-sm",
                message.tone === "error"
                  ? "border-critical/40 bg-critical-tint text-critical"
                  : "border-final/40 bg-final-tint text-final",
              )}
            >
              {message.text}
            </p>
          ) : null}

          <div className="space-y-3">
            <Label className="type-label text-ink-muted">Percentages</Label>
            <div className="flex flex-wrap items-center gap-2">
              {bands.map((band, index) => (
                <span key={index} className="flex items-center gap-1">
                  <Input
                    value={band}
                    onChange={(e) =>
                      setBands((prev) => prev.map((b, i) => (i === index ? e.target.value : b)))
                    }
                    inputMode="decimal"
                    aria-label={`Band ${index + 1}`}
                    className="min-h-11 w-20 tabular"
                  />
                  <span className="font-sans text-body text-ink-muted">%</span>
                  {bands.length > 1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove band ${index + 1}`}
                      onClick={() => setBands((prev) => prev.filter((_, i) => i !== index))}
                    >
                      <X className="size-4" aria-hidden />
                    </Button>
                  ) : null}
                </span>
              ))}

              {bands.length < 6 ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setBands((prev) => [...prev, ""])}
                >
                  <Plus className="mr-1 size-4" aria-hidden />
                  Add one
                </Button>
              ) : null}
            </div>
            <p className="font-sans text-body-sm text-ink-faint">
              Between one and six. Stored as data, so adding a fourth band is a change here rather
              than a change to the code.
            </p>
          </div>

          {/* §13.4: the disabled state says why, beside the control. */}
          <span className="flex flex-wrap items-center gap-3">
            <Button type="button" className="min-h-11" disabled={busy || !valid} onClick={onSave}>
              {busy ? "Saving…" : "Save bands"}
            </Button>
            {!valid ? (
              <span className="font-sans text-body-sm text-critical">
                Every box needs a number, and there must be between one and six.
              </span>
            ) : null}
          </span>
        </div>
      </SectionCard>

      <SectionCard
        title="Other settings"
        description="Where the rest lives, so nothing is hunted for."
      >
        <ul className="space-y-2 font-sans text-body-sm text-ink-muted">
          <li>
            <span className="text-ink">Message wording, the log and the pause switch</span> — the
            Messages tab.
          </li>
          <li>
            <span className="text-ink">Disclosure and the flagging threshold</span> — set per cycle,
            in the cycle wizard, because they are a decision about that cycle rather than about the
            company.
          </li>
          <li>
            <span className="text-ink">Questions and department mapping</span> — Form Builder.
          </li>
        </ul>
      </SectionCard>
    </div>
  );
}
