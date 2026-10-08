// Domain term → RPG label. UI only; never for anything a client sees.
export const label = {
  client: "Patron",
  clients: "Patrons",
  rate: "Gold/hr",
  allClients: "All Patrons",
  invoice: "Scroll",
  invoices: "Scrolls",
  invoiceState: { draft: "Unsealed", sent: "Sealed", paid: "Redeemed" },
  project: "Quest",
  projects: "Quests",
  noProject: "No Quest",
  complete: "Quest complete",
  uninvoiced: "Unclaimed",
  invoicedUnpaid: "Owed",
  paid: "Treasury",
  level: "Lv",
} as const;
