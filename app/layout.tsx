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

            `data-theme` is OMITTED when no choice is stored — that absence is
            what lets the `prefers-color-scheme` block in globals.css decide,
            which is precisely what "system" means. Writing "light" here would
            override the media query and force every system-dark user light.

            `suppressHydrationWarning` is gone with the script that needed it:
            nothing rewrites these attributes before React sees them any more,
            so server and client agree by construction rather than by
            suppression. -- */
      {...(theme === "dark" || theme === "light" ? { "data-theme": theme } : {})}
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
