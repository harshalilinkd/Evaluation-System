/** Shared utilities. Barrel for /lib/utils — later phases add date, currency and score helpers here. */

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind classes with conflict resolution. Used by every shadcn
 * primitive via the `@/lib/utils` alias in components.json.
 *
 * Lives at lib/utils/index.ts rather than lib/utils.ts because CLAUDE.md §3
 * defines /lib/utils as a directory; a sibling file of the same name would
 * shadow it in module resolution.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
