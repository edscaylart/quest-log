// @vitest-environment node
// jsdom's typed arrays come from another realm, which garbles pdfkit's compressed streams.
import { describe, expect, it } from "vitest";
import { invoicePdf, invoicePdfName, type SentInvoice } from "@/integrations/pdf/invoicePdf";
import type { Snapshot } from "@/lib/invoices/types";
import { label } from "@/lib/labels";
import { pdfPages } from "@/tests/support/pdf";

const snapshot: Snapshot = {
  number: "INV-0001",
  issueDate: "2026-10-07",
  dueDate: "2026-11-06",
  seller: {
    name: "Ada Lovelace",
    businessName: "Analytical Works",
    address: "1 Engine Row\nLondon",
    email: "ada@example.com",
    taxId: "GB123",
    paymentInstructions: "IBAN GB00 1234",
  },
  client: { name: "Acme Corp", address: "9 Road Runner Way", email: "billing@acme.test" },
  lines: [
    { projectId: 7, description: "Website", seconds: 5400, rateCents: 12000, amountCents: 18000 },
    { projectId: null, description: "General", seconds: 3661, rateCents: 8500, amountCents: 8644 },
  ],
  timesheet: [
    { date: "2026-10-05", description: "General", note: "Kickoff", seconds: 3661, startedAt: null, endedAt: null },
    { date: "2026-10-06", description: "Website", note: "Wireframes", seconds: 5400, startedAt: null, endedAt: null },
  ],
  seconds: 9061,
  totalCents: 26644,
};

const invoice = (timesheet: boolean, fields: Partial<SentInvoice> = {}): SentInvoice => ({
  id: 9,
  clientId: 1,
  clientName: "Acme",
  state: "sent",
  period: { start: "2026-10-01", end: "2026-10-07" },
  number: "INV-0001",
  netDays: 30,
  netDaysOverride: null,
  issueDate: "2026-10-07",
  dueDate: "2026-11-06",
  paidDate: null,
  overdue: false,
  timesheet,
  lines: snapshot.lines,
  seconds: snapshot.seconds,
  totalCents: snapshot.totalCents,
  entries: [],
  available: [],
  newInPeriod: 0,
  snapshot,
  ...fields,
});

const rpgLabels = Object.values(label).flatMap((l) => (typeof l === "string" ? [l] : Object.values(l)));

describe("invoice PDF", () => {
  it("prints the snapshot in canonical terms", async () => {
    const [page, ...rest] = await pdfPages(await invoicePdf(invoice(false)));

    expect(rest).toEqual([]);
    for (const text of [
      "Invoice",
      "INV-0001",
      "Oct 7, 2026",
      "Nov 6, 2026",
      "Analytical Works",
      "Ada Lovelace",
      "London",
      "GB123",
      "Acme Corp",
      "9 Road Runner Way",
      "billing@acme.test",
      "Hours",
      "Website",
      "1.50",
      "$120.00",
      "$180.00",
      "1.02",
      "$86.44",
      "2.52",
      "$266.44",
      "IBAN GB00 1234",
    ])
      expect(page).toContain(text);
    for (const rpg of rpgLabels) expect(page).not.toMatch(new RegExp(`\\b${rpg}\\b`));
  });

  it("re-exports the same amounts after a rate change", async () => {
    const before = await pdfPages(await invoicePdf(invoice(true)));
    const repriced = invoice(true, {
      lines: [{ projectId: 7, description: "Website", seconds: 5400, rateCents: 99900, amountCents: 149850 }],
      totalCents: 149850,
    });

    const after = await pdfPages(await invoicePdf(repriced));
    expect(after).toEqual(before);
    expect(after[0]).not.toContain("$999.00");
  });

  it("adds the timesheet page only when toggled on", async () => {
    const pages = await pdfPages(await invoicePdf(invoice(true)));

    expect(pages).toHaveLength(2);
    for (const text of ["Timesheet", "Oct 5, 2026", "Kickoff", "1.02", "Oct 6, 2026", "Wireframes", "1.50"]) expect(pages[1]).toContain(text);
    expect(pages[0]).not.toContain("Kickoff");
  });

  it("names the file by number, client and issue month", () => {
    expect(invoicePdfName(snapshot)).toBe("INV-0001 – Acme Corp – 2026-10.pdf");
    expect(invoicePdfName({ ...snapshot, client: { ...snapshot.client, name: "A/B: Co" } })).toBe("INV-0001 – A-B- Co – 2026-10.pdf");
  });
});
