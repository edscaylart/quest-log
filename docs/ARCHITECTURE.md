# Architecture

Quest Log is a [Tauri 2](https://tauri.app) app: a React + TypeScript frontend in `src/` and a Rust core in `src-tauri/` that owns one SQLite database. This page is the hub: the whole-app map, the folder and import rules, the decision index and the doc index. Domain terms are as defined in [CONTEXT.md](CONTEXT.md).

## Whole-app map

```
 src/  (React, in the system WebView)                     src-tauri/  (Rust)
 ─────────────────────────────────────                    ───────────────────────────────────────
 main.tsx → App.tsx (tabs, nav stacks, shortcuts,
                     Timer and tray listeners)
   │
   ▼
 pages/ ──► components/<domain>/ ──► hooks/ ──► lib/<domain>/   (pure logic, domain types)
   │              │                    │
   └──────────────┴────────────────────┴──► integrations/
                                             ├─ tauri/commands.ts ── invoke ──► lib.rs commands ─┐
                                             ├─ tauri/events.ts ◄── emit ───── tray.rs ──────────┤
                                             ├─ tauri/files.ts ──► dialog + fs plugins           │
                                             └─ pdf/invoicePdf.tsx (react-pdf → files.ts)        ▼
                                                                                         core/<module>.rs
                                                                                                │ sqlx
                                                                                                ▼
                                                                                  quest-log.db (SQLite)
                                                                                  + backups/ beside it
```

### Frontend (`src/`)

| Layer | What lives there |
|---|---|
| `main.tsx`, `App.tsx` | Entry point and shell. `App` owns the four tabs (Home, Log, Clients, Invoices), each tab's push stack (`hooks/useNav.ts`), keyboard shortcuts, the HUD, the level-up banner, and the `timer-changed` / `tray-error` listeners. |
| `pages/` | One per screen: `Home`, `Log`, `Invoices`, `Invoice`, `Clients`, `Client`, `Project`, `Settings`. Each loads its data and lays out components. Only `App` imports pages. |
| `components/<domain>/` | The UI pieces of each domain: `clients`, `projects`, `time-entries`, `timer` (the HUD), `invoices`, `dashboard`, `progress`, `settings`, plus `ui` (Modal, Field, Confirm, ErrorLine). Components call the command wrappers directly for one-off mutations. |
| `hooks/` | Shared state logic. Top level: `useLoad` (one IPC load with loading/error), `useFormAction` (a submit with busy/error), `useNav` (push stacks). Per domain: `clients/useClients` (the only way a Client list loads), `dashboard/useDashboard` (the Home period, saved and auto-refreshed), `projects/useRateEdit` (Client and Project Rate repricing), `timer/useElapsed` (the live Timer clock). |
| `lib/<domain>/` | Pure logic and the domain types mirroring the Rust structs. Top level: `format` (money, hours, dates), `errors` (`CoreError` decoding), `labels` (the RPG labels). |
| `integrations/` | The only home of third-party SDKs. `tauri/commands.ts`: one wrapper per Rust command. `tauri/events.ts`: `onTimerChanged`, `onTrayError`, `onTrayStart`. `tauri/files.ts`: open/save panels and file writes. `pdf/invoicePdf.tsx`: renders and saves the invoice PDF. |
| `styles/` | `global.css` and the bundled IBM Plex Mono font. |
| `tests/` | Screen tests, the PDF test and the boundary checks; helpers in `tests/support/`. See [TESTING.md](TESTING.md). |

### Tauri bridge

- **Commands** (frontend → core): `src-tauri/src/lib.rs` registers 50 `#[tauri::command]` functions, each a thin wrapper over one core function with no logic. Each has a twin in `src/integrations/tauri/commands.ts` (`create_client` ↔ `createClient`). A failing command rejects with the serialized `CoreError`, which `lib/errors.ts` decodes.
- **Events** (core → frontend), all emitted by the tray:
  - `timer-changed`: the tray started, stopped or discarded the Timer; payload is what a stop did, or null. `App` refreshes and may show the level-up or overlong prompt.
  - `tray-error`: a tray action failed; the window is shown and `App` displays the error.
  - `tray-start`: the tray's Start needs a client picked; the HUD opens its start form.
- **Plugins**: dialog (panels, update dialogs), fs (the frontend may only write files), updater (release builds check GitHub Releases on launch). Permissions are in `src-tauri/capabilities/default.json`; versions and roles in [TECH_STACK.md](TECH_STACK.md).

### Rust (`src-tauri/src/`)

| File | Role |
|---|---|
| `main.rs` | Calls `quest_log_lib::run()`. |
| `lib.rs` | App setup: opens the database (`core::open`), takes the daily backup, registers plugins, the commands and the tray, hides the window on close, checks for updates in release builds. |
| `tray.rs` | The menu-bar Timer: a thin driver over `core::timer` that refreshes its title every second and emits the events above. Has its own `#[cfg(test)]` unit tests. |
| `core/mod.rs` | `Db` (the sqlx pool), `open` (migrate, with a pre-migration backup), the `Clock` trait and `SystemClock`, and `CoreError`. |
| `core/clients.rs` | Clients, Rates and repricing previews, archiving, deletion; shared parsing helpers (`amount`, `parse_rate`, `parse_net_days`). |
| `core/projects.rs` | Projects under a client, completion, deletion, project Rates. |
| `core/time_entries.rs` | Time entries, validation, the last-used client/project. |
| `core/timer.rs` | The single running Timer: start, edit, stop into a time entry, discard. |
| `core/invoices.rs` | Draft candidates, Drafts, Send (snapshot + frozen Rates), Paid, numbering. |
| `core/dashboard.rs` | Periods and the Home figures: earned, uninvoiced, invoiced-unpaid, paid, buckets, all-time. |
| `core/progress.rs` | XP and Level, the pending level-up. |
| `core/settings.rs` | Seller details, default Net days, invoice prefix and next number. |
| `core/backups.rs` | Daily, pre-migration and pre-restore backups, Back up now, inspect and restore. |
| `core/export.rs` | CSV export of a period's time entries. |

Core modules depend only on `core/mod.rs` and each other (for example `invoices` uses `dashboard::period` and `clients::amount`); none knows about Tauri. Every core function that needs the time takes a `&dyn Clock`, so tests can fix it.

### SQLite

One file, `quest-log.db`, in the app data directory, with `backups/` beside it. `src-tauri/migrations/` is the schema's source of truth, embedded with `sqlx::migrate!()` and applied by `core::open` on launch. Tables, enums and invariants: [DATABASE.md](DATABASE.md). Paths: [ENV.md](ENV.md).

## Folder rules

Why this layout: [ADR 0002](adr/0002-frontend-layout.md).

- A file's kind picks its top-level folder (`pages`, `components`, `hooks`, `lib`, `integrations`, `styles`, `tests`); its domain picks the subfolder.
- Domain subfolders use the canonical glossary terms, matching the Rust `core` modules: `clients`, `projects`, `time-entries`, `timer`, `invoices`, `dashboard`, `progress`, `settings`, plus `backups` in `lib`. Never the RPG labels. `components/ui` holds shared primitives.
- Code used by every domain sits at the top of its kind folder (`hooks/useLoad.ts`, `lib/format.ts`).
- One exported component per file. A private helper component stays in its file until a second file needs it, then moves to its own file.
- Naming: PascalCase for components and pages, `useThing` for hooks, camelCase for other modules, kebab-case for domain folders and test files.
- Imports from nested folders use the `@/` → `src` alias. No barrel (index re-export) files.
- `lib` unit tests sit next to their helper (`lib/format.test.ts`). Every other frontend test lives in `src/tests/`, named after the screen or domain it covers.
- Rust: one `core` module per domain, one Tauri command per core function in `lib.rs`, integration tests in `src-tauri/tests/` named after the module.

## Import rules

Imports point one way, down the map:

- `lib` is pure and imports nothing from the app except other `lib` modules.
- `integrations` import only `lib` and other `integrations` (the PDF save uses `tauri/files.ts`).
- `hooks` import `integrations`, `lib` and other hooks.
- `components` import `hooks`, `lib`, other components of any domain, and `integrations` for one-off actions (command wrappers, `onTrayStart`, file panels, the PDF).
- `pages` import anything. Only `App` imports pages.
- Tauri and react-pdf packages are imported only inside `integrations/` (and the test helpers that mock them). `src/tests/sdk-boundary.test.ts` enforces this.
- Client lists load only through `hooks/clients/useClients`. `src/tests/clients-boundary.test.ts` enforces this.
- The other rules are enforced by review.

## Decision index

- [ADR 0001](adr/0001-tauri-for-macos-only-app.md): Tauri 2 + React + SQLite rather than SwiftUI or Electron, for a macOS-only app.
- [ADR 0002](adr/0002-frontend-layout.md): frontend folders by kind with domain subfolders, one-way imports, no ESLint or TanStack Query.

## Doc index

| Doc | What it covers |
|---|---|
| [README.md](../README.md) | What Quest Log is, install, build, where your data is. |
| [AGENTS.md](../AGENTS.md) | Read-first list for coding agents. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | This page. |
| [CONTEXT.md](CONTEXT.md) | Domain glossary, RPG labels and domain rules. |
| [DATABASE.md](DATABASE.md) | Tables, enums, invariants, migrations and backups. |
| [TESTING.md](TESTING.md) | How both sides are tested, and which test covers which area. |
| [TECH_STACK.md](TECH_STACK.md) | Every dependency and what it does here. |
| [ENV.md](ENV.md) | Toolchain, commands, where data lives, configuration. |
| [adr/](adr/) | Architecture decisions, indexed above. |
| [agents/issue-tracker.md](agents/issue-tracker.md) | Skill config: GitHub Issues via `gh`. |
| [agents/triage-labels.md](agents/triage-labels.md) | Skill config: the triage labels. |
| [agents/domain.md](agents/domain.md) | Skill config: how skills read the domain docs. |

## Pointers

- [CONTEXT.md](CONTEXT.md)
- [DATABASE.md](DATABASE.md)
- [TESTING.md](TESTING.md)
- [TECH_STACK.md](TECH_STACK.md)
- [ENV.md](ENV.md)
