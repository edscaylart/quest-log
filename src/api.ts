import { invoke } from "@tauri-apps/api/core";

// Hand-mirrored from src-tauri/src/core. Canonical domain terms only.

export type Client = {
  id: number;
  name: string;
  rateCents: number;
  /** null bills under `name`. */
  billingName: string | null;
  address: string | null;
  email: string | null;
  /** Payment terms override; null uses the default. */
  netDays: number | null;
};
export type NewClient = { name: string; rate: string };
/** Every editable field as typed; blank clears an optional one. */
export type ClientEdit = { name: string; rate: string; billingName: string; address: string; email: string; netDays: string };
/** What a rate change would do to uninvoiced time. */
export type Repricing = { seconds: number; oldCents: number; newCents: number };

export type Project = { id: number; clientId: number; name: string; /** null uses the client's rate. */ rateCents: number | null; /** What its time bills at. */ effectiveRateCents: number; complete: boolean };
/** `rate` blank uses the client's. */
export type ProjectInput = { name: string; rate: string };

export type TimeEntry = {
  id: number;
  clientId: number;
  clientName: string;
  projectId: number | null;
  projectName: string | null;
  /** The live rate: the project's if set, else the client's. */
  rateCents: number;
  /** Local calendar day, YYYY-MM-DD. */
  date: string;
  seconds: number;
  /** Unix seconds; set only for entries logged by start–end. */
  startedAt: number | null;
  endedAt: number | null;
  note: string | null;
};
export type Span = { mode: "duration"; duration: string } | { mode: "range"; start: string; end: string };
export type EntryInput = { clientId: number; projectId: number | null; date: string; span: Span; note: string };

export type CoreError =
  | { kind: "invalid"; field: string; message: string }
  | { kind: "notFound"; message: string }
  | { kind: "database"; message: string };

export const isCoreError = (e: unknown): e is CoreError => typeof e === "object" && e !== null && "kind" in e;
/** Anything that isn't a core error (e.g. IPC failure) still carries its message. */
export const toCoreError = (e: unknown): CoreError => (isCoreError(e) ? e : { kind: "database", message: String(e) });

export const createClient = (input: NewClient) => invoke<Client>("create_client", { input });
export const listClients = () => invoke<Client[]>("list_clients");
export const getClient = (id: number) => invoke<Client>("get_client", { id });
export const updateClient = (id: number, input: ClientEdit) => invoke<Client>("update_client", { id, input });
export const previewClientRate = (id: number, rate: string) => invoke<Repricing>("preview_client_rate", { id, rate });

/** A client's projects, active first. */
export const listProjects = (clientId: number) => invoke<Project[]>("list_projects", { clientId });
export const getProject = (id: number) => invoke<Project>("get_project", { id });
export const createProject = (clientId: number, input: ProjectInput) => invoke<Project>("create_project", { clientId, input });
export const updateProject = (id: number, input: ProjectInput) => invoke<Project>("update_project", { id, input });
export const setProjectComplete = (id: number, complete: boolean) => invoke<Project>("set_project_complete", { id, complete });
export const deleteProject = (id: number) => invoke<void>("delete_project", { id });
export const previewProjectRate = (id: number, rate: string) => invoke<Repricing>("preview_project_rate", { id, rate });

export const listTimeEntries = (clientId: number | null) => invoke<TimeEntry[]>("list_time_entries", { clientId });
export const createTimeEntry = (input: EntryInput) => invoke<TimeEntry>("create_time_entry", { input });
export const updateTimeEntry = (id: number, input: EntryInput) => invoke<TimeEntry>("update_time_entry", { id, input });
export const deleteTimeEntry = (id: number) => invoke<void>("delete_time_entry", { id });
/** `projectId` is null if that project is complete now. */
export type LastUsed = { clientId: number; projectId: number | null };
export const lastUsed = () => invoke<LastUsed | null>("last_used");

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

export const getTimer = () => invoke<Timer | null>("get_timer");
/** Returns what happened to a Timer that was already running. */
export const startTimer = (input: TimerStart) => invoke<Stopped | null>("start_timer", { input });
export const stopTimer = () => invoke<Stopped>("stop_timer");
export const updateTimer = (input: TimerEdit) => invoke<Timer>("update_timer", { input });
export const finishTimer = (input: EntryInput) => invoke<TimeEntry>("finish_timer", { input });
export const discardTimer = () => invoke<void>("discard_timer");

export type Preset = "1w" | "2w" | "3w" | "month" | "custom";
/** A preset's current period, stepped `offset` period lengths; `start`/`end` (YYYY-MM-DD) are for custom. */
export type PeriodInput = { preset: Preset; offset: number; start: string | null; end: string | null };
/** Earnings: uninvoiced + invoiced-unpaid + paid always equals earned. */
export type Figures = { seconds: number; earnedCents: number; uninvoicedCents: number; invoicedUnpaidCents: number; paidCents: number };
export type Dashboard = {
  /** Local days, both included. */
  period: { start: string; end: string };
  total: Figures;
  /** Clients with time in the period, most hours first. */
  clients: (Figures & { clientId: number; clientName: string })[];
  /** Per day, or per Monday week when `weekly`. */
  buckets: { start: string; seconds: number }[];
  weekly: boolean;
  /** Not tied to the period. `overdue` counts Sent invoices past due. */
  allTime: { invoicedUnpaidCents: number; overdue: number; uninvoicedCents: number };
};

/** Includes the running Timer, live. */
export const getDashboard = (input: PeriodInput) => invoke<Dashboard>("dashboard", { input });

/** XP is one per tracked minute; `levelXp`/`nextLevelXp` bound the current Level. */
export type Progress = { level: number; xp: number; levelXp: number; nextLevelXp: number; /** A new highest Level not yet celebrated. */ levelUp: number | null };
/** From saved time entries only, so a running Timer counts once stopped. */
export const getProgress = () => invoke<Progress>("progress");
/** The level-up for `level` was shown; never lowers the highest. */
export const acknowledgeLevelUp = (level: number) => invoke<void>("acknowledge_level_up", { level });
