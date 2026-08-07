/** Print routes. DESIGN.md §7a — no shell, no navigation, no chrome. */

import "@/app/globals.css";
import "@/app/print/print.css";

/**
 * A layout of its own, deliberately outside the (app) group.
 *
 * "Do not reuse the app shell inside a print route" is not only a styling
 * instruction: the shell is a client tree with a sidebar, a topbar, a theme
 * script and a cycle selector, none of which can appear on a signed document,
 * and a `display: none` over the top of them still ships them to the browser and
 * still lets one escape through a stray print style.
 *
 * Nothing here is cached — every page is one person's appraisal behind a guard.
 */
export const dynamic = "force-dynamic";

// LayoutProps<"/print"> rather than a hand-written props type: Next generates
// typed routes and validates every layout against them.
export default function PrintLayout({ children }: LayoutProps<"/print">) {
  return <div className="print-root">{children}</div>;
}
