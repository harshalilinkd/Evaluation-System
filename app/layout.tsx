/** Root layout: font loading, global tokens, and the base document shell. */

import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Inter } from "next/font/google";

import { RAIL_STORAGE_KEY, THEME_STORAGE_KEY } from "@/components/appraise/theme";
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

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const store = await cookies();
  const theme = store.get(THEME_STORAGE_KEY)?.value;
  const rail = store.get(RAIL_STORAGE_KEY)?.value;

  return (
    <html
      lang="en"
      className={`${inter.variable} h-full`}
      /* -- READ FROM COOKIES ON THE SERVER, so the document arrives correct
            and nothing has to be corrected after paint.

            LIGHT IS THE DEFAULT, at the owner's instruction, and this reverses
            what was here. `data-theme` used to be OMITTED with no stored
            choice, so the `prefers-color-scheme` block in globals.css decided —
            which is what "system" means, and it opened dark for anybody whose
            machine is set that way.

            The cost of the reversal, stated rather than glossed: somebody who
            keeps their whole computer in dark mode now gets a light app until
            they choose otherwise. That is the trade the instruction makes, and
            the toggle is one press away — a stored choice still wins, in both
            directions.

            globals.css already supports it: the dark media block is guarded as
            `:root:not([data-theme="light"])`, so writing "light" here excludes
            it without any change to the stylesheet.

            `suppressHydrationWarning` is gone with the script that needed it:
            nothing rewrites these attributes before React sees them any more,
            so server and client agree by construction rather than by
            suppression. -- */
      data-theme={theme === "dark" ? "dark" : "light"}
      data-rail={rail === "collapsed" ? "collapsed" : "open"}
    >
      {/* Background, ink, font and antialiasing are all set on `body` in
          globals.css, so print routes inherit the same base. */}
      <body className="min-h-full">
        {children}
        <Toaster position="top-right" />
      </body>
    </html>
  );
}
