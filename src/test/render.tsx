import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockIPC } from "@tauri-apps/api/mocks";
import type { ReactElement } from "react";

type Handler = (args: Record<string, unknown>) => unknown;

/**
 * Render a screen with Tauri IPC mocked: `commands` stands in for the core API.
 * A handler that throws rejects the invoke, like a core error does.
 */
export function renderWithIpc(ui: ReactElement, commands: Record<string, Handler>) {
  const calls: { cmd: string; args: Record<string, unknown> }[] = [];
  mockIPC((cmd, args) => {
    const handler = commands[cmd];
    if (!handler) throw new Error(`unmocked command: ${cmd}`);
    calls.push({ cmd, args: args as Record<string, unknown> });
    return handler(args as Record<string, unknown>);
  }, { shouldMockEvents: true });
  return { user: userEvent.setup(), calls, ...render(ui) };
}
