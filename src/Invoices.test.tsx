import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";
import type { Client, DraftCandidates, Invoice, InvoiceSummary, TimeEntry } from "./api";
import { emptyDashboard, renderWithIpc } from "./test/render";

const client = (id: number, name: string): Client => ({ id, name, rateCents: 8500, billingName: null, address: null, email: null, netDays: null, archived: false, hasAvailable: false });
const acme = client(1, "Acme");
const bolt = client(2, "Bolt");

const entry = (fields: Partial<TimeEntry> & Pick<TimeEntry, "id">): TimeEntry => ({
  clientId: 1,
  clientName: "Acme",
  projectId: null,
  projectName: null,
  rateCents: 8500,
  date: "2026-10-06",
  seconds: 3600,
  startedAt: null,
  endedAt: null,
  note: null,
  locked: false,
  ...fields,
});
const mon = entry({ id: 1, date: "2026-10-05", note: "Kickoff" });
const tue = entry({ id: 2, date: "2026-10-06", note: "Wireframes", projectId: 7, projectName: "Website" });
const old = entry({ id: 3, date: "2026-08-03", note: "Audit" });

const draft = (fields: Partial<Invoice> = {}): Invoice => ({
  id: 9,
  clientId: 1,
  clientName: "Acme",
  state: "draft",
  period: { start: "2026-10-01", end: "2026-10-07" },
  number: null,
  netDays: 30,
  netDaysOverride: null,
  issueDate: null,
  dueDate: null,
  paidDate: null,
  overdue: false,
  timesheet: true,
  lines: [
    { projectId: 7, description: "Website", seconds: 5400, rateCents: 12000, amountCents: 18000 },
    { projectId: null, description: "General", seconds: 3661, rateCents: 8500, amountCents: 8644 },
  ],
  seconds: 9061,
  totalCents: 26644,
  entries: [tue, mon],
  available: [old],
  newInPeriod: 0,
  snapshot: null,
  ...fields,
});

function fakeCore({ invoices = [] as InvoiceSummary[], invoice = draft(), clients = [acme, bolt] } = {}) {
  let current = invoice;
  let list = invoices;
  return {
    list_clients: () => clients,
    get_timer: () => null,
    dashboard: emptyDashboard,
    list_time_entries: () => [],
    last_used: () => null,
    list_projects: () => [],
    list_invoices: () => list,
    draft_candidates: ({ clientId, period }: Record<string, unknown>): DraftCandidates => {
      if (clientId !== 1) return { period: { start: "2026-10-07", end: "2026-10-07" }, entries: [], older: 0, olderSince: null };
      const custom = period as { start: string; end: string } | null;
      return custom?.start === "2026-08-03"
        ? { period: { start: "2026-08-03", end: "2026-10-07" }, entries: [tue, mon, old], older: 0, olderSince: null }
        : { period: { start: "2026-10-01", end: "2026-10-07" }, entries: [tue, mon], older: 1, olderSince: "2026-08-03" };
    },
    create_draft: () => {
      list = [{ ...current }];
      return current;
    },
    get_invoice: () => current,
    add_invoice_entry: ({ entryId }: Record<string, unknown>) => {
      const added = current.available.find((e) => e.id === entryId)!;
      current = { ...current, entries: [...current.entries, added], available: current.available.filter((e) => e !== added) };
      return current;
    },
    remove_invoice_entry: ({ entryId }: Record<string, unknown>) => {
      const removed = current.entries.find((e) => e.id === entryId)!;
      current = { ...current, entries: current.entries.filter((e) => e !== removed), available: [removed, ...current.available] };
      return current;
    },
    set_invoice_timesheet: ({ timesheet }: Record<string, unknown>) => {
      current = { ...current, timesheet: timesheet as boolean };
      return current;
    },
    delete_invoice: () => {
      list = [];
      return null;
    },
    send_invoice: () => {
      current = { ...current, ...sealed };
      return current;
    },
    unseal_invoice: () => {
      current = { ...current, state: "draft", issueDate: null, dueDate: null, snapshot: null };
      return current;
    },
    mark_paid: ({ paidDate }: Record<string, unknown>) => {
      current = { ...current, state: "paid", paidDate: paidDate as string };
      return current;
    },
  };
}

