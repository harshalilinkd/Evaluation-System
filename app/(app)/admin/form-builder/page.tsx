/** /admin/form-builder — the EVALUATION form. The priority of the two. */

import type { Metadata } from "next";

import { BuilderScreen } from "@/app/(app)/admin/form-builder/builder-screen";

export const metadata: Metadata = { title: "Evaluation form" };

export default function Page() {
  /* Evaluation is the default route because it is the form most cycles use and
     the one this screen was asked to make easy. The increment form is a tab
     away, and every bookmark of /admin/form-builder still lands on a builder. */
  return <BuilderScreen cycleType="EVALUATION" />;
}
