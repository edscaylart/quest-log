# Tech stack

Quest Log is a [Tauri 2](https://tauri.app) app ([ADR 0001](adr/0001-tauri-for-macos-only-app.md)): a React + TypeScript frontend in `src/`, and a Rust core in `src-tauri/` that owns the SQLite database. The frontend talks to the core only through Tauri commands. Every dependency in `package.json` and `src-tauri/Cargo.toml` is listed below.

## Frontend runtime

`dependencies` in `package.json`.

| Package | What it does in Quest Log |
|---|---|
| `react`, `react-dom` | The UI. |
| `@tauri-apps/api` | `invoke` calls the Rust core's commands (`src/integrations/tauri/commands.ts`); events from the core, such as the tray Timer, arrive through it too. Its `mocks` module fakes the core in tests. |
| `@react-pdf/renderer` | Renders an invoice to PDF in the frontend (`src/integrations/pdf/`). |
| `@tauri-apps/plugin-dialog` | JS side of the dialog plugin: the open and save panels. See [Tauri plugins](#tauri-plugins). |
| `@tauri-apps/plugin-fs` | JS side of the fs plugin: writes an exported PDF or CSV to the path the user picked. See [Tauri plugins](#tauri-plugins). |

## Frontend dev and test tooling

`devDependencies` in `package.json`.

| Package | What it does in Quest Log |
|---|---|
| `typescript` | Typechecking (`pnpm typecheck`; `pnpm build` runs it first). |
| `vite` | Dev server on port 1420, which Tauri loads in dev, and the production bundle in `dist/`. |
| `@vitejs/plugin-react` | JSX and React Fast Refresh for Vite. |
| `@tauri-apps/cli` | The `tauri` command: `pnpm tauri dev` and `pnpm tauri build`. |
| `vitest` | Frontend test runner (`pnpm test`), configured in `vite.config.ts`. |
| `jsdom` | Browser DOM for the component tests. |
| `@testing-library/react` | Renders screens in tests and queries them the way a user would. |
| `@testing-library/user-event` | Simulates clicks and typing in tests. |
| `@testing-library/jest-dom` | DOM matchers such as `toBeInTheDocument`. |
| `pdfjs-dist` | Reads the text back out of generated invoice PDFs, so tests can check what they say (`src/tests/support/pdf.ts`). |
| `@types/react`, `@types/react-dom` | React type definitions. |

## Rust crates

`src-tauri/Cargo.toml`, apart from the Tauri plugins.

| Crate | What it does in Quest Log |
|---|---|
| `tauri` | The app shell: window, commands, events. The `tray-icon` feature gives the menu-bar Timer. |
| `tauri-build` | Build dependency: generates Tauri's context and capability schemas at compile time. |
| `sqlx` | SQLite access on the Tokio runtime. `migrate` and `macros` embed and run the migrations in `src-tauri/migrations/` (`sqlx::migrate!()`). |
| `serde` | Serializes command arguments and results between the core and the frontend. |
| `serde_json` | Stores an invoice's snapshot as JSON in the database. |
| `chrono` | Dates and times: local calendar days, Unix instants, the clock. |
| `thiserror` | `CoreError`, the core's error type. |
| `tokio` (dev) | Async runtime for the Rust tests (`#[tokio::test]`). |
| `tempfile` (dev) | Throwaway directories that hold each Rust test's database and backups. |

## Tauri plugins

Each has a Rust crate registered in `src-tauri/src/lib.rs`; the dialog and fs plugins also have a JS package, listed under [Frontend runtime](#frontend-runtime). The frontend's permissions are in `src-tauri/capabilities/default.json`.

| Plugin | Crate / package | What it does in Quest Log |
|---|---|---|
| Dialog | `tauri-plugin-dialog`, `@tauri-apps/plugin-dialog` | Open and save panels for exports, backups and restore; the core's "Update available" and "Update failed" dialogs. |
| File system | `tauri-plugin-fs`, `@tauri-apps/plugin-fs` | Writes exported files. The frontend may only write files (`fs:allow-write-file`). |
| Updater | `tauri-plugin-updater` | Checks GitHub Releases on launch in release builds and installs a signed update. Pinned to 2.13.2 or later: earlier versions can delete the app on a macOS install. Rust only. |

## Pointers

- [ARCHITECTURE.md](ARCHITECTURE.md)
- [ENV.md](ENV.md)
- [TESTING.md](TESTING.md)
