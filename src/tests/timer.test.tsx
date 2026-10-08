import { act, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";
import type { Client } from "@/lib/clients/types";
import type { TimeEntry } from "@/lib/time-entries/types";
import type { Stopped, Timer } from "@/lib/timer/types";
import { emit } from "@tauri-apps/api/event";
import { emptyDashboard, renderWithIpc } from "@/tests/support/render";

const acme: Client = { id: 1, name: "Acme", rateCents: 8500, billingName: null, address: null, email: null, netDays: null, archived: false, hasAvailable: false };
const bolt: Client = { id: 2, name: "Bolt", rateCents: 12000, billingName: null, address: null, email: null, netDays: null, archived: false, hasAvailable: false };

const now = new Date(2026, 9, 7, 14, 0);
const minutesAgo = (m: number) => now.getTime() - m * 60_000;

function fakeCore({ clients = [acme, bolt], timer = null as Timer | null, entries = [] as TimeEntry[], stopped = null as Stopped | null } = {}) {
  return {
    list_clients: () => clients,
    last_used: () => ({ clientId: 2, projectId: null }),
    list_time_entries: () => entries,
    get_timer: () => timer,
    dashboard: emptyDashboard,
    list_projects: () => [],
    start_timer: ({ input }: Record<string, unknown>) => {
      const { clientId, note } = input as { clientId: number; note: string | null };
      timer = { clientId, clientName: clients.find((c) => c.id === clientId)!.name, projectId: null, projectName: null, startedAt: Date.now(), note };
      return null;
    },
    stop_timer: () => {
      timer = null;
      return stopped;
    },
    discard_timer: () => {
      timer = null;
    },
    update_timer: () => timer,
    finish_timer: () => {
      timer = null;
      return entries[0];
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"], shouldAdvanceTime: true });
  vi.setSystemTime(now);
});
afterEach(() => vi.useRealTimers());

describe("HUD Timer", () => {
  it("disables Start while there are no Patrons", async () => {
    renderWithIpc(<App />, fakeCore({ clients: [] }));

    await vi.waitFor(() => expect(screen.getByRole("button", { name: "▶ Start" })).toBeDisabled());
  });

  it("starts from the HUD with the last used Patron pre-filled", async () => {
    const { user, calls } = renderWithIpc(<App />, fakeCore());

    await vi.waitFor(() => expect(screen.getByRole("button", { name: "▶ Start" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "▶ Start" }));
    const dialog = screen.getByRole("dialog", { name: "Start Timer" });
    await vi.waitFor(() => expect(within(dialog).getByLabelText("Patron")).toHaveValue("2"));
    await user.click(within(dialog).getByRole("button", { name: "Start" }));

    expect(calls).toContainEqual({ cmd: "start_timer", args: { input: { clientId: 2, projectId: null, note: null } } });
    const hud = screen.getByRole("banner");
    expect(await within(hud).findByRole("timer")).toHaveTextContent("0:00:00");
    expect(hud).toHaveTextContent("Bolt");
  });

  it("shows a running Timer as H:MM:SS that keeps counting, and stops it", async () => {
    const { user, calls } = renderWithIpc(<App />, fakeCore({ timer: { clientId: 1, clientName: "Acme", projectId: null, projectName: null, startedAt: minutesAgo(65), note: null } }));
    const hud = screen.getByRole("banner");

    expect(await within(hud).findByRole("timer")).toHaveTextContent("1:05:00");
    expect(hud).toHaveTextContent("Acme");
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(within(hud).getByRole("timer")).toHaveTextContent("1:05:03");

    await user.click(within(hud).getByRole("button", { name: "Stop" }));

    expect(calls.map((c) => c.cmd)).toContain("stop_timer");
    expect(await within(hud).findByRole("button", { name: "▶ Start" })).toBeInTheDocument();
  });

  it("discards a running Timer", async () => {
    const { user, calls } = renderWithIpc(<App />, fakeCore({ timer: { clientId: 1, clientName: "Acme", projectId: null, projectName: null, startedAt: minutesAgo(5), note: null } }));

    await user.click(await screen.findByRole("button", { name: "Discard" }));

    expect(calls.map((c) => c.cmd)).toContain("discard_timer");
    expect(calls.map((c) => c.cmd)).not.toContain("stop_timer");
    expect(await screen.findByRole("button", { name: "▶ Start" })).toBeInTheDocument();
  });

  it("⌘T opens Start when idle and stops when running", async () => {
    const { user, calls } = renderWithIpc(<App />, fakeCore());
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "▶ Start" })).toBeEnabled());

    await user.keyboard("{Meta>}t{/Meta}");
    const dialog = screen.getByRole("dialog", { name: "Start Timer" });
    await vi.waitFor(() => expect(within(dialog).getByLabelText("Patron")).toHaveValue("2"));
    await user.click(within(dialog).getByRole("button", { name: "Start" }));
    await screen.findByRole("timer");

    await user.keyboard("{Meta>}t{/Meta}");

    expect(calls.map((c) => c.cmd)).toContain("stop_timer");
    expect(await screen.findByRole("button", { name: "▶ Start" })).toBeInTheDocument();
  });

  it("hints after 12 hours running", async () => {
    renderWithIpc(<App />, fakeCore({ timer: { clientId: 1, clientName: "Acme", projectId: null, projectName: null, startedAt: minutesAgo(12 * 60 - 1), note: null } }));
    await screen.findByRole("timer");
    expect(screen.queryByText("Still working?")).not.toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(60_000));

    expect(screen.getByText("Still working?")).toBeInTheDocument();
  });

  it("edits a running Timer, sending the start only when it moved", async () => {
    const startedAt = new Date(2026, 9, 7, 9, 0).getTime();
    const { user, calls } = renderWithIpc(<App />, fakeCore({ timer: { clientId: 1, clientName: "Acme", projectId: null, projectName: null, startedAt, note: "Design" } }));

    await user.click(await screen.findByRole("button", { name: /Edit Timer/ }));
    const dialog = screen.getByRole("dialog", { name: "Edit Timer" });
    expect(within(dialog).getByLabelText("Start")).toHaveValue("2026-10-07T09:00");
    await user.clear(within(dialog).getByLabelText("Note"));
    await user.type(within(dialog).getByLabelText("Note"), "Review");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(calls).toContainEqual({ cmd: "update_timer", args: { input: { clientId: 1, projectId: null, note: "Review", start: null } } });
  });

  it("opens the entry editor when a Timer stops past 24 hours", async () => {
    const { user, calls } = renderWithIpc(
      <App />,
      fakeCore({
        timer: { clientId: 1, clientName: "Acme", projectId: null, projectName: null, startedAt: minutesAgo(25 * 60), note: null },
        stopped: { kind: "needsEdit", overlong: { clientId: 1, projectId: null, date: "2026-10-06", seconds: 25 * 3600, note: null } },
      }),
    );

    await user.click(await screen.findByRole("button", { name: "Stop" }));
    const dialog = await screen.findByRole("dialog", { name: "Fix Timer entry" });
    expect(within(dialog).getByLabelText("Duration")).toHaveValue("25:00");
    await user.clear(within(dialog).getByLabelText("Duration"));
    await user.type(within(dialog).getByLabelText("Duration"), "9:00");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(calls).toContainEqual({
      cmd: "finish_timer",
      args: { input: { clientId: 1, projectId: null, date: "2026-10-06", span: { mode: "duration", duration: "9:00" }, note: "" } },
    });
  });

  it("▶ on a Log row resumes with the same Patron and note", async () => {
    const entry: TimeEntry = { id: 1, clientId: 2, clientName: "Bolt", projectId: null, projectName: null, rateCents: 8500, date: "2026-10-06", seconds: 600, startedAt: null, endedAt: null, note: "Kickoff", locked: false };
    const { user, calls } = renderWithIpc(<App />, fakeCore({ entries: [entry] }));
    await user.click(screen.getByRole("tab", { name: "Log" }));

    await user.click(await screen.findByRole("button", { name: "Resume" }));

    expect(calls).toContainEqual({ cmd: "start_timer", args: { input: { clientId: 2, projectId: null, note: "Kickoff" } } });
    expect(await screen.findByRole("timer")).toHaveTextContent("0:00:00");
  });

  it("shows a failed Stop or Resume instead of swallowing it", async () => {
    const entry: TimeEntry = { id: 1, clientId: 2, clientName: "Bolt", projectId: null, projectName: null, rateCents: 8500, date: "2026-10-06", seconds: 600, startedAt: null, endedAt: null, note: null, locked: false };
    const { user } = renderWithIpc(<App />, {
      ...fakeCore({ timer: { clientId: 1, clientName: "Acme", projectId: null, projectName: null, startedAt: minutesAgo(5), note: null }, entries: [entry] }),
      stop_timer: () => {
        throw { kind: "notFound", message: "No Timer is running" };
      },
      start_timer: () => {
        throw { kind: "invalid", field: "client", message: "Client is required" };
      },
    });

    await user.click(await screen.findByRole("button", { name: "Stop" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No Timer is running");

    await user.click(screen.getByRole("tab", { name: "Log" }));
    await user.click(await screen.findByRole("button", { name: "Resume" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Client is required");
  });
});

describe("tray Timer", () => {
  it("refreshes the HUD when the tray changes the Timer", async () => {
    const core = fakeCore();
    renderWithIpc(<App />, core);
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "▶ Start" })).toBeEnabled());

    core.start_timer({ input: { clientId: 1, projectId: null, note: null } });
    await emit("timer-changed", null);

    expect(await screen.findByRole("timer")).toHaveTextContent("0:00:00");
  });

  it("opens the entry editor when a tray Stop needs editing", async () => {
    renderWithIpc(<App />, fakeCore());
    await screen.findByRole("button", { name: "▶ Start" });

    await emit("timer-changed", { kind: "needsEdit", overlong: { clientId: 1, projectId: null, date: "2026-10-06", seconds: 25 * 3600, note: null } });

    expect(await screen.findByRole("dialog", { name: "Fix Timer entry" })).toBeInTheDocument();
  });

  it("opens the Start modal when the tray has no last-used Patron", async () => {
    renderWithIpc(<App />, fakeCore());
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "▶ Start" })).toBeEnabled());

    await emit("tray-start");

    expect(await screen.findByRole("dialog", { name: "Start Timer" })).toBeInTheDocument();
  });

  it("shows a failed tray action", async () => {
    renderWithIpc(<App />, fakeCore());
    await screen.findByRole("button", { name: "▶ Start" });

    await emit("tray-error", { kind: "notFound", message: "No Timer is running" });

    expect(await screen.findByRole("alert")).toHaveTextContent("No Timer is running");
  });
});
