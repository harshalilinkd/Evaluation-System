/** /admin/form-builder/increment — the INCREMENT form. */

import type { Metadata } from "next";

import { BuilderScreen } from "@/app/(app)/admin/form-builder/builder-screen";

export const metadata: Metadata = { title: "Increment form" };

export default function Page() {
  return <BuilderScreen cycleType="INCREMENT" />;
}
