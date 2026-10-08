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
  /** Out of the pickers and closed to new work; its history stays. */
  archived: boolean;
  /** Has time entries on no invoice, so a new Draft has something to hold. */
  hasAvailable: boolean;
};
export type NewClient = { name: string; rate: string };
/** Every editable field as typed; blank clears an optional one. */
export type ClientEdit = { name: string; rate: string; billingName: string; address: string; email: string; netDays: string };
/** What a rate change would do to uninvoiced time. */
export type Repricing = { seconds: number; oldCents: number; newCents: number };
/** What deleting a client would remove. */
export type ClientDeletion = { projects: number; entries: number; seconds: number };

export type Project = { id: number; clientId: number; name: string; /** null uses the client's rate. */ rateCents: number | null; /** What its time bills at. */ effectiveRateCents: number; complete: boolean };
/** `rate` blank uses the client's. */
export type ProjectInput = { name: string; rate: string };

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

export type CoreError =
  | { kind: "invalid"; field: string; message: string }
  | { kind: "notFound"; message: string }
  | { kind: "locked"; message: string }
  | { kind: "database"; message: string };

export const isCoreError = (e: unknown): e is CoreError => typeof e === "object" && e !== null && "kind" in e;
/** Anything that isn't a core error (e.g. IPC failure) still carries its message. */
export const toCoreError = (e: unknown): CoreError => (isCoreError(e) ? e : { kind: "database", message: String(e) });

export const createClient = (input: NewClient) => invoke<Client>("create_client", { input });
export const listClients = () => invoke<Client[]>("list_clients");
export const getClient = (id: number) => invoke<Client>("get_client", { id });
export const updateClient = (id: number, input: ClientEdit) => invoke<Client>("update_client", { id, input });
export const previewClientRate = (id: number, rate: string) => invoke<Repricing>("preview_client_rate", { id, rate });
export const setClientArchived = (id: number, archived: boolean) => invoke<Client>("set_client_archived", { id, archived });
/** Rejects if any of its entries is on an invoice. */
export const clientDeletion = (id: number) => invoke<ClientDeletion>("client_deletion", { id });
/** Permanent: its projects, entries and running Timer go too. */
export const deleteClient = (id: number) => invoke<void>("delete_client", { id });

/** A client's projects, active first. */
export const listProjects = (clientId: number) => invoke<Project[]>("list_projects", { clientId });
export const getProject = (id: number) => invoke<Project>("get_project", { id });
export const createProject = (clientId: number, input: ProjectInput) => invoke<Project>("create_project", { clientId, input });
export const updateProject = (id: number, input: ProjectInput) => invoke<Project>("update_project", { id, input });
export const setProjectComplete = (id: number, complete: boolean) => invoke<Project>("set_project_complete", { id, complete });
/** Permanent: its entries go too. Rejects if any is on an invoice. */
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

/** The freelancer's invoice header and invoicing defaults. `name` is blank until first saved. */
export type Settings = {
  name: string;
  businessName: string | null;
  address: string | null;
  email: string | null;
  taxId: string | null;
  paymentInstructions: string | null;
  /** Default payment terms, Net N. */
  netDays: number;
  invoicePrefix: string;
  nextInvoiceNumber: number;
};
/** Every field as typed; blank clears an optional one. */
export type SettingsEdit = { [K in keyof Settings]: string };

export const getSettings = () => invoke<Settings>("get_settings");
export const updateSettings = (input: SettingsEdit) => invoke<Settings>("update_settings", { input });

/** How the launch's daily backup went. Dates are local days, YYYY-MM-DD. */
export type LastBackup = { kind: "done"; date: string } | { kind: "failed"; date: string; message: string };
export type DataInfo = { path: string; lastBackup: LastBackup };

export const getDataInfo = () => invoke<DataInfo>("data_info");
export const revealDatabase = () => invoke<void>("reveal_database");
/** Snapshot to `path`, replacing it. */
export const backUpNow = (path: string) => invoke<void>("back_up_now", { path });
/** Rejects a file that isn't a Quest Log backup, or is from a newer version. */
export const inspectBackup = (path: string) => invoke<{ date: string }>("inspect_backup", { path });
/** Snapshots current data, swaps in the backup and restarts the app. */
export const restoreBackup = (path: string) => invoke<void>("restore_backup", { path });
/** The period's time entries as CSV text, oldest first; `clientId` null is every client. */
export const exportCsv = (input: PeriodInput, clientId: number | null) => invoke<string>("export_csv", { input, clientId });

