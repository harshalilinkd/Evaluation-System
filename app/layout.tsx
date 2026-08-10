/** Root layout: font loading, global tokens, and the base document shell. */

import type { Metadata } from "next";
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

              REACT 19 WARNS ABOUT THIS TAG IN DEVELOPMENT AND THE WARNING IS
              NOISE HERE. "Scripts inside React components are never executed
              when rendering on the client" is true and irrelevant: this one
              only ever needs to run on the server-rendered document, and the
              attributes it sets live on <html> and survive every client
              navigation afterwards.

              `next/script` with `beforeInteractive` was tried and warns
              identically — it renders the same element — so it bought
              indirection and nothing else. Reverted.

              REMOVING THE SCRIPT ENTIRELY WOULD COST SOMETHING REAL. The only
              way is to resolve the theme server-side from a cookie, and the
              server cannot evaluate `prefers-color-scheme` — so a first-ever
              visitor whose system is dark would get exactly the
              full-brightness flash this exists to prevent. A dev-only console
              line is the cheaper of the two. -- */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
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
