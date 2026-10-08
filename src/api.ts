import { invoke } from "@tauri-apps/api/core";

// Hand-mirrored from src-tauri/src/core. Canonical domain terms only.

export type Client = { id: number; name: string; rateCents: number };
export type NewClient = { name: string; rate: string };

export type TimeEntry = {
  id: number;
  clientId: number;
  clientName: string;
  /** Local calendar day, YYYY-MM-DD. */
  date: string;
  seconds: number;
  /** Unix seconds; set only for entries logged by start–end. */
  startedAt: number | null;
  endedAt: number | null;
  note: string | null;
};
export type Span = { mode: "duration"; duration: string } | { mode: "range"; start: string; end: string };
export type EntryInput = { clientId: number; date: string; span: Span; note: string };

export type CoreError =
  | { kind: "invalid"; field: string; message: string }
  | { kind: "notFound"; message: string }
  | { kind: "database"; message: string };

export const isCoreError = (e: unknown): e is CoreError => typeof e === "object" && e !== null && "kind" in e;
/** Anything that isn't a core error (e.g. IPC failure) still carries its message. */
export const toCoreError = (e: unknown): CoreError => (isCoreError(e) ? e : { kind: "database", message: String(e) });

export const createClient = (input: NewClient) => invoke<Client>("create_client", { input });
export const listClients = () => invoke<Client[]>("list_clients");

export const listTimeEntries = (clientId: number | null) => invoke<TimeEntry[]>("list_time_entries", { clientId });
export const createTimeEntry = (input: EntryInput) => invoke<TimeEntry>("create_time_entry", { input });
export const updateTimeEntry = (id: number, input: EntryInput) => invoke<TimeEntry>("update_time_entry", { id, input });
export const deleteTimeEntry = (id: number) => invoke<void>("delete_time_entry", { id });
export const lastUsedClient = () => invoke<number | null>("last_used_client");

export type Timer = { clientId: number; clientName: string; /** Unix milliseconds. */ startedAt: number; note: string | null };
export type TimerStart = { clientId: number; note: string | null };
/** `start` is local "YYYY-MM-DDTHH:MM"; null keeps it. */
export type TimerEdit = { clientId: number; note: string; start: string | null };
/** A time entry the Timer would make, for the editor to fix. */
export type Overlong = { clientId: number; date: string; seconds: number; note: string | null };
/** needsEdit: ran over 24 hours; nothing saved and the Timer still runs. */
export type Stopped = { kind: "saved"; entry: TimeEntry } | { kind: "needsEdit"; overlong: Overlong };

export const getTimer = () => invoke<Timer | null>("get_timer");
/** Returns what happened to a Timer that was already running. */
export const startTimer = (input: TimerStart) => invoke<Stopped | null>("start_timer", { input });
export const stopTimer = () => invoke<Stopped>("stop_timer");
export const updateTimer = (input: TimerEdit) => invoke<Timer>("update_timer", { input });
export const finishTimer = (input: EntryInput) => invoke<TimeEntry>("finish_timer", { input });
export const discardTimer = () => invoke<void>("discard_timer");
