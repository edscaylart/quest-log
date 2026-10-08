import { invoke } from "@tauri-apps/api/core";
import type { DataInfo } from "@/lib/backups/types";
import type { Client, ClientDeletion, ClientEdit, NewClient, Repricing } from "@/lib/clients/types";
import type { Dashboard, PeriodInput } from "@/lib/dashboard/types";
import type { DraftCandidates, Invoice, InvoiceSummary, NewDraft } from "@/lib/invoices/types";
import type { Progress } from "@/lib/progress/types";
import type { Project, ProjectInput } from "@/lib/projects/types";
import type { Settings, SettingsEdit } from "@/lib/settings/types";
import type { EntryInput, LastUsed, TimeEntry } from "@/lib/time-entries/types";
import type { Stopped, Timer, TimerEdit, TimerStart } from "@/lib/timer/types";

// One wrapper per Tauri command in src-tauri/src/lib.rs.

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
export const lastUsed = () => invoke<LastUsed | null>("last_used");

export const getTimer = () => invoke<Timer | null>("get_timer");
/** Returns what happened to a Timer that was already running. */
export const startTimer = (input: TimerStart) => invoke<Stopped | null>("start_timer", { input });
export const stopTimer = () => invoke<Stopped>("stop_timer");
export const updateTimer = (input: TimerEdit) => invoke<Timer>("update_timer", { input });
export const finishTimer = (input: EntryInput) => invoke<TimeEntry>("finish_timer", { input });
export const discardTimer = () => invoke<void>("discard_timer");

/** Includes the running Timer, live. */
export const getDashboard = (input: PeriodInput) => invoke<Dashboard>("dashboard", { input });

/** From saved time entries only, so a running Timer counts once stopped. */
export const getProgress = () => invoke<Progress>("progress");
/** The level-up for `level` was shown; never lowers the highest. */
export const acknowledgeLevelUp = (level: number) => invoke<void>("acknowledge_level_up", { level });

export const getSettings = () => invoke<Settings>("get_settings");
export const updateSettings = (input: SettingsEdit) => invoke<Settings>("update_settings", { input });

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