const sealed: Partial<Invoice> = {
  state: "sent",
  number: "INV-0001",
  issueDate: "2026-10-07",
  dueDate: "2026-11-06",
  available: [],
  snapshot: {
    number: "INV-0001",
    issueDate: "2026-10-07",
    dueDate: "2026-11-06",
    seller: { name: "Ada", businessName: null, address: null, email: null, taxId: null, paymentInstructions: null },
    client: { name: "Acme", address: null, email: null },
    lines: draft().lines,
    timesheet: [],
    seconds: 9061,
    totalCents: 26644,
  },
};

async function openScrolls(core: ReturnType<typeof fakeCore>) {
  const rendered = renderWithIpc(<App />, core);
  await rendered.user.click(screen.getByRole("tab", { name: "Scrolls" }));
  await screen.findByRole("heading", { name: "Scrolls" });
  return rendered;
}

describe("Scrolls", () => {
  it("groups Scrolls under Unsealed and opens a Draft", async () => {
    const summary: InvoiceSummary = { id: 9, clientId: 1, clientName: "Acme", state: "draft", period: { start: "2026-10-01", end: "2026-10-07" }, number: null, dueDate: null, overdue: false, seconds: 9061, totalCents: 26644 };
    const { user } = await openScrolls(fakeCore({ invoices: [summary] }));

    const unsealed = await screen.findByRole("region", { name: "Unsealed" });
    expect(within(unsealed).getByText("$266.44")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Sealed" })).not.toBeInTheDocument();

    await user.click(within(unsealed).getByRole("button", { name: /Acme/ }));
    expect(await screen.findByRole("heading", { name: "Unsealed Scroll · Acme" })).toBeInTheDocument();
  });

  it("creates a Draft from the default period with unticked entries left out", async () => {
    const { user, calls } = await openScrolls(fakeCore());
    await user.click(screen.getByRole("button", { name: "+ New Scroll" }));

    const dialog = await screen.findByRole("dialog", { name: "New Scroll" });
    expect(await within(dialog).findByText("Oct 1 – Oct 7, 2026")).toBeInTheDocument();
    const kickoff = within(dialog).getByRole("checkbox", { name: /Kickoff/ });
    expect(kickoff).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: /Wireframes/ })).toBeChecked();

    await user.click(kickoff);
    await user.click(within(dialog).getByRole("button", { name: "Create" }));

    expect(calls.find((c) => c.cmd === "create_draft")?.args).toEqual({
      input: { clientId: 1, start: "2026-10-01", end: "2026-10-07", entryIds: [2] },
    });
    expect(await screen.findByRole("heading", { name: "Unsealed Scroll · Acme" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("offers a Retired Patron only while it has Unclaimed time, tagged Retired", async () => {
    const retired = (id: number, name: string, hasAvailable: boolean) => ({ ...client(id, name), archived: true, hasAvailable });
    const { user } = await openScrolls(fakeCore({ clients: [acme, retired(2, "Bolt", true), retired(3, "Cog", false)] }));
    await user.click(screen.getByRole("button", { name: "+ New Scroll" }));

    const picker = within(await screen.findByRole("dialog", { name: "New Scroll" })).getByLabelText("Patron");
    await waitFor(() => expect(within(picker).getAllByRole("option").map((o) => o.textContent)).toEqual(["Acme", "Bolt (Retired)"]));
  });

  it("offers to include older uninvoiced entries", async () => {
    const { user, calls } = await openScrolls(fakeCore());
    await user.click(screen.getByRole("button", { name: "+ New Scroll" }));
    const dialog = await screen.findByRole("dialog", { name: "New Scroll" });

    await user.click(await within(dialog).findByRole("button", { name: "1 older uninvoiced entry — include?" }));

    expect(await within(dialog).findByRole("checkbox", { name: /Audit/ })).toBeChecked();
    expect(calls.filter((c) => c.cmd === "draft_candidates").at(-1)?.args).toEqual({
      clientId: 1,
      period: { preset: "custom", offset: 0, start: "2026-08-03", end: "2026-10-07" },
    });
  });

  it("asks for last month and the last 2 weeks", async () => {
    const { user, calls } = await openScrolls(fakeCore());
    await user.click(screen.getByRole("button", { name: "+ New Scroll" }));
    const dialog = await screen.findByRole("dialog", { name: "New Scroll" });

    await user.click(within(dialog).getByRole("button", { name: "Last month" }));

    expect(calls.filter((c) => c.cmd === "draft_candidates").at(-1)?.args).toEqual({
      clientId: 1,
      period: { preset: "month", offset: -1, start: null, end: null },
    });

    await user.click(within(dialog).getByRole("button", { name: "Last 2 weeks" }));
    expect(calls.filter((c) => c.cmd === "draft_candidates").at(-1)?.args).toEqual({
      clientId: 1,
      period: { preset: "2w", offset: 0, start: null, end: null },
    });
  });
});

describe("Draft editor", () => {
  async function openDraft(invoice = draft()) {
    const summary: InvoiceSummary = { ...invoice };
    const rendered = await openScrolls(fakeCore({ invoices: [summary], invoice }));
    await rendered.user.click(await screen.findByRole("button", { name: /Acme/ }));
    await screen.findByRole("heading", { name: "Unsealed Scroll · Acme" });
    return rendered;
  }

  it("shows lines with 2dp hours, amounts and the total", async () => {
    await openDraft();

    const rows = within(screen.getByRole("table")).getAllByRole("row").map((r) => r.textContent);
    expect(rows).toEqual([
      "DescriptionHoursRateAmount",
      "Website1.50$120.00$180.00",
      "General1.02$85.00$86.44",
      "Total2.52$266.44",
    ]);
    expect(screen.getByRole("checkbox", { name: "Timesheet page" })).toBeChecked();
  });

  it("hints at new uninvoiced entries in the period", async () => {
    await openDraft(draft({ newInPeriod: 2 }));
    expect(screen.getByText("2 new uninvoiced entries in this period")).toBeInTheDocument();
  });

  it("adds and removes entries and toggles the timesheet page", async () => {
    const { user, calls } = await openDraft();
    const entries = screen.getByRole("region", { name: "Time entries" });

    await user.click(within(entries).getByRole("button", { name: "Remove Kickoff" }));
    expect(calls.find((c) => c.cmd === "remove_invoice_entry")?.args).toEqual({ id: 9, entryId: 1 });
    expect(within(entries).queryByText("Kickoff")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "+ Add entry" }));
    const dialog = await screen.findByRole("dialog", { name: "Add time entry" });
    await user.click(within(dialog).getByRole("button", { name: /Audit/ }));
    expect(calls.find((c) => c.cmd === "add_invoice_entry")?.args).toEqual({ id: 9, entryId: 3 });
    expect(await within(entries).findByText("Audit")).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Timesheet page" }));
    expect(calls.find((c) => c.cmd === "set_invoice_timesheet")?.args).toEqual({ id: 9, timesheet: false });
    expect(screen.getByRole("checkbox", { name: "Timesheet page" })).not.toBeChecked();
  });

  it("deletes the Draft after a confirm and goes back", async () => {
    const { user, calls } = await openDraft();

    await user.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete Scroll?" });
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(calls.some((c) => c.cmd === "delete_invoice")).toBe(true);
    expect(await screen.findByRole("heading", { name: "Scrolls" })).toBeInTheDocument();
    expect(screen.getByText("No Scrolls yet.")).toBeInTheDocument();
  });
});

describe("Send / Paid", () => {
  async function open(invoice: Invoice, plugins: Record<string, (args: Record<string, unknown>) => unknown> = {}) {
    const rendered = await openScrolls({ ...fakeCore({ invoices: [{ ...invoice }], invoice }), ...plugins });
    await rendered.user.click(await screen.findByRole("button", { name: /Acme/ }));
    await screen.findByRole("heading", { name: new RegExp(`Scroll · Acme`) });
    return rendered;
  }

  it("marks a Draft as Sent after a confirm and shows it read-only", async () => {
    const { user, calls } = await open(draft());

    await user.click(screen.getByRole("button", { name: "Mark as Sent" }));
    const dialog = await screen.findByRole("dialog", { name: "Seal this Scroll?" });
    expect(within(dialog).getByText(/due in 30 days/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Mark as Sent" }));

    expect(calls.find((c) => c.cmd === "send_invoice")?.args).toEqual({ id: 9 });
    expect(await screen.findByRole("heading", { name: "Sealed Scroll · Acme" })).toBeInTheDocument();
    expect(screen.getByText(/INV-0001/)).toBeInTheDocument();
    expect(screen.getByText("Nov 6")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ Add entry" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Timesheet page" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Time entries" })).getByText("Kickoff")).toBeInTheDocument();
  });

  it("can't send a Draft with no entries", async () => {
    await open(draft({ entries: [] }));
    expect(screen.getByRole("button", { name: "Mark as Sent" })).toBeDisabled();
  });

  it("marks a Sent Scroll Paid on the chosen date", async () => {
    const { user, calls } = await open(draft(sealed));

    await user.click(screen.getByRole("button", { name: "Mark Paid" }));
    const dialog = await screen.findByRole("dialog", { name: "Mark Paid?" });
    const date = within(dialog).getByLabelText("Paid on");
    await user.clear(date);
    await user.type(date, "2026-10-20");
    await user.click(within(dialog).getByRole("button", { name: "Mark Paid" }));

    expect(calls.find((c) => c.cmd === "mark_paid")?.args).toEqual({ id: 9, paidDate: "2026-10-20" });
    expect(await screen.findByRole("heading", { name: "Redeemed Scroll · Acme" })).toBeInTheDocument();
    expect(screen.getByText("Oct 20")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark unpaid" })).toBeInTheDocument();
  });

  it("exports a Sent invoice as a PDF wherever the save dialog says", async () => {
    const { user, calls } = await open(draft(sealed), { "plugin:dialog|save": () => "/tmp/out.pdf", "plugin:fs|write_file": () => null });

    await user.click(screen.getByRole("button", { name: "Export PDF" }));

    await waitFor(() => expect(calls.some((c) => c.cmd === "plugin:fs|write_file")).toBe(true));
    const { options } = calls.find((c) => c.cmd === "plugin:dialog|save")!.args as { options: { defaultPath: string } };
    expect(options.defaultPath).toBe("INV-0001 – Acme – 2026-10.pdf");
    const bytes = calls.find((c) => c.cmd === "plugin:fs|write_file")!.args as unknown as Uint8Array;
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  });

  it("writes nothing when the save dialog is cancelled", async () => {
    const { user, calls } = await open(draft(sealed), { "plugin:dialog|save": () => null });

    await user.click(screen.getByRole("button", { name: "Export PDF" }));

    await waitFor(() => expect(calls.some((c) => c.cmd === "plugin:dialog|save")).toBe(true));
    expect(calls.some((c) => c.cmd === "plugin:fs|write_file")).toBe(false);
  });

  it("unseals back to an editable Draft", async () => {
    const { user, calls } = await open(draft(sealed));

    await user.click(screen.getByRole("button", { name: "Unseal" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Unseal Scroll?" })).getByRole("button", { name: "Unseal" }));

    expect(calls.some((c) => c.cmd === "unseal_invoice")).toBe(true);
    expect(await screen.findByRole("heading", { name: "Unsealed Scroll · Acme" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark as Sent" })).toBeInTheDocument();
  });

  it("warns that deleting a numbered Draft leaves a gap", async () => {
    const { user } = await open(draft({ number: "INV-0004" }));

    await user.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete Scroll?" });
    expect(within(dialog).getByText(/INV-0004 won't be used again/)).toBeInTheDocument();
  });

  it("lists Sealed Scrolls with their number and flags overdue ones", async () => {
    const summary: InvoiceSummary = { ...draft(sealed), overdue: true };
    await openScrolls(fakeCore({ invoices: [summary] }));

    const sealedGroup = await screen.findByRole("region", { name: "Sealed" });
    expect(within(sealedGroup).getByText("INV-0001 · Acme")).toBeInTheDocument();
    expect(within(sealedGroup).getByText(/Overdue/)).toBeInTheDocument();
  });
});
