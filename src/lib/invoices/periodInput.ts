import type { PeriodInput } from "@/lib/dashboard/types";

/** Which period to list: the core default, a completed preset, or custom days. */
export type PeriodChoice = { kind: "default" } | { kind: "2w" | "month" } | { kind: "custom"; start: string; end: string };

export function periodInput(choice: PeriodChoice): PeriodInput | null {
  if (choice.kind === "default") return null;
  if (choice.kind === "custom") return { preset: "custom", offset: 0, start: choice.start, end: choice.end };
  // Last month is the previous calendar month; last 2 weeks is last week and this one, up to today.
  return { preset: choice.kind, offset: choice.kind === "month" ? -1 : 0, start: null, end: null };
}
