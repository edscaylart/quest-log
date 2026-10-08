import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockIPC } from "@tauri-apps/api/mocks";
import type { ReactElement } from "react";

type Handler = (args: Record<string, unknown>) => unknown;

/** Lv 1, nothing to celebrate. */
export const startingProgress = () => ({ level: 1, xp: 0, levelXp: 0, nextLevelXp: 600, levelUp: null });

/**
 * Render a screen with Tauri IPC mocked: `commands` stands in for the core API.
 * A handler that throws rejects the invoke, like a core error does.
 * The HUD's progress commands default to Lv 1 for screens that don't care.
 */
export function renderWithIpc(ui: ReactElement, screenCommands: Record<string, Handler>) {
  const commands: Record<string, Handler> = { progress: startingProgress, acknowledge_level_up: () => null, ...screenCommands };
  const calls: { cmd: string; args: Record<string, unknown> }[] = [];
  mockIPC((cmd, args) => {
    const handler = commands[cmd];
    if (!handler) throw new Error(`unmocked command: ${cmd}`);
    calls.push({ cmd, args: args as Record<string, unknown> });
    return handler(args as Record<string, unknown>);
  }, { shouldMockEvents: true });
  return { user: userEvent.setup(), calls, ...render(ui) };
}

const zero = { seconds: 0, earnedCents: 0, uninvoicedCents: 0, invoicedUnpaidCents: 0, paidCents: 0 };

/** A `dashboard` handler for screens that don't care about Home. */
export const emptyDashboard = () => ({
  period: { start: "2026-10-05", end: "2026-10-11" },
  total: zero,
  clients: [],
  buckets: [],
  weekly: false,
  allTime: { invoicedUnpaidCents: 0, overdue: 0, uninvoicedCents: 0 },
});
