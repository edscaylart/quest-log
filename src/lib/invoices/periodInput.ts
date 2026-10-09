import { periodInput } from "@/lib/dashboard/periodInput";
import type { PeriodInput } from "@/lib/dashboard/types";

/** Which period to list: the core default, a completed preset, or custom days. */
export type PeriodChoice = { kind: "default" } | { kind: "2w" | "month" } | { kind: "custom"; start: string; end: string };

export function draftPeriodInput(choice: PeriodChoice): PeriodInput | null {
  if (choice.kind === "default") return null;
  if (choice.kind === "custom") return periodInput("custom", 0, choice);
  // Last month is the previous calendar month; last 2 weeks is last week and this one, up to today.
  return periodInput(choice.kind, choice.kind === "month" ? -1 : 0, null);
}
