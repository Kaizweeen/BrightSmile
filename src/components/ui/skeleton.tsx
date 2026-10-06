import { cn } from "cn"

/** A grey block that stands in for content on its way. It sits still for people who ask for less motion. */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="skeleton" aria-hidden className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />
}

export { Skeleton }
