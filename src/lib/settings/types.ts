// Hand-mirrored from src-tauri/src/core/settings.rs. Canonical domain terms only.

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
