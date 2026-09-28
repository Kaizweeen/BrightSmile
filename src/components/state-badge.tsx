import { CircleCheck, CircleMinus } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/**
 * On or off (a person active or disabled, a branch open or closed, a procedure offered or retired) as a word and an
 * icon: spec 10 never shows a state by colour alone.
 */
export function StateBadge({ on, yes, no, warn = false }: { on: boolean; yes: string; no: string; warn?: boolean }) {
  const Icon = on ? CircleCheck : CircleMinus;
  return (
    <Badge variant={on ? "secondary" : warn ? "destructive" : "outline"}>
      <Icon data-icon="inline-start" aria-hidden />
      {on ? yes : no}
    </Badge>
  );
}
