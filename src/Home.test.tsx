import { screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { Client, Dashboard, PeriodInput } from "./api";
import { emptyDashboard, renderWithIpc } from "./test/render";

const acme: Client = { id: 1, name: "Acme", rateCents: 8500, billingName: null, address: null, email: null, netDays: null, archived: false, hasAvailable: false };
const bolt: Client = { ...acme, id: 2, name: "Bolt" };

const figures = (seconds: number, cents: number) => ({ seconds, earnedCents: cents, uninvoicedCents: cents, invoicedUnpaidCents: 0, paidCents: 0 });

const week: Dashboard = {
  period: { start: "2026-10-05", end: "2026-10-11" },
  total: figures(5400 + 7800, 12750 + 21667),
  clients: [
    { clientId: 2, clientName: "Bolt", ...figures(7800, 21667) },
    { clientId: 1, clientName: "Acme", ...figures(5400, 12750) },
  ],
  buckets: ["05", "06", "07", "08", "09", "10", "11"].map((d, i) => ({ start: `2026-10-${d}`, seconds: i === 1 ? 7800 : i === 2 ? 5400 : 0 })),
  weekly: false,
  allTime: { invoicedUnpaidCents: 0, overdue: 0, uninvoicedCents: 99900 },
};

/** `dashboard` echoes a custom range back as the period, like core does at offset 0. */
function fakeCore({ clients = [acme, bolt], dashboard = week }: { clients?: Client[]; dashboard?: Dashboard } = {}) {
  return {
    list_clients: () => clients,
    get_client: ({ id }: Record<string, unknown>) => clients.find((c) => c.id === id),
    list_projects: () => [],
    list_time_entries: () => [],
    get_timer: () => null,
    dashboard: ({ input }: Record<string, unknown>) => {
      const { preset, start, end } = input as PeriodInput;
      return preset === "custom" && start && end ? { ...dashboard, period: { start, end } } : dashboard;
    },
    create_client: () => acme,
  };
}

const dashboardInputs = (calls: { cmd: string; args: Record<string, unknown> }[]) =>
  calls.filter((c) => c.cmd === "dashboard").map((c) => c.args.input as PeriodInput);
const lastInput = (calls: { cmd: string; args: Record<string, unknown> }[]) => dashboardInputs(calls).at(-1);

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 7, 14, 0));
});
afterEach(() => vi.useRealTimers());

