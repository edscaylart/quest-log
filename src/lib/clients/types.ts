// Hand-mirrored from src-tauri/src/core/clients.rs. Canonical domain terms only.

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