export type InvoiceState = "draft" | "sent" | "paid";
/** Local days, both included. */
export type Period = { start: string; end: string };
/** One per project, then "General"; amount is exact seconds × rate, rounded once. */
export type InvoiceLine = { projectId: number | null; description: string; seconds: number; rateCents: number; amountCents: number };
export type Invoice = {
  id: number;
  clientId: number;
  clientName: string;
  state: InvoiceState;
  period: Period;
  /** Given at the first Send; kept on revert. */
  number: string | null;
  /** Payment terms Send uses: the override, else the client's, else Settings'. */
  netDays: number;
  netDaysOverride: number | null;
  /** Local days; Sent and Paid only. */
  issueDate: string | null;
  dueDate: string | null;
  /** Paid only. */
  paidDate: string | null;
  /** Sent and past due. */
  overdue: boolean;
  /** Print the timesheet page. */
  timesheet: boolean;
  /** From the snapshot once Sent. */
  lines: InvoiceLine[];
  seconds: number;
  totalCents: number;
  /** Its entries, newest first. */
  entries: TimeEntry[];
  /** Draft only: the client's entries on no invoice, newest first. */
  available: TimeEntry[];
  /** How many of `available` fall in the period. */
  newInPeriod: number;
  /** Frozen at Send; Sent and Paid only. */
  snapshot: Snapshot | null;
};
/** Everything a Sent invoice shows, frozen at Send. */
export type Snapshot = {
  number: string;
  /** Local days. */
  issueDate: string;
  dueDate: string;
  seller: { name: string; businessName: string | null; address: string | null; email: string | null; taxId: string | null; paymentInstructions: string | null };
  /** `name` is the billing name, else the client's name. */
  client: { name: string; address: string | null; email: string | null };
  lines: InvoiceLine[];
  /** Oldest first; `description` is the project or "General". */
  timesheet: { date: string; description: string; note: string | null; seconds: number; startedAt: number | null; endedAt: number | null }[];
  seconds: number;
  totalCents: number;
};
export type InvoiceSummary = Pick<Invoice, "id" | "clientId" | "clientName" | "state" | "period" | "number" | "dueDate" | "overdue" | "seconds" | "totalCents">;
/** What a new Draft would hold: entries in the period on no invoice, and how many older ones there are. */
export type DraftCandidates = { period: Period; entries: TimeEntry[]; older: number; olderSince: string | null };
export type NewDraft = { clientId: number; start: string; end: string; entryIds: number[] };

/** `period` null is the default: after the client's last invoice period (else its earliest uninvoiced entry) to today. */
export const draftCandidates = (clientId: number, period: PeriodInput | null) => invoke<DraftCandidates>("draft_candidates", { clientId, period });
export const createDraft = (input: NewDraft) => invoke<Invoice>("create_draft", { input });
/** Newest first. */
export const listInvoices = () => invoke<InvoiceSummary[]>("list_invoices");
export const getInvoice = (id: number) => invoke<Invoice>("get_invoice", { id });
export const addInvoiceEntry = (id: number, entryId: number) => invoke<Invoice>("add_invoice_entry", { id, entryId });
export const removeInvoiceEntry = (id: number, entryId: number) => invoke<Invoice>("remove_invoice_entry", { id, entryId });
export const setInvoiceTimesheet = (id: number, timesheet: boolean) => invoke<Invoice>("set_invoice_timesheet", { id, timesheet });
/** Blank goes back to the client's or Settings' terms. */
export const setInvoiceNetDays = (id: number, netDays: string) => invoke<Invoice>("set_invoice_net_days", { id, netDays });
/** Draft → Sent: numbers, dates, snapshots and locks. */
export const sendInvoice = (id: number) => invoke<Invoice>("send_invoice", { id });
/** Sent → Draft: keeps the number, unlocks. */
export const unsealInvoice = (id: number) => invoke<Invoice>("unseal_invoice", { id });
/** Sent → Paid; `paidDate` is YYYY-MM-DD. */
export const markPaid = (id: number, paidDate: string) => invoke<Invoice>("mark_paid", { id, paidDate });
/** Paid → Sent. */
export const unmarkPaid = (id: number) => invoke<Invoice>("unmark_paid", { id });
/** Frees its entries. */
export const deleteInvoice = (id: number) => invoke<void>("delete_invoice", { id });
