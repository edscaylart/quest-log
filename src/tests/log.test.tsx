import { act, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";
import type { Client } from "@/lib/clients/types";
import type { EntryInput, TimeEntry } from "@/lib/time-entries/types";
import { emptyDashboard, renderWithIpc } from "@/tests/support/render";

const acme: Client = { id: 1, name: "Acme", rateCents: 8500, billingName: null, address: null, email: null, netDays: null, archived: false, hasAvailable: false };
const bolt: Client = { id: 2, name: "Bolt", rateCents: 12000, billingName: null, address: null, email: null, netDays: null, archived: false, hasAvailable: false };

const unix = (...local: [number, number, number, number, number]) => new Date(...local).getTime() / 1000;

function entry(fields: Partial<TimeEntry> & Pick<TimeEntry, "id" | "date" | "seconds">): TimeEntry {
  return { clientId: 1, clientName: "Acme", projectId: null, projectName: null, rateCents: 8500, startedAt: null, endedAt: null, note: null, locked: false, ...fields };
}

function fakeCore(entries: TimeEntry[] = [], lastUsed: number | null = null) {
  return {
    list_clients: () => [acme, bolt],
    last_used: () => (lastUsed ? { clientId: lastUsed, projectId: null } : null),
    get_timer: () => null,
    dashboard: emptyDashboard,
    list_projects: () => [],
    list_time_entries: ({ clientId }: Record<string, unknown>) =>
      entries.filter((e) => clientId == null || e.clientId === clientId),
    create_time_entry: ({ input }: Record<string, unknown>) => {
      const { clientId, date, note } = input as EntryInput;
      const created = entry({ id: entries.length + 1, clientId, date, seconds: 5400, note, clientName: "Bolt" });
      entries = [created, ...entries];
      return created;
    },
    update_time_entry: () => entries[0],
    delete_time_entry: ({ id }: Record<string, unknown>) => {
      entries = entries.filter((e) => e.id !== id);
    },
  };
}

async function openLog(core: Parameters<typeof renderWithIpc>[1]) {
  const rendered = renderWithIpc(<App />, core);
  await rendered.user.click(screen.getByRole("tab", { name: "Log" }));
  return rendered;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 7, 14, 0));
});
afterEach(() => vi.useRealTimers());

