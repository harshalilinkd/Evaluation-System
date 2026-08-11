"use client";

/** Your signature, as it appears on sheets you have approved. */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { saveMySignature } from "@/lib/auth/signature-actions";

/* -- The two limits, kept where the person meets them.
      300KB before encoding, because base64 adds a third and 0065's CHECK
      refuses anything past 400,000 characters. Rejecting a file here with a
      sentence beats a constraint violation from four layers down. -- */
const MAX_BYTES = 300 * 1024;
const ACCEPT = ["image/png", "image/jpeg", "image/gif"];

export function SignatureCard({ initial }: { initial: string | null }) {
  const router = useRouter();
  const [image, setImage] = React.useState<string | null>(initial);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  async function choose(file: File) {
    setError(null);

    // Both refusals name the fix rather than the rule (§13.4).
    if (!ACCEPT.includes(file.type)) {
      setError("That is not a PNG, JPEG or GIF. Export or screenshot the signature and try again.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(
        `That image is ${Math.round(file.size / 1024)}KB. Signatures should be under 300KB — a photograph of paper is usually far larger than a cropped scan.`,
      );
      return;
    }

    const dataUri = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("read failed"));
      reader.readAsDataURL(file);
    }).catch(() => null);

    if (!dataUri) {
      setError("That file could not be read. Try a different one.");
      return;
    }

    setBusy(true);
    const result = await saveMySignature(dataUri);
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setImage(dataUri);
    router.refresh();
  }

  async function remove() {
    setBusy(true);
    setError(null);
    const result = await saveMySignature(null);
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setImage(null);
    router.refresh();
  }

  return (
    <section className="card-surface space-y-4 p-5">
      <div>
        <h3 className="font-sans text-body-lg text-ink">Your signature</h3>
        <p className="mt-1 max-w-prose font-sans text-body-sm text-ink-muted">
          Shown on printed sheets you have approved, above your name. Your name,
          the outcome and the date are already recorded and printed whether or
          not you add an image — this only replaces the ruled line with your
          own hand.
        </p>
      </div>

      {/* -- The preview is on WHITE, always, in both themes. It is how the
            signature will print, and a dark-mode preview of a black-ink
            signature would show almost nothing and read as a failed upload. -- */}
      {image ? (
        <div className="flex flex-wrap items-end gap-4">
          <div className="rounded-card border border-rule bg-white p-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- a data URI;
                the optimiser has nothing to fetch and would defer the one
                element the card exists to show. */}
            <img src={image} alt="Your signature" className="h-16 w-auto max-w-[240px] object-contain" />
          </div>
          <Button
            variant="ghost"
            onClick={() => void remove()}
            disabled={busy}
            className="min-h-11 text-critical hover:text-critical"
          >
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Trash2 className="size-4" aria-hidden />}
            Remove
          </Button>
        </div>
      ) : (
        <p className="font-sans text-body-sm text-ink-muted">
          No signature yet. Sheets you approve print a ruled line for a wet signature.
        </p>
      )}

      <div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT.join(",")}
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Cleared so choosing the SAME file again still fires a change.
            e.target.value = "";
            if (file) void choose(file);
          }}
        />
        <Button variant="secondary" onClick={() => inputRef.current?.click()} disabled={busy} className="min-h-11">
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Upload className="size-4" aria-hidden />}
          {image ? "Replace" : "Upload a signature"}
        </Button>
        <p className="mt-1.5 font-sans text-body-sm text-ink-muted">
          PNG, JPEG or GIF, under 300KB. A cropped scan on white reads best.
        </p>
      </div>

      {error ? (
        <p role="alert" className="font-sans text-body-sm text-critical">
          {error}
        </p>
      ) : null}
    </section>
  );
}
