/** /admin/departments — retired as a menu. Departments are a Settings tab now. */

import { redirect } from "next/navigation";

/**
 * Kept as a redirect rather than deleted, for the same reason as
 * /admin/questions: the URL was in the sidebar since P9, and a 404 on a page
 * that worked yesterday reads as a broken product rather than a menu that moved.
 *
 * The per-department mapping screen at /admin/departments/[id] is NOT retired —
 * it is where Job Specific Skills questions are attached to a team, and the
 * list in Settings still links to it.
 */
export default function DepartmentsRedirect() {
  redirect("/admin/settings?tab=departments");
}
