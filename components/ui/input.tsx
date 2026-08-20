import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          /* -- 44px IS THE DEFAULT, not something 96 call sites have to
                remember. §13.8 sets the minimum touch target and shadcn ships
                36px, so every input that forgot `min-h-11` was under it — 60 of
                them, including the self-evaluation form, the salary band and
                the cycle wizard. Fixing the sites would leave the next one
                wrong; fixing the default cannot. A caller that genuinely wants
                something else still overrides, because `cn` merges last-wins.

                A SECOND DELIBERATE EXCEPTION TO §3's "primitives untouched",
                recorded in §18 beside the dialog's. -- */
          "flex min-h-11 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
