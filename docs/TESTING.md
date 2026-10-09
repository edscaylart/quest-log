# Testing

Both sides test behaviour through their public seam: the Rust core through its functions against a real SQLite file, the frontend by rendering screens with the Tauri IPC mocked. Where each piece sits is in [ARCHITECTURE.md](ARCHITECTURE.md).

## Running the tests

Frontend commands run from the repo root; Rust commands from `src-tauri/`. CI (`.github/workflows/ci.yml`) runs `pnpm build` (which typechecks), `pnpm test`, `cargo clippy` and `cargo test` on pull requests and on pushes to `main`.

| Task | Command |
|---|---|
| All frontend tests | `pnpm test` |
| One frontend test file | `pnpm test src/tests/log.test.tsx` |
| Frontend typecheck | `pnpm typecheck` |
| All Rust tests | `cargo test` |
| One Rust test file | `cargo test --test invoices` |
| The tray's unit tests | `cargo test --lib` |
| Rust lint, as CI runs it | `cargo clippy --all-targets -- -D warnings` |

The Rust commands need `dist/` to exist; on a fresh clone run `pnpm build` once first ([ENV.md](ENV.md)).

## Rust

Integration tests live in `src-tauri/tests/`, one file per area, and call `quest_log_lib::core` functions directly, never the Tauri commands (which are thin wrappers with no logic).

The shared test module is `src-tauri/tests/common/mod.rs`:

- **`Fixture::new()`** opens a fresh `quest-log.db` in a `tempfile` temp dir with every migration applied, so each test gets its own real SQLite database. The dir is deleted when the fixture drops.
- **`FakeClock`** implements the core's `Clock` trait. It starts at 2026-10-07 09:00 UTC, in a fixed UTC−3 zone (no DST), and tests move it with `set` (`now_plus_minutes` gives a time relative to now without moving it). Pass `&fx.clock` wherever the core takes a `&dyn Clock`.
- **`Fixture::restart()`** closes the database and reopens it, as an app restart would.

Tests are `#[tokio::test]` async functions named as sentences (`a_sent_invoice_is_overdue_only_after_its_due_date`). `src-tauri/src/tray.rs` has the only in-crate unit tests: the tray title and menu for idle and running Timers.

## Frontend

Vitest with jsdom, configured in `vite.config.ts`; `src/tests/support/setup.ts` adds the jest-dom matchers and clears the DOM and Tauri mocks after each test.

- **IPC rendering.** `renderWithIpc(<App />, commands)` in `src/tests/support/render.tsx` renders with `mockIPC` from `@tauri-apps/api/mocks`. `commands` maps a Rust command name to a handler that stands in for the core; a handler that throws rejects like a core error does, and an unmocked command rejects with `unmocked command: <name>`. It returns `user` (user-event) and `calls`, the commands invoked with their arguments. `progress` and `acknowledge_level_up` default to Level 1 with no level-up; `emptyDashboard` is a stock `dashboard` handler.
- **Events.** `renderWithIpc` mocks events too, so `emit("timer-changed", …)` (re-exported from `render.tsx`) fires an event as the tray would.
- **Plugins.** The dialog and fs plugins are plugin commands over the same IPC, so tests mock them by name in `commands` (for example `plugin:dialog|save`, `plugin:fs|write_file`).
- **PDF.** `src/tests/invoice-pdf.test.tsx` runs in the node environment (`// @vitest-environment node`) because jsdom's typed arrays garble react-pdf's compressed streams. It renders the invoice and reads its text back with `pdfPages` (`src/tests/support/pdf.ts`, pdfjs-dist).
- **Boundary checks.** `src/tests/sdk-boundary.test.ts` fails if any file outside `src/integrations/` and `src/tests/support/` imports `@tauri-apps/*` or `@react-pdf/*`. `src/tests/clients-boundary.test.ts` fails if anything but `hooks/clients/useClients` calls `listClients`.
- **`lib` unit tests** sit next to their helper as `*.test.ts` (`src/lib/format.test.ts`). Every other frontend test lives in `src/tests/`, named after the screen or domain, and drives the whole `App` the way a user would.

## Test map

| Area | Rust (`src-tauri/`) | Frontend (`src/`) |
|---|---|---|
| Shell: tabs, shortcuts, modals, error display | — | `tests/app.test.tsx` |
| Clients: create, Rate, validation, errors | `tests/clients.rs` | `tests/app.test.tsx`, `tests/clients.test.tsx` |
| Client archiving, client and project deletion | `tests/archiving.rs` | `tests/clients.test.tsx` |
| Projects: Rates, repricing, pickers | `tests/projects.rs` | `tests/clients.test.tsx` |
| Time entries and the Log | `tests/time_entries.rs` | `tests/log.test.tsx` |
| Timer: HUD and tray | `tests/timer.rs`, `src/tray.rs` (unit) | `tests/timer.test.tsx` |
| Invoices: Drafts, lines, candidates | `tests/invoices.rs` | `tests/invoices.test.tsx` |
| Invoice lifecycle: Send, Paid, numbering | `tests/lifecycle.rs` | `tests/invoices.test.tsx` |
| Invoice PDF | — | `tests/invoice-pdf.test.tsx` |
| Dashboard (Home) | `tests/dashboard.rs` | `tests/home.test.tsx`, `lib/dashboard/periodInput.test.ts` |
| Progress: XP, Level, level-up | `tests/progress.rs` | `tests/progress.test.tsx` |
| Settings | `tests/settings.rs` | `tests/settings.test.tsx` |
| Backups and restore | `tests/backups.rs` | `tests/settings.test.tsx` |
| CSV export | `tests/export.rs` | `tests/settings.test.tsx` |
| Load errors shown on every screen | — | `tests/load-errors.test.tsx` |
| Formatting helpers | — | `lib/format.test.ts` |
| Import boundaries | — | `tests/sdk-boundary.test.ts`, `tests/clients-boundary.test.ts` |
| Test helpers | `tests/common/mod.rs` | `tests/support/render.tsx`, `tests/support/setup.ts`, `tests/support/pdf.ts` |

## Pointers

- [ARCHITECTURE.md](ARCHITECTURE.md)
- [ENV.md](ENV.md)
- [TECH_STACK.md](TECH_STACK.md)
- [CONTEXT.md](CONTEXT.md)
