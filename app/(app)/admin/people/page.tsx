/** /admin/people — retired as a menu. Team review is a Settings tab now. */

import { redirect } from "next/navigation";

/**
 * Kept as a redirect rather than deleted, for the same reason as
 * /admin/departments and /admin/questions: the URL was in the sidebar since
 * NAV-1, and a 404 on a page that worked yesterday reads as a broken product
 * rather than a menu that moved.
 *
 * The per-person employment screen at /admin/people/[profileId]/employment is
 * NOT retired — it is where a salary is recorded, and every link into it
 * (Settings › Users, the increment report, Team review itself) still points
 * straight at that route.
 */
export default function PeopleRedirect() {
  redirect("/admin/settings?tab=team-review");
}
