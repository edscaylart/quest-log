// Hand-mirrored from src-tauri/src/core/time_entries.rs. Canonical domain terms only.

export type TimeEntry = {
  id: number;
  clientId: number;
  clientName: string;
  projectId: number | null;
  projectName: string | null;
  /** Frozen at Send if locked, else the live rate: the project's if set, else the client's. */
  rateCents: number;
  /** Local calendar day, YYYY-MM-DD. */
  date: string;
  seconds: number;
  /** Unix seconds; set only for entries logged by start–end. */
  startedAt: number | null;
  endedAt: number | null;
  note: string | null;
  /** On a Sent or Paid invoice: read-only. */
  locked: boolean;
};
export type Span = { mode: "duration"; duration: string } | { mode: "range"; start: string; end: string };
export type EntryInput = { clientId: number; projectId: number | null; date: string; span: Span; note: string };
/** `projectId` is null if that project is complete now. */
export type LastUsed = { clientId: number; projectId: number | null };
