# Frontend layout: by-kind folders with domain subfolders

The React frontend grew as one flat `src/` folder where screen files pack many components together, import components out of each other, and call third-party SDKs directly. We restructure it into a hybrid layout: top-level folders by kind, with domain subfolders inside each.

```
src/
  App.tsx, main.tsx   the shell (tabs, nav stacks, shortcuts, global listeners) and the entry point
  pages/              one per screen: Home, Log, Invoices, Invoice, Clients, Client, Project, Settings
  components/<domain>/
  hooks/<domain>/
  lib/<domain>/       pure logic and the domain types
  integrations/       the only home of third-party SDKs: tauri/ (commands, events, files) and pdf/
  styles/             the global stylesheet and fonts
  tests/              screen tests and the Invoice PDF test; helpers in tests/support/
```

Domain subfolders use the canonical glossary terms and the Rust `core` module names — clients, projects, time-entries, timer, invoices, dashboard, progress, settings — never the RPG labels. `ui` holds shared primitives (Modal, Field, the confirm dialog).

**Import direction** is one-way:

- `lib` is pure and imports nothing from the app.
- `integrations` import only `lib`.
- `hooks` import `integrations` and `lib`.
- `components` import `hooks`, `lib`, other components (any domain) and the Tauri command wrappers, which they may call directly for one-off mutations.
- `pages` import anything. Only `App` imports pages.

**One exported component per file.** A private helper component stays in its file until a second file needs it, then moves to its own file.

**Naming:** PascalCase for components and pages, `useThing` for hooks, camelCase for other modules, kebab-case for domain folders and test files. Imports from nested folders use the `@/` → `src` alias. No barrel (index re-export) files.

`lib` unit tests sit next to their helper. Every other frontend test lives in `tests/`, named after the screen or domain it covers (home, log, clients, invoice-pdf), never an RPG label.

## Considered Options

- **Pure by-kind folders** — a flat `components/` folder of 40+ files with no grouping. Rejected.
- **Pure by-feature folders** — each feature owns its components, hooks and logic, but screens share too much (Clients feed every picker, Periods feed Home and Settings) for features to stay separate. Rejected.
- **A mirrored test tree** — `tests/` copying the `src/` layout. Screen tests exercise the whole App, not one file, so there is nothing to mirror. Rejected.
- **A hook around every mutation** — a hook per one-line command call is ceremony; components call command wrappers directly instead. Rejected.
- **TanStack Query** — a data-fetching library for a local, single-user app whose loads are one IPC call each; a small `useLoad` hook covers it. Rejected.
- **ESLint** to enforce the import rules — new tooling for one rule that matters; a single structural test keeps third-party SDK imports inside `integrations`. Rejected.

## Consequences

- "Where does this go?" has one answer: its kind picks the top-level folder, its domain picks the subfolder.
- The other import-direction rules are enforced by review, not tooling.
- The Rust side already follows a domain-module pattern and is out of scope.
