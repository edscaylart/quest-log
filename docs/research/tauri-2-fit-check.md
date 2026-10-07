# Tauri 2 fit check

Ticket: [#9](https://github.com/edscaylart/quest-log/issues/9). Question: does Tauri 2 + React + SQLite cover what Quest Log needs on macOS, or is there a blocker that should reopen ADR 0001 (`docs/adr/0001-tauri-for-macos-only-app.md`)?

Researched 2026-10-07 against the current stable releases: Tauri 2.12.1 (2026-09-30), `tauri-plugin-sql` 2.5.0, `tauri-plugin-dialog` 2.8.1, `tauri-plugin-fs` 2.6.0, wry 0.57.0, tao 0.37.1, tray-icon 0.25.1. Source links are pinned to those versions. Plugin source is pinned to `plugins-workspace` commit [`974bbdc`](https://github.com/tauri-apps/plugins-workspace/tree/974bbdc3ffc79f89a2641e3cd23361d1a85da8e4) (the `v2` branch head).

## Answer

**No blocker.** Each requirement maps to a stable Tauri 2 API or a maintained library. Three things need a little native Rust that Tauri does not wrap: sleep/wake notifications, an optional App Nap opt-out, and (optionally) programmatic WKWebView PDF. None of them reopens ADR 0001.

- **Tray timer:** create the tray in Rust (`TrayIconBuilder`, `tray-icon` feature). Run a 1 Hz Rust task that calls `TrayIcon::set_title` (supported on macOS) and `MenuItem::set_text`. To stay alive with no window, call `prevent_exit()` on `RunEvent::ExitRequested` or hide the window on close. Optionally use `ActivationPolicy::Accessory` for a menu-bar-only app.
- **SQLite:** use Rust-side `sqlx` (SQLite feature) to own one DB file at `app_data_dir()`, which is `~/Library/Application Support/<bundle identifier>/` on macOS. Use `sqlx::migrate!()` for embedded migrations and expose typed Tauri commands. Back up with `VACUUM INTO`. `tauri-plugin-sql` works, but it gives the webview raw SQL, and the Rust tray can't easily reach it when no window exists. `rusqlite` is an equally workable alternative.
- **PDF invoices:** render with `@react-pdf/renderer` (`pdf(doc).toBlob()`), then call `dialog.save()` and write the bytes with `fs.writeFile()` (or a Rust command). Keep `window.print()` (native print panel with "Save as PDF") as a fallback that needs no extra code beyond the `core:webview:allow-print` permission. Don't use `pdf-lib` as the main tool: it has had no release since 2021 and only draws at coordinates.
- **Timer accuracy:** store `started_at` as a wall-clock UTC timestamp in SQLite and always derive elapsed = now − started_at. The 1 Hz tick only repaints. This survives restarts, App Nap timer throttling and webview throttling. Tauri exposes no sleep/wake events. If time asleep should count as a break, subscribe to the `NSWorkspace` will-sleep/did-wake notifications from Rust via `objc2-app-kit`.
- **Bundle size:** Tauri's own CI measures a release hello-world binary at about 2.9 MB on Apple Silicon. Quest Log should land at a single-digit-MB `.app`, about double the executable size for a universal build. That is an estimate, not a measurement. Electron is about 100 MB+ (per the ADR).

## 1. Menu-bar (tray) icon with a live timer

### What the API offers

- The tray needs the `tray-icon` Cargo feature on `tauri`. Create it with `TrayIconBuilder::new().build(app)` in Rust or `TrayIcon.new(options)` in JS ([system tray guide](https://v2.tauri.app/learn/system-tray/)).
- `TrayIcon::set_title` "Sets the title for this tray icon". Its platform notes cover only Linux (title needs an icon) and Windows (unsupported), so it works on macOS ([docs.rs](https://docs.rs/tauri/2.12.1/tauri/tray/struct.TrayIcon.html#method.set_title), [source](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/crates/tauri/src/tray/mod.rs#L528-L541)). The JS `TrayIcon.setTitle()` has the same notes ([tray.ts](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/packages/api/src/tray.ts#L350-L362)).
- Other runtime setters: `set_icon`, `set_icon_as_template` (macOS only), `set_tooltip`, `set_menu`, `set_visible`, `set_show_menu_on_left_click` ([docs.rs](https://docs.rs/tauri/2.12.1/tauri/tray/struct.TrayIcon.html)). Menu items can be relabelled at runtime with `set_text` / `setText` ([window menu guide](https://v2.tauri.app/learn/window-menu/)).
- **How the title is drawn on macOS:** tray-icon calls `setTitle` on the `NSStatusItem` button with a plain `NSString`. There is no font or attributed-string option ([tray-icon source](https://github.com/tauri-apps/tray-icon/blob/tray-icon-v0.25.1/src/platform_impl/macos/mod.rs#L153-L174)). The item is created with `NSVariableStatusItemLength` ([source](https://github.com/tauri-apps/tray-icon/blob/tray-icon-v0.25.1/src/platform_impl/macos/mod.rs#L55)), which Apple defines as "a status item length that dynamically adjusts to the width of its contents" ([Apple](https://developer.apple.com/documentation/appkit/nsstatusitem/variablelength)). So Tauri gives no way to choose monospaced digits, and the item may change width as the seconds tick. This is cosmetic: pick a stable format or update once a minute (see Open questions).

### Update frequency and threading

- Every `TrayIcon` setter goes through the `run_item_main_thread!` macro. The macro posts the closure with `AppHandle::run_on_main_thread` and blocks the caller until it has run ([menu/mod.rs](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/crates/tauri/src/menu/mod.rs#L26-L40)). On the main thread it runs inline; from any other thread it goes to the event-loop proxy ([tauri-runtime-wry](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/crates/tauri-runtime-wry/src/lib.rs#L263-L280)).
- Tauri documents no rate limit for tray updates, and the code path is just one main-thread dispatch per call. Nothing suggests 1 Hz is a problem, but I found no benchmark, so this is not confirmed.
- **Updates while the tray menu is open:** tao adds its proxy wake-up source and its run-loop observers in `kCFRunLoopCommonModes` ([event_loop.rs](https://github.com/tauri-apps/tao/blob/tao-v0.37.1/src/platform_impl/macos/event_loop.rs#L336), [observer.rs](https://github.com/tauri-apps/tao/blob/tao-v0.37.1/src/platform_impl/macos/observer.rs#L219)). That suggests queued title and menu updates are still processed while the menu is open, but I have not checked it at runtime (see Open questions).

### Running with no main window open

- When the last window closes, the runtime emits `RunEvent::ExitRequested { code: None, .. }` and exits unless the handler calls `api.prevent_exit()` ([tauri-runtime-wry](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/crates/tauri-runtime-wry/src/lib.rs#L4259-L4270), [`RunEvent`](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/crates/tauri/src/app.rs#L220-L232)).
- Alternatively, catch `WindowEvent::CloseRequested { api }`, call `api.prevent_close()`, then `window.hide()`. This keeps the webview alive ([`WindowEvent`](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/crates/tauri/src/app.rs#L111-L123)).
- macOS-only `set_activation_policy(ActivationPolicy::Accessory)` maps to `NSApplicationActivationPolicyAccessory`. Together with `set_dock_visibility(false)`, it lets the app run as a menu-bar app with no Dock icon ([app.rs](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/crates/tauri/src/app.rs#L644-L683), [ActivationPolicy](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/crates/tauri-runtime/src/lib.rs#L279-L286)). `RunEvent::Reopen` fires on `applicationShouldHandleReopen`, for example a Dock click ([app.rs](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/crates/tauri/src/app.rs#L275-L282)).

### Recommendation

Build the tray, its menu and the 1 Hz ticker in Rust, not in JS. JS timers in a hidden window are throttled or suspended by default (see §4), and a closed window has no JS at all. The tray guide's JS example uses `menuOnLeftClick`, which has been deprecated in favour of `showMenuOnLeftClick` since 2.2.0 ([tray.ts](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/packages/api/src/tray.ts#L136-L159)).

## 2. SQLite: `tauri-plugin-sql` vs Rust-side `sqlx` / `rusqlite`

| | `tauri-plugin-sql` 2.5.0 | `sqlx` (Rust-side) | `rusqlite` 0.40.2 (Rust-side) |
|---|---|---|---|
| Who runs SQL | Webview, via JS bindings | Rust commands | Rust commands |
| Migrations | Built in (sqlx `Migrator`); Up only | `sqlx::migrate!()`, embedded | None built in (e.g. `PRAGMA user_version`) |
| Reachable from Rust tray with no window | Only via `DbInstances` state after a load | Yes | Yes |
| Backup | `VACUUM INTO` via `execute` | `VACUUM INTO` | `VACUUM INTO` or the online backup API |

### `tauri-plugin-sql`

- "Plugin providing an interface for the frontend to communicate with SQL databases through sqlx." All of its APIs go through the JavaScript guest bindings ([docs](https://v2.tauri.app/plugin/sql/)). It depends on sqlx 0.8 ([Cargo.toml](https://github.com/tauri-apps/plugins-workspace/blob/974bbdc3ffc79f89a2641e3cd23361d1a85da8e4/plugins/sql/Cargo.toml#L39)).
- **File location:** "The path is relative to `tauri::api::path::BaseDirectory::AppConfig`" ([docs](https://v2.tauri.app/plugin/sql/)). The code creates `app_config_dir()` and joins the connection-string path onto it ([wrapper.rs](https://github.com/tauri-apps/plugins-workspace/blob/974bbdc3ffc79f89a2641e3cd23361d1a85da8e4/plugins/sql/src/wrapper.rs#L88-L101), [path_mapper](https://github.com/tauri-apps/plugins-workspace/blob/974bbdc3ffc79f89a2641e3cd23361d1a85da8e4/plugins/sql/src/wrapper.rs#L326-L345)).
- **Migrations:** a `Migration { version, description, sql, kind }` is registered with `Builder::add_migrations`. Migrations run at startup for databases listed in `plugins.sql.preload`, otherwise on `Database.load()`. "All migrations are executed within a transaction" ([docs](https://v2.tauri.app/plugin/sql/)). Only `MigrationKind::Up` runs. `Down` migrations "are currently never executed by the plugin" ([lib.rs](https://github.com/tauri-apps/plugins-workspace/blob/974bbdc3ffc79f89a2641e3cd23361d1a85da8e4/plugins/sql/src/lib.rs#L75-L114)).
- **Permissions:** the frontend needs `sql:allow-execute` and related permissions, so the webview can run any SQL ([docs](https://v2.tauri.app/plugin/sql/)).
- **Rust access:** pools live in the public `DbInstances` state, keyed by connection string, and are only filled once a database is loaded ([lib.rs](https://github.com/tauri-apps/plugins-workspace/blob/974bbdc3ffc79f89a2641e3cd23361d1a85da8e4/plugins/sql/src/lib.rs#L49)).

### `sqlx` directly

- `migrate!()` "embeds migrations into the binary by expanding to a static instance of Migrator". It reads `./migrations` by default and runs with `.run(&pool)` ([docs.rs](https://docs.rs/sqlx/0.8.6/sqlx/macro.migrate.html)).
- Applied migrations are recorded in a `_sqlx_migrations` table with a checksum ([source](https://github.com/launchbadge/sqlx/blob/v0.8.6/sqlx-sqlite/src/migrate.rs#L72-L79)). Editing a migration that has already shipped fails with "migration {0} was previously applied but has been modified" ([error.rs](https://github.com/launchbadge/sqlx/blob/v0.8.6/sqlx-core/src/migrate/error.rs#L18)). This also applies to the plugin, which uses the same `Migrator`.
- `SqliteConnectOptions` defaults ([docs.rs](https://docs.rs/sqlx/0.8.6/sqlx/sqlite/struct.SqliteConnectOptions.html)):
  - foreign keys are on;
  - "SQLx does not set a journal mode by default", so a new file uses `DELETE`, not WAL;
  - "a new file **will not be created**" unless you set `create_if_missing(true)`;
  - the busy timeout is 5 s.
- Tauri prefers async commands. "Commands without the async keyword are executed on the main thread" ([calling Rust](https://v2.tauri.app/develop/calling-rust/#async-commands)). sqlx is async-native, so it fits that model.

### `rusqlite`

- Synchronous, at version 0.40.2. Its `backup` feature adds SQLite's online backup API, and the module docs also point to `VACUUM INTO` ([docs.rs](https://docs.rs/rusqlite/latest/rusqlite/backup/index.html)). Migrations are up to you.

### Where the DB file lives on macOS

- On macOS, `config_dir()` and `data_dir()` both resolve to `$HOME/Library/Application Support`. `app_config_dir()` and `app_data_dir()` add `/${bundle_identifier}` to that ([path/desktop.rs](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/crates/tauri/src/path/desktop.rs#L57-L75), [app dirs](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/crates/tauri/src/path/desktop.rs#L235-L257)). The plugin's AppConfig base and a Rust-side `app_data_dir()` therefore land in the same folder on macOS. Pick the bundle identifier carefully, because changing it moves the data.

### Backup-friendliness

- SQLite lists three safe ways to copy a live database: `sqlite3_rsync`, `VACUUM INTO` and the backup API. A plain file copy is safe only "as long as there are no transactions in progress", and any `-journal` or `-wal` file must be copied with it ([How to corrupt](https://www.sqlite.org/howtocorrupt.html)).
- `VACUUM INTO` "is an alternative to the backup API for generating backup copies of a live database". It produces a minimal, transactionally consistent snapshot ([VACUUM INTO](https://www.sqlite.org/lang_vacuum.html#vacuuminto)).
- One DB file in the default rollback-journal mode, with no transaction open while the app is quit, is safe to copy by hand (Finder or Time Machine). An in-app "Export backup" should run `VACUUM INTO '<path from save dialog>'`.

### Recommendation

Use Rust-side `sqlx`. The Rust tray must read and write the running timer even when no webview exists, migrations come built in, and it is the engine the official plugin already uses. `rusqlite` is a fine substitute if we prefer sync code plus the backup API. The plugin is not a blocker, just a worse fit.

## 3. PDF invoice output

### A. WKWebView print (`window.print()` / `Webview::print()`)

- `Webview::print()` "Opens the dialog to prints the contents of the webview. Currently only supported on macOS on `wry`. `window.print()` works on all platforms." ([webview/mod.rs](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/crates/tauri/src/webview/mod.rs#L1623-L1628))
- On macOS, Tauri injects a script that replaces `window.print` with `invoke('plugin:webview|print')` ([plugin.rs](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/crates/tauri/src/webview/plugin.rs#L198-L202), [print.js](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/crates/tauri/src/webview/scripts/print.js)). That command is gated by `core:webview:allow-print`, which is **not** in `core:webview:default` ([permission reference](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/crates/tauri/permissions/webview/autogenerated/reference.md)). Without it, `window.print()` silently fails the permission check.
- wry builds a print operation with `printOperationWithPrintInfo:` (macOS 11+) and runs the print panel modally on the webview's window ([wry](https://github.com/tauri-apps/wry/blob/wry-v0.57.0/src/wkwebview/mod.rs#L879-L918), [Apple](https://developer.apple.com/documentation/webkit/wkwebview/printoperation(with:))).
- What you get: the native print panel, from which the user saves through its PDF menu. It works today with the app's own React/CSS, including the pixel font. It is not programmatic (no path is returned), and it prints the whole webview, so it needs a dedicated invoice route or window plus print CSS.

### B. WKWebView `createPDF` (programmatic)

- `createPDF(configuration:completionHandler:)` "Generates PDF data from the web view's contents asynchronously" on macOS 11.0+ ([Apple](https://developer.apple.com/documentation/webkit/wkwebview/createpdf(configuration:completionhandler:))). `WKPDFConfiguration` only exposes `rect` and `allowTransparentBackground`: there are no paper-size or pagination options ([Apple](https://developer.apple.com/documentation/webkit/wkpdfconfiguration)).
- Neither Tauri nor wry wraps it on macOS. wry only declares the selector in its iOS bindings. You can still reach it: `Webview::with_webview` hands you a `PlatformWebview` whose `inner()` is the `WKWebView` pointer ([webview/mod.rs](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/crates/tauri/src/webview/mod.rs#L199-L206), [with_webview](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/crates/tauri/src/webview/mod.rs#L1857-L1866)), and Tauri already depends on `objc2-web-kit` on macOS ([Cargo.toml](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/crates/tauri/Cargo.toml#L106-L130)). That means custom unsafe code with unknown pagination, so it is not recommended for v1.

### C. `@react-pdf/renderer` (recommended)

- Version 4.9.0, published 2026-08-27, MIT licensed ([npm](https://registry.npmjs.org/@react-pdf/renderer/latest)). It supports React 19 since v4.1.0 ([compatibility](https://react-pdf.org/compatibility)).
- In the browser, `pdf(MyDoc).toBlob()`, `usePDF` and `<BlobProvider>` all give you the document bytes ([on-the-fly rendering](https://react-pdf.org/advanced#on-the-fly-rendering)). Documents of 30+ pages should render in a web worker ([advanced](https://react-pdf.org/advanced)); invoices are far smaller.
- It has its own layout engine, styled with "CSS and Flexbox" via `StyleSheet` ([styling](https://react-pdf.org/styling)). The invoice is written with react-pdf primitives, not reused DOM.
- "only TTF and WOFF fonts files are supported", and variable fonts are not ([fonts](https://react-pdf.org/fonts)). The pixel font must ship as TTF or WOFF.

### D. `pdf-lib`

- "Create and modify PDF documents in any JavaScript environment", tested in Node, browser, Deno and React Native. It works at the drawing level (`drawText` at x/y), and `save()` returns a `Uint8Array` ([README](https://github.com/Hopding/pdf-lib#readme)). The latest version, 1.17.1, was published 2021-11-06 ([npm](https://registry.npmjs.org/pdf-lib)). Fine for stamping or merging PDFs, a poor fit as the invoice layout engine.

### Saving the file

- `save()` from `@tauri-apps/plugin-dialog` returns the chosen path. "The selected path is added to the filesystem and asset protocol scopes", but "the scope change is not persisted" across restarts ([guest-js](https://github.com/tauri-apps/plugins-workspace/blob/974bbdc3ffc79f89a2641e3cd23361d1a85da8e4/plugins/dialog/guest-js/index.ts#L387-L412), [commands.rs](https://github.com/tauri-apps/plugins-workspace/blob/974bbdc3ffc79f89a2641e3cd23361d1a85da8e4/plugins/dialog/src/commands.rs#L246-L256)).
- `writeFile(path, data)` from `@tauri-apps/plugin-fs` writes the bytes ([guest-js](https://github.com/tauri-apps/plugins-workspace/blob/974bbdc3ffc79f89a2641e3cd23361d1a85da8e4/plugins/fs/guest-js/index.ts#L1166-L1181)). It needs `fs:allow-write-file`, because `fs:default` only grants read access to the app's own directories ([fs permissions](https://github.com/tauri-apps/plugins-workspace/blob/974bbdc3ffc79f89a2641e3cd23361d1a85da8e4/plugins/fs/permissions/autogenerated/reference.md)).
- Alternative with no fs plugin: send the bytes to a Rust command that calls `app.dialog().file().blocking_save_file()` and writes with `std::fs` ([dialog docs](https://v2.tauri.app/plugin/dialog/)).

### Recommendation

Use C plus the save flow above. Keep A as a fallback that needs no extra code.

## 4. Timer accuracy across sleep/wake and app restart

### Clocks

- Rust's `Instant` on Darwin uses `clock_gettime` with `CLOCK_UPTIME_RAW` ([Rust docs](https://doc.rust-lang.org/std/time/struct.Instant.html)). The macOS `clock_gettime(3)` man page (checked on macOS 26.5) says that clock "does not increment while the system is asleep". Rust also warns that whether suspends count as elapsed time "varies across platforms and Rust versions". **Don't measure tracked time with `Instant`.**
- `SystemTime` uses `CLOCK_REALTIME`, the wall-clock time, and "is not monotonic" ([Rust docs](https://doc.rust-lang.org/std/time/struct.SystemTime.html); same man page).
- **Timestamp model:** persist `started_at` (UTC, from `SystemTime` or `Date.now()`) in SQLite when the timer starts. Compute elapsed = now − started_at whenever you need it. App quits, crashes and restarts lose nothing, because the state lives in the DB, not in memory. Sleep counts as elapsed time. Manual or NTP clock changes shift the result; that is an edge case.

### What Tauri gives you: no power events

- `RunEvent` has `Exit`, `ExitRequested`, `WindowEvent`, `WebviewEvent`, `Ready`, `Resumed`, `MainEventsCleared`, `Opened`, `MenuEvent`, `TrayIconEvent` and `Reopen`. None of them are sleep/wake events ([app.rs](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/crates/tauri/src/app.rs#L214-L298)). The window-level `Suspended` and `Resumed` events are mobile-only ([app.rs](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/crates/tauri/src/app.rs#L152-L170)).
- I searched Tauri 2.12.1, wry 0.57.0, tao 0.37.1 and every plugin on the `plugins-workspace` `v2` branch for `willSleep`, `didWake`, `IORegisterForSystemPower`, `NSWorkspace` and `beginActivity`. None appear.

### What macOS gives you

- `NSWorkspace.willSleepNotification` is posted "before the device goes to sleep", and an observer "can delay sleep for up to 30 seconds" ([Apple](https://developer.apple.com/documentation/appkit/nsworkspace/willsleepnotification)). `didWakeNotification` is posted "when the device wakes from sleep" ([Apple](https://developer.apple.com/documentation/appkit/nsworkspace/didwakenotification)). Both arrive on `NSWorkspace.shared.notificationCenter`, not the default center ([Apple](https://developer.apple.com/documentation/appkit/nsworkspace/notificationcenter)).
- Rust bindings exist in `objc2-app-kit`, for example `NSWorkspaceDidWakeNotification` behind the `NSWorkspace` feature ([docs.rs](https://docs.rs/objc2-app-kit/latest/objc2_app_kit/static.NSWorkspaceDidWakeNotification.html)). Tauri already depends on `objc2-app-kit` 0.3 on macOS ([Cargo.toml](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/crates/tauri/Cargo.toml#L106-L130)).

### App Nap

- An app is a candidate for App Nap if it isn't in the foreground, hasn't recently updated visible window content, isn't audible, holds no IOKit or `NSProcessInfo` assertions, and isn't using OpenGL. App Nap applies "Timer throttling" ([Apple, App Nap](https://developer.apple.com/library/archive/documentation/Performance/Conceptual/power_efficiency_guidelines_osx/AppNap.html)).
- To opt out, call `ProcessInfo.beginActivity(options:reason:)`. Apple warns to end activities that disable sleep, including `userInitiated` ([Apple](https://developer.apple.com/documentation/foundation/processinfo)). The `idleSystemSleepDisabled` option is negated by `userInitiatedAllowingIdleSystemSleep` ([Apple](https://developer.apple.com/documentation/foundation/processinfo/activityoptions/idlesystemsleepdisabled)), so a running timer should use the latter. Tauri doesn't wrap this API.
- With the timestamp model, throttling can only delay a repaint; the tracked total stays correct. Apple doesn't say whether a status-item title that updates every second counts as "visible content".

### Webview throttling

- Tauri's `backgroundThrottling` window option explains that "browsers use a suspend policy that will throttle timers and even unload the whole tab (view) to free resources after roughly 5 minutes when a view became minimized or hidden". The option accepts `disabled`, `suspend` or `throttle`, and on macOS it only works on 14.0+ ([config.rs](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/crates/tauri-utils/src/config.rs#L2235-L2250), [policies](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/crates/tauri-utils/src/config.rs#L1854-L1861)). Tauri bundles target macOS 10.13+ by default ([app bundle docs](https://v2.tauri.app/distribute/macos-application-bundle/#minimum-system-version)).
- So the UI should not tick a counter in JS. It should recompute from `started_at` on each frame and on `visibilitychange`.

### Recommendation

Use timestamps in SQLite as the source of truth. Run the display ticker in Rust. Whether sleep should break a running timer is a product decision; if it should, add a small Rust module that observes `NSWorkspace` sleep/wake (for example, on wake: "You were away 47 min. Keep or discard?"). Add `beginActivity(.userInitiatedAllowingIdleSystemSleep)` only if testing shows App Nap visibly stalls the tray title.

## 5. App bundle size

- Tauri's docs say "a minimal Tauri app can be less than 600KB in size" ([What is Tauri](https://v2.tauri.app/start/)). The size guide recommends `codegen-units = 1`, `lto = true`, `opt-level = "s"`, `panic = "abort"`, `strip = true` and the `removeUnusedCommands` build option ([App Size](https://v2.tauri.app/concept/size/)).
- Tauri's benchmark CI builds on `aarch64-apple-darwin` / `macos-latest` ([bench.yml](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/.github/workflows/bench.yml#L42)). It recorded a `tauri_hello_world` binary of **2,884,464 bytes (about 2.9 MB)** on 2026-10-07, at commit `a916205` (crate version 2.12.1) ([benchmark_results, `tauri-recent-macos.json`](https://github.com/tauri-apps/benchmark_results/blob/gh-pages/tauri-recent-macos.json)). That build used the size-optimised profile ([Cargo.toml](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/Cargo.toml#L61-L67)). The current macOS hello-world floor is therefore about 2.9 MB; the 600 KB figure in the docs does not match today's macOS measurement.
- Frontend assets are embedded into the binary (`EmbeddedAssets`, with an optional `compression` feature) ([lib.rs](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/crates/tauri/src/lib.rs#L338-L349), [Cargo.toml](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/crates/tauri/Cargo.toml#L206)).
- `tauri build --target universal-apple-darwin` builds both architectures and merges them with `lipo` ([CLI source](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/crates/tauri-cli/src/interface/rust/desktop.rs#L168-L196)), so the executable should roughly double. That is an inference, not a measurement.
- **Estimate (unmeasured):** about 3 MB of Tauri, plus the sql/dialog/fs plugins, the React bundle, `@react-pdf/renderer`, fonts and icons, should give an arm64 `.app` in the low single-digit MB up to about 10 MB. That is nowhere near Electron's size class.

### Related: distribution without a paid Apple account

Not a Tauri blocker, but it matters for shipping. Tauri supports ad-hoc signing with `"signingIdentity": "-"`, which is "useful on ARM (Apple Silicon) devices, where code-signing is required for all apps from the Internet". It "does not prevent MacOS from requiring users to whitelist the installation in their Privacy & Security settings" ([macOS signing](https://v2.tauri.app/distribute/sign/macos/#ad-hoc-signing)).

## Open questions

1. **Tray updates while the menu is open.** Does a 1 Hz `set_title` / `MenuItem::set_text` keep repainting while the tray menu is open? tao's common-mode run-loop registration suggests yes; confirm in a spike.
2. **Title width jitter.** Variable-length status item, plain `NSString` title, no monospaced-digit option. Is the shift acceptable, or do we need a fixed format (`1:07`), minute-resolution updates, or native `NSAttributedString` code?
3. **Sleep policy (product).** Should time asleep count toward a running timer? This decides whether we build the `NSWorkspace` sleep/wake module and a "you were away" prompt. Idle detection (user present but not working) was not researched.
4. **App Nap on a menu-bar app.** Does App Nap throttle an accessory app whose status item updates every second? Apple's docs don't say; measure before adding `beginActivity`.
5. **`createPDF` pagination.** Apple doesn't document multi-page behaviour, and `WKPDFConfiguration` has no page options. This only matters if we ever want programmatic HTML-to-PDF.
6. **Real bundle size.** Measure the `.app` and `.dmg` once the scaffold exists, especially the weight of `@react-pdf/renderer`.
7. **Tauri v3.** `tauri-v3.0.0-alpha.0` shipped 2026-09-13 (alpha.4 on 2026-10-01), and `plugins-workspace` has a `v3` branch ([releases](https://github.com/tauri-apps/tauri/releases)). Build on v2 stable for now; decide later when to migrate.
8. **Wall-clock changes.** How should we handle manual, NTP or timezone changes while a timer runs (store UTC; clamp negative or implausible durations)?
