/** /admin/questions — retired. The question bank is a Form Builder tab now. */

import { redirect } from "next/navigation";

/**
 * The route is kept as a redirect rather than deleted. HR has had this URL in
 * the sidebar since P8 and will have bookmarked it; a 404 on a page that worked
 * yesterday reads as a broken product, not as a menu that moved.
 */
export default function QuestionsRedirect() {
  redirect("/admin/form-builder/questions");
}
