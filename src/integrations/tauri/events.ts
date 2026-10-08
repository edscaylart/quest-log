import { listen } from "@tauri-apps/api/event";
import type { Stopped } from "@/lib/timer/types";

// The tray drives the same core as the window and reports through these events.
// Each resolves to its unlisten function.

export const onTimerChanged = (handler: (outcome: Stopped | null) => void) => listen<Stopped | null>("timer-changed", (e) => handler(e.payload));
export const onTrayError = (handler: (err: unknown) => void) => listen<unknown>("tray-error", (e) => handler(e.payload));
export const onTrayStart = (handler: () => void) => listen("tray-start", () => handler());
