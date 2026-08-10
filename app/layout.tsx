/** Root layout: font loading, global tokens, and the base document shell. */

import type { Metadata } from "next";
import Script from "next/script";
import { Inter } from "next/font/google";

import { THEME_SCRIPT } from "@/components/appraise/theme";
import { Toaster } from "@/components/ui/sonner";

import "./globals.css";

/* ---------- Font (DESIGN.md §3) ---------- */
// One family across the whole application. Weight does the hierarchy work —
// 700 for hero numbers, 600 for headings, 400 for body — so there is no second
// face to load, no serif/sans mismatch, and no separate mono for numerals:
// Inter's tabular figures are enabled in globals.css instead.
const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Appraise",
    template: "%s · Appraise",
  },
  description: "Performance evaluation platform for LinkD Prints.",
  // Internal tool; it should never be indexed.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} h-full`}
      // Defaults matching the markup, so the server HTML and the pre-paint
      // script agree when storage is empty. suppressHydrationWarning because
      // the script legitimately rewrites both before React ever sees them.
      data-theme="light"
      data-rail="open"
      suppressHydrationWarning
    >
      <head>
        {/* -- Render-blocking on purpose. Applying the stored theme after
              hydration means a dark-theme user gets a full-brightness flash on
              every page load, and a collapsed rail makes the layout jump. Both
              have to be settled before the first paint, which React cannot do
              (UI2-2).

              `next/script` with `beforeInteractive` rather than a bare
              `<script>`. React 19 warns on the bare tag — "Scripts inside React
              components are never executed when rendering on the client" — and
              the warning is accurate rather than pedantic: the tag runs on the
              server-rendered document and does NOT run again on a client
              navigation. That is survivable here only because the attributes it
              sets persist on <html> across those navigations; it would be a
              real bug for any script that had to run per page.

              `beforeInteractive` is Next's supported form for exactly this
              case, is only valid in the root layout, and keeps the script ahead
              of first paint. Not a new dependency (§17) — `next/script` ships
              with the framework. -- */}
        <Script id="theme" strategy="beforeInteractive">
          {THEME_SCRIPT}
        </Script>
      </head>
      {/* Background, ink, font and antialiasing are all set on `body` in
          globals.css, so print routes inherit the same base. */}
      <body className="min-h-full">
        {children}
        <Toaster position="top-right" />
      </body>
    </html>
  );
}
