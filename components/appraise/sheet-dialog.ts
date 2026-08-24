/** How a long form dialog sizes itself: a full sheet on a phone, a panel above. */

/**
 * A CENTRED PANEL IS THE WRONG SHAPE FOR A LONG FORM AT 375px.
 *
 * `DialogContent` positions itself `top-[50%]` and pulls back by half its own
 * height. That is right for a confirm box and wrong for a twelve-field form:
 * the panel is capped well below the viewport and its content is far taller, so
 * it renders at the cap with a slice of backdrop above and below, a gutter down
 * each side, and an inner scroller doing the real work. The form is then read
 * through a letterbox — margin on all four sides of a screen with none to
 * spare, and no way to tell the panel's scrollbar from the page's.
 *
 * Below `sm` this removes the centring rather than fighting it: no transform,
 * no width cap, no radius, and the height IS the viewport, so a header pins to
 * the top, an action bar to the bottom, and the fields take everything between.
 * Above `sm` every one of those is handed straight back and the desktop dialog
 * is exactly what it was.
 *
 * POSITIONING AND SIZE ONLY — no `display`, no padding, no colour. The callers
 * differ there (some are flex columns, some are grids with their own row
 * template) and forcing one on them would break the layout inside the panel
 * while fixing the panel itself.
 *
 * `dvh`, not `vh` (FIX-65): `vh` measures the viewport as though the browser
 * chrome were hidden, so a `100vh` sheet runs under the URL bar and puts its
 * own save button off the bottom of the screen — the exact failure this exists
 * to end, not to reproduce.
 *
 * A caller that wants a desktop width appends its own `sm:w-[…]`; the width
 * only exists above `sm`.
 */
export const SHEET_ON_MOBILE =
  "left-0 top-0 h-dvh max-h-dvh w-full max-w-none translate-x-0 translate-y-0 rounded-none " +
  "sm:left-[50%] sm:top-[50%] sm:h-auto sm:max-h-[92dvh] sm:w-auto sm:max-w-[96vw] " +
  "sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-card-lg";

/**
 * The horizontal padding inside one of these.
 *
 * 16px on a phone rather than 24px — on a 375px screen that is 16px of readable
 * width handed back to every field in the form, which is the difference between
 * a truncated label and a whole one (§13.2).
 */
export const DIALOG_PAD = "px-4 sm:px-6";
