// Hand-mirrored from src-tauri/src/core/invoices.rs. Canonical domain terms only.
import type { Period } from "@/lib/dashboard/types";
import type { TimeEntry } from "@/lib/time-entries/types";

export type InvoiceState = "draft" | "sent" | "paid";
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
