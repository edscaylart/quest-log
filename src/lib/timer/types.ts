// Hand-mirrored from src-tauri/src/core/timer.rs. Canonical domain terms only.
import type { TimeEntry } from "@/lib/time-entries/types";

export type Timer = {
  clientId: number;
  clientName: string;
  projectId: number | null;
  projectName: string | null;
  /** Unix milliseconds. */
  startedAt: number;
  note: string | null;
};
export type TimerStart = { clientId: number; projectId: number | null; note: string | null };
/** `start` is local "YYYY-MM-DDTHH:MM"; null keeps it. */
export type TimerEdit = { clientId: number; projectId: number | null; note: string; start: string | null };
/** A time entry the Timer would make, for the editor to fix. */
export type Overlong = { clientId: number; projectId: number | null; date: string; seconds: number; note: string | null };
/** needsEdit: ran over 24 hours; nothing saved and the Timer still runs. */
export type Stopped = { kind: "saved"; entry: TimeEntry } | { kind: "needsEdit"; overlong: Overlong };