describe("Home", () => {
  it("shows the five figures, the all-time strip and Patrons by Hours", async () => {
    renderWithIpc(<App />, fakeCore());

    const figuresList = await screen.findByRole("region", { name: "Period totals" });
    await vi.waitFor(() => expect(figuresList).toHaveTextContent("Hours3:40"));
    expect(figuresList).toHaveTextContent("Earned$344.17");
    expect(figuresList).toHaveTextContent("Unclaimed$344.17");
    expect(figuresList).toHaveTextContent("Owed$0.00");
    expect(figuresList).toHaveTextContent("Treasury$0.00");

    const strip = screen.getByRole("region", { name: "All time" });
    expect(strip).toHaveTextContent("Owed $0.00 · 0 overdue Scrolls");
    expect(strip).toHaveTextContent("Unclaimed $999.00");

    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows.map((r) => r.textContent)).toEqual(["Bolt2:10$216.67$216.67$0.00$0.00", "Acme1:30$127.50$127.50$0.00$0.00"]);
  });

  it("charts Hours per day with the value on hover", async () => {
    const { user } = renderWithIpc(<App />, fakeCore());

    const chart = await screen.findByRole("group", { name: "Hours per day" });
    await vi.waitFor(() => expect(within(chart).getAllByRole("button")).toHaveLength(7));
    await user.hover(within(chart).getByRole("button", { name: "Tue, Oct 6: 2:10" }));
    expect(chart).toHaveTextContent("Tue, Oct 6 · 2:10");
  });

  it("charts per week for long ranges", async () => {
    renderWithIpc(<App />, fakeCore({ dashboard: { ...week, weekly: true, buckets: [{ start: "2026-08-03", seconds: 3600 }] } }));

    const chart = await screen.findByRole("group", { name: "Hours per week" });
    expect(await within(chart).findByRole("button", { name: "Week of Aug 3: 1:00" })).toBeInTheDocument();
  });

  it("steps the period with ◀ ▶ and resets the step on a new preset", async () => {
    const { user, calls } = renderWithIpc(<App />, fakeCore());
    await vi.waitFor(() => expect(lastInput(calls)).toEqual({ preset: "1w", offset: 0, start: null, end: null }));
    expect(await screen.findByText("Oct 5 – Oct 11, 2026")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Previous period" }));
    await user.click(screen.getByRole("button", { name: "Previous period" }));
    await vi.waitFor(() => expect(lastInput(calls)).toMatchObject({ preset: "1w", offset: -2 }));
    await user.click(screen.getByRole("button", { name: "Next period" }));
    await vi.waitFor(() => expect(lastInput(calls)).toMatchObject({ offset: -1 }));

    await user.click(screen.getByRole("button", { name: "M" }));
    await vi.waitFor(() => expect(lastInput(calls)).toMatchObject({ preset: "month", offset: 0 }));
    expect(screen.getByRole("button", { name: "M" })).toHaveAttribute("aria-pressed", "true");
  });

  it("reopens on the last-used preset at its current period", async () => {
    const first = renderWithIpc(<App />, fakeCore());
    await first.user.click(await screen.findByRole("button", { name: "2W" }));
    await first.user.click(screen.getByRole("button", { name: "Previous period" }));
    first.unmount();

    const { calls } = renderWithIpc(<App />, fakeCore());
    await vi.waitFor(() => expect(dashboardInputs(calls)[0]).toEqual({ preset: "2w", offset: 0, start: null, end: null }));
    expect(await screen.findByRole("button", { name: "2W" })).toHaveAttribute("aria-pressed", "true");
  });

  it("starts Custom on the period shown, edits its dates and steps by its length", async () => {
    const { user, calls } = renderWithIpc(<App />, fakeCore());
    await screen.findByText("Oct 5 – Oct 11, 2026");

    await user.click(screen.getByRole("button", { name: "Custom" }));
    await vi.waitFor(() => expect(lastInput(calls)).toEqual({ preset: "custom", offset: 0, start: "2026-10-05", end: "2026-10-11" }));
    const from = screen.getByLabelText("From");
    expect(from).toHaveValue("2026-10-05");
    expect(screen.getByLabelText("To")).toHaveValue("2026-10-11");

    await user.clear(from);
    await user.type(from, "2026-10-01");
    await vi.waitFor(() => expect(lastInput(calls)).toEqual({ preset: "custom", offset: 0, start: "2026-10-01", end: "2026-10-11" }));

    await user.click(screen.getByRole("button", { name: "Next period" }));
    await vi.waitFor(() => expect(lastInput(calls)).toEqual({ preset: "custom", offset: 1, start: "2026-10-01", end: "2026-10-11" }));
  });

  it("shows zeros and an empty chart frame for an empty period", async () => {
    renderWithIpc(<App />, fakeCore({ dashboard: { ...emptyDashboard(), buckets: week.buckets.map((b) => ({ ...b, seconds: 0 })) } }));

    expect(await screen.findByText("No time logged — start a Timer")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Period totals" })).toHaveTextContent("Hours0:00");
    expect(within(screen.getByRole("group", { name: "Hours per day" })).getAllByRole("button")).toHaveLength(7);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("first run offers only to add the first Patron", async () => {
    const { user } = renderWithIpc(<App />, fakeCore({ clients: [] }));

    await user.click(await screen.findByRole("button", { name: "Add your first Patron" }));

    expect(screen.getByRole("dialog", { name: "New Patron" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Period totals" })).not.toBeInTheDocument();
  });

  it("opens a Patron's detail inside Home", async () => {
    const { user } = renderWithIpc(<App />, fakeCore());

    await user.click(await screen.findByRole("button", { name: "Bolt" }));

    expect(await screen.findByRole("heading", { name: "Bolt" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Home" })).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("button", { name: "◀ Back" }));
    expect(screen.getByRole("heading", { name: "Home" })).toBeInTheDocument();
  });
});