describe("Log", () => {
  it("groups entries by day, newest first, with day totals", async () => {
    await openLog(
      fakeCore([
        entry({ id: 3, date: "2026-10-06", seconds: 5400, note: "Kickoff" }),
        entry({ id: 2, date: "2026-10-06", seconds: 2700, clientId: 2, clientName: "Bolt" }),
        entry({ id: 1, date: "2026-10-05", seconds: 600 }),
      ]),
    );

    const days = await screen.findAllByRole("region");
    expect(days.map((d) => d.getAttribute("aria-label"))).toEqual(["Tue, Oct 6", "Mon, Oct 5"]);
    expect(within(days[0]).getByRole("heading")).toHaveTextContent("2:15");
    const rows = within(days[0]).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent(/Acme.*Kickoff.*1:30/);
    expect(rows[1]).toHaveTextContent(/Bolt.*0:45/);
    expect(within(days[1]).getByRole("heading")).toHaveTextContent("0:10");
  });

  it("filters by Patron", async () => {
    const { user, calls } = await openLog(
      fakeCore([entry({ id: 1, date: "2026-10-06", seconds: 60 }), entry({ id: 2, date: "2026-10-06", seconds: 60, clientId: 2, clientName: "Bolt" })]),
    );
    expect(await screen.findAllByRole("listitem")).toHaveLength(2);

    await user.selectOptions(screen.getByLabelText("Patron filter"), "Bolt");

    expect(calls).toContainEqual({ cmd: "list_time_entries", args: { clientId: 2 } });
    await vi.waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));
    expect(screen.getByRole("listitem")).toHaveTextContent("Bolt");
  });

  it("never lets a slower, older load replace a newer filter's entries", async () => {
    let release = () => {};
    const held = new Promise<void>((r) => (release = r));
    const core = fakeCore([entry({ id: 1, date: "2026-10-06", seconds: 60 }), entry({ id: 2, date: "2026-10-06", seconds: 60, clientId: 2, clientName: "Bolt" })]);
    const { user } = await openLog({
      ...core,
      // All Patrons answers only after Bolt's list is on screen.
      list_time_entries: async (args) => {
        if (args.clientId == null) await held;
        return core.list_time_entries(args);
      },
    });

    await user.selectOptions(screen.getByLabelText("Patron filter"), await screen.findByRole("option", { name: "Bolt" }));
    await vi.waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));
    await act(async () => {
      release();
      await new Promise((r) => setTimeout(r));
    });

    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("listitem")).toHaveTextContent("Bolt");
  });

  it("⌘N opens a new entry pre-filled with the last used Patron and today, and saves by duration", async () => {
    const { user, calls } = renderWithIpc(<App />, fakeCore([], 2));

    await user.keyboard("{Meta>}n{/Meta}");
    const dialog = await screen.findByRole("dialog", { name: "New time entry" });
    await vi.waitFor(() => expect(within(dialog).getByLabelText("Patron")).toHaveValue("2"));
    expect(within(dialog).getByLabelText("Date")).toHaveValue("2026-10-07");

    await user.type(within(dialog).getByLabelText("Duration"), "1:30");
    await user.type(within(dialog).getByLabelText("Note"), "Kickoff");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(calls).toContainEqual({
      cmd: "create_time_entry",
      args: { input: { clientId: 2, projectId: null, date: "2026-10-07", span: { mode: "duration", duration: "1:30" }, note: "Kickoff" } },
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(await screen.findByRole("listitem")).toHaveTextContent("Kickoff");
  });

  it("saves by start and end", async () => {
    const { user, calls } = await openLog(fakeCore());
    await user.click(await screen.findByRole("button", { name: "New time entry" }));
    const dialog = screen.getByRole("dialog");

    await user.click(within(dialog).getByRole("button", { name: "Start–End" }));
    await user.type(within(dialog).getByLabelText("Start"), "09:15");
    await user.type(within(dialog).getByLabelText("End"), "17:45");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(calls).toContainEqual({
      cmd: "create_time_entry",
      args: { input: { clientId: 1, projectId: null, date: "2026-10-07", span: { mode: "range", start: "09:15", end: "17:45" }, note: "" } },
    });
  });

  it("shows the core's validation message on its field", async () => {
    const { user } = await openLog({
      ...fakeCore(),
      create_time_entry: () => {
        throw { kind: "invalid", field: "date", message: "Date can't be in the future" };
      },
    });
    await user.click(await screen.findByRole("button", { name: "New time entry" }));
    const dialog = screen.getByRole("dialog");

    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findByText("Date can't be in the future")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Date")).toHaveAttribute("aria-invalid", "true");
  });

  it("opens an entry for editing and saves its changes", async () => {
    const start = unix(2026, 9, 6, 9, 15);
    const { user, calls } = await openLog(
      fakeCore([entry({ id: 7, date: "2026-10-06", seconds: 3600, startedAt: start, endedAt: start + 3600, note: "Call" })]),
    );

    await user.click(await screen.findByRole("button", { name: /Acme/ }));
    const dialog = screen.getByRole("dialog", { name: "Edit time entry" });
    expect(within(dialog).getByLabelText("Start")).toHaveValue("09:15");
    expect(within(dialog).getByLabelText("End")).toHaveValue("10:15");
    expect(within(dialog).getByLabelText("Note")).toHaveValue("Call");

    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(calls).toContainEqual({
      cmd: "update_time_entry",
      args: { id: 7, input: { clientId: 1, projectId: null, date: "2026-10-06", span: { mode: "range", start: "09:15", end: "10:15" }, note: "Call" } },
    });
  });

  it("deletes an entry after confirming", async () => {
    const { user, calls } = await openLog(fakeCore([entry({ id: 7, date: "2026-10-06", seconds: 3600 })]));
    await user.click(await screen.findByRole("button", { name: /Acme/ }));

    await user.click(screen.getByRole("button", { name: "Delete" }));
    const confirm = screen.getByRole("dialog", { name: "Delete time entry?" });
    expect(calls.some((c) => c.cmd === "delete_time_entry")).toBe(false);
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));

    expect(calls).toContainEqual({ cmd: "delete_time_entry", args: { id: 7 } });
    expect(await screen.findByText("No time logged yet.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("marks locked entries and opens them read-only", async () => {
    const { user } = await openLog(
      fakeCore([entry({ id: 8, date: "2026-10-06", seconds: 3600, note: "Billed", locked: true }), entry({ id: 7, date: "2026-10-05", seconds: 600 })]),
    );

    const rows = await screen.findAllByRole("listitem");
    expect(within(rows[0]).getByRole("img", { name: "Locked" })).toBeInTheDocument();
    expect(within(rows[1]).queryByRole("img", { name: "Locked" })).not.toBeInTheDocument();

    await user.click(within(rows[0]).getByRole("button", { name: /Billed/ }));
    const dialog = screen.getByRole("dialog", { name: "Time entry" });
    expect(within(dialog).getByText(/Unseal it to change this entry/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Note")).toBeDisabled();
    expect(within(dialog).queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes the entry modal on Esc", async () => {
    const { user } = await openLog(fakeCore());
    await user.click(await screen.findByRole("button", { name: "New time entry" }));

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
