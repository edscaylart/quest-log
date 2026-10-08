import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";
import type { Client, DraftCandidates, Invoice, InvoiceSummary, TimeEntry } from "./api";
import { emptyDashboard, renderWithIpc } from "./test/render";

const client = (id: number, name: string): Client => ({ id, name, rateCents: 8500, billingName: null, address: null, email: null, netDays: null });
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
  ...fields,
});

function fakeCore({ invoices = [] as InvoiceSummary[], invoice = draft() } = {}) {
  let current = invoice;
  let list = invoices;
  return {
    list_clients: () => [acme, bolt],
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
  };
}

async function openScrolls(core: ReturnType<typeof fakeCore>) {
  const rendered = renderWithIpc(<App />, core);
  await rendered.user.click(screen.getByRole("tab", { name: "Scrolls" }));
  await screen.findByRole("heading", { name: "Scrolls" });
  return rendered;
}

describe("Scrolls", () => {
  it("groups Scrolls under Unsealed and opens a Draft", async () => {
    const summary: InvoiceSummary = { id: 9, clientId: 1, clientName: "Acme", state: "draft", period: { start: "2026-10-01", end: "2026-10-07" }, seconds: 9061, totalCents: 26644 };
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
