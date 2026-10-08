import { act, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { Progress, Stopped, Timer } from "./api";
import { emptyDashboard, renderWithIpc } from "./test/render";

const acme = { id: 1, name: "Acme", rateCents: 8500, billingName: null, address: null, email: null, netDays: null };
const lv2: Progress = { level: 2, xp: 900, levelXp: 600, nextLevelXp: 1800, levelUp: null };
const running: Timer = { clientId: 1, clientName: "Acme", projectId: null, projectName: null, startedAt: Date.now(), note: null };

function fakeCore({ progress = lv2, timer = null as Timer | null } = {}) {
  return {
    list_clients: () => [acme],
    list_time_entries: () => [],
    get_timer: () => timer,
    dashboard: emptyDashboard,
    progress: () => progress,
    acknowledge_level_up: ({ level }: Record<string, unknown>) => {
      progress = { ...progress, levelUp: progress.levelUp === level ? null : progress.levelUp };
    },
    stop_timer: (): Stopped => {
      timer = null;
      progress = { level: 3, xp: 1800, levelXp: 1800, nextLevelXp: 3600, levelUp: 3 };
      return { kind: "saved", entry: { id: 1, clientId: 1, clientName: "Acme", projectId: null, projectName: null, rateCents: 8500, date: "2026-10-07", seconds: 900 * 60, startedAt: null, endedAt: null, note: null } };
    },
  };
}

beforeEach(() => vi.spyOn(document, "hasFocus").mockReturnValue(true));
afterEach(() => vi.useRealTimers());

describe("HUD Level", () => {
  it("shows Lv and the XP bar towards the next Level", async () => {
    renderWithIpc(<App />, fakeCore());
    const hud = screen.getByRole("banner");

    expect(await within(hud).findByText("Lv 2")).toBeInTheDocument();
    const bar = within(hud).getByRole("progressbar", { name: "XP" });
    expect(bar).toHaveAttribute("aria-valuenow", "300");
    expect(bar).toHaveAttribute("aria-valuemax", "1200");
  });

  it("updates after the Timer stops", async () => {
    const { user } = renderWithIpc(<App />, fakeCore({ timer: running }));
    const hud = screen.getByRole("banner");
    await within(hud).findByText("Lv 2");

    await user.click(within(hud).getByRole("button", { name: "Stop" }));

    expect(await within(hud).findByText("Lv 3")).toBeInTheDocument();
  });
});

describe("level-up banner", () => {
  it("shows a new highest Level once, acknowledges it and dismisses", async () => {
    const { user, calls } = renderWithIpc(<App />, fakeCore({ progress: { ...lv2, levelUp: 2 } }));

    expect(await screen.findByRole("status")).toHaveTextContent("LEVEL UP! Lv 2");
    expect(calls).toContainEqual({ cmd: "acknowledge_level_up", args: { level: 2 } });

    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("auto-hides after about 5 seconds", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
    renderWithIpc(<App />, fakeCore({ progress: { ...lv2, levelUp: 2 } }));
    await screen.findByRole("status");

    await act(() => vi.advanceTimersByTimeAsync(5000));

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("waits until the window is in front", async () => {
    vi.mocked(document.hasFocus).mockReturnValue(false);
    const { calls } = renderWithIpc(<App />, fakeCore({ progress: { ...lv2, levelUp: 2 } }));
    await screen.findByText("Lv 2");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(calls.map((c) => c.cmd)).not.toContain("acknowledge_level_up");

    vi.mocked(document.hasFocus).mockReturnValue(true);
    act(() => void window.dispatchEvent(new Event("focus")));

    expect(await screen.findByRole("status")).toHaveTextContent("LEVEL UP! Lv 2");
  });

  it("shows a level-up reached by stopping the Timer", async () => {
    const { user } = renderWithIpc(<App />, fakeCore({ timer: running }));
    await screen.findByText("Lv 2");

    await user.click(screen.getByRole("button", { name: "Stop" }));

    expect(await screen.findByRole("status")).toHaveTextContent("LEVEL UP! Lv 3");
  });
});
