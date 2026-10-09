# Dev environment

Quest Log builds on macOS only, for macOS 11 or later; releases ship for Apple silicon. The stack is described in [TECH_STACK.md](TECH_STACK.md).

## Toolchain

| Tool | Version | Install |
|---|---|---|
| Xcode Command Line Tools | any recent | `xcode-select --install` |
| Rust | stable | [rustup](https://rustup.rs): `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh`. Open a new terminal afterwards so `cargo` is on your `PATH`. CI also uses `clippy`, which rustup's default profile includes. |
| Node.js | 24 | [nodejs.org](https://nodejs.org), or a version manager such as `nvm install 24` |
| pnpm | 10 | `npm install -g pnpm@10` |

These match CI (`.github/workflows/ci.yml`). Then, from the repo root:

```sh
pnpm install
```

Cargo fetches the Rust crates on the first build.

## Commands

Frontend commands run from the repo root; Rust commands from `src-tauri/`.

| Task | Command |
|---|---|
| Run the app in dev, with live reload | `pnpm tauri dev` |
| Typecheck the frontend | `pnpm typecheck` |
| Frontend tests | `pnpm test` |
| Build the frontend into `dist/` (typechecks first) | `pnpm build` |
| Typecheck the Rust core | `cargo check` |
| Rust tests | `cargo test` |
| Rust lint, as CI runs it | `cargo clippy --all-targets -- -D warnings` |
| Build the app and DMG | `pnpm tauri build` |

- `pnpm tauri dev` starts Vite on port 1420 (`pnpm dev`) and opens the app on it. Vite alone in a browser has no Rust core, so most screens fail.
- `cargo check`, `cargo test` and `cargo clippy` need `dist/` to exist, because Tauri's build step embeds it. On a fresh clone, run `pnpm build` once first.
- `pnpm tauri build` puts the app in `src-tauri/target/release/bundle/macos/` and the DMG in `src-tauri/target/release/bundle/dmg/`.
- The update check only runs in release builds, never in `pnpm tauri dev`.

## Where data lives

The database path comes from Tauri's app data directory for the bundle identifier `io.github.edscaylart.questlog` (`src-tauri/src/lib.rs`):

| What | Path |
|---|---|
| App data | `~/Library/Application Support/io.github.edscaylart.questlog/` |
| SQLite database | `~/Library/Application Support/io.github.edscaylart.questlog/quest-log.db` |
| Backups | `~/Library/Application Support/io.github.edscaylart.questlog/backups/` |

The backups folder (`src-tauri/src/core/backups.rs`) holds:

- `daily-<YYYY-MM-DD>.db`: the first launch of each day; the last 7 are kept.
- `pre-migration-<UTC time>.db`: before a launch applies a new migration to an existing database; the last 3 are kept.
- `pre-restore-<UTC time>.db`: before **Restore from backup…** replaces the data; the last 3 are kept.

**Back up now** writes wherever the user picks, not into this folder. **Settings › Data** shows the database path and has **Reveal in Finder**.

`pnpm tauri dev` uses the same identifier, so a dev build reads and writes the same database as an installed Quest Log. Back it up before running a branch that adds a migration.

## Configuration

There are no environment variables. The app reads none, and building, running and testing need none. Configuration (the invoice header's seller details, default Net days, invoice prefix and next number) lives in the app's **Settings** screen and is stored in the database.

## Pointers

- [ARCHITECTURE.md](ARCHITECTURE.md)
- [TECH_STACK.md](TECH_STACK.md)
- [TESTING.md](TESTING.md)
- [DATABASE.md](DATABASE.md)
