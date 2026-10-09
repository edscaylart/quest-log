import type { Period, PeriodInput, Preset } from "@/lib/dashboard/types";

/** What core takes for a Period: a preset stepped by `offset`, with Custom's own days. */
export const periodInput = (preset: Preset, offset: number, range: Period | null): PeriodInput => ({
  preset,
  offset,
  start: range?.start ?? null,
  end: range?.end ?? null,
});
