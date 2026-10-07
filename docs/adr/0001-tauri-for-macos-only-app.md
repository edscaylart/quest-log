# Tauri 2 + React + SQLite for a macOS-only app

Quest Log targets macOS only, yet we build it with Tauri 2 + React + SQLite rather than SwiftUI. The pixel-art RPG look is custom-drawn on any stack and is cheap in CSS, the author works in web tech, and Tauri keeps the bundle small (system WebKit) while still giving us a menu-bar tray and a self-signed updater. None of this needs a paid Apple Developer account, which the project rules out.

## Considered Options

- **SwiftUI + SwiftData** — most native and smallest, but the custom pixel UI costs more and it means learning Swift. Rejected.
- **Electron** — same web skills as Tauri but a ~100MB+ bundle, for nothing we need. Rejected.

## Consequences

- Reopen this only if the Tauri fit check finds a blocker (tray timer, SQLite, PDF output, timer accuracy across sleep).
- Distribution stays unsigned/un-notarized whichever stack we pick; that cost is not Tauri's.
