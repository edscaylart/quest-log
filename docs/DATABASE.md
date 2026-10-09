# Database

Quest Log keeps everything in one SQLite file, opened and migrated by `core::open` (`src-tauri/src/core/mod.rs`). The migrations in `src-tauri/migrations/` are the source of truth for the schema; this page explains them. Domain terms are as defined in [CONTEXT.md](CONTEXT.md).

## Conventions

- **Money** is integer cents (`*_cents`). **Durations** are integer seconds.
- **Calendar days** are local `TEXT` dates, `YYYY-MM-DD`.
- **Instants** are integer Unix time: seconds everywhere except `timer.started_at`, which is milliseconds.
- **Booleans** are `INTEGER` 0/1.
- **Optional text** is stored `NULL` when blank, never `''`. The core trims input and turns blank into `NULL`.
- **Foreign keys** are enforced, because sqlx turns SQLite's `foreign_keys` pragma on. Deletes therefore remove children first.
- **Single-row tables** (`timer`, `level_up`, `settings`) pin `id = 1` with a `CHECK`.

## Tables

### `clients`

A Client: someone the freelancer bills.

| Column | Notes |
|---|---|
| `name` | Required, trimmed. |
| `rate_cents` | The client's Rate. `>= 0`. |
| `billing_name` | Name on invoices. `NULL` falls back to `name`. |
| `address`, `email` | Bill-to details, optional. `email` must contain `@`. |
| `net_days` | Payment terms override, 0–365 (cap enforced by the core; the schema only checks `>= 0`). `NULL` uses the Settings default. |
| `archived` | Client status: 0 Active, 1 Archived. |
| `created_at` | Unix seconds. |

### `projects`

A Project under one client.

| Column | Notes |
|---|---|
| `client_id` | Owning client. Never changes. |
| `name` | Required, trimmed. |
| `rate_cents` | Rate override, `>= 0`. `NULL` uses the client's Rate. |
| `complete` | Project status: 0 Active, 1 Complete. |
| `created_at` | Unix seconds. |

### `time_entries`

A Time entry.

| Column | Notes |
|---|---|
| `client_id` | Its client. |
| `project_id` | `NULL`, or a project of the same client. |
| `date` | The local day it started. Never in the future. |
| `seconds` | Duration, `CHECK (seconds BETWEEN 1 AND 86400)`. |
| `started_at`, `ended_at` | Unix seconds. Set only for time entries logged by start–end or by the Timer; `NULL` for duration-only ones. |
| `note` | Optional. |
| `invoice_id` | The one invoice it sits on (any state), or `NULL`. |
| `invoiced_rate_cents` | The Rate frozen at Send. |
| `created_at` | Unix seconds. Used to spot time entries logged into a Draft's period after it was created. |

Invariants:

- **At most one invoice.** A time entry sits on at most one invoice because the link is a single column. That invoice belongs to the time entry's client: attaching checks it, and moving the time entry to another client clears `invoice_id`.
- **Locked = frozen Rate.** `invoiced_rate_cents` is set exactly while the entry's invoice is Sent or Paid. Send sets it and Unseal clears it. A non-`NULL` value means the time entry is **locked**: it cannot be edited or deleted.
- **Effective Rate:** `COALESCE(invoiced_rate_cents, projects.rate_cents, clients.rate_cents)`.

### `timer`

The running Timer. Zero rows means none is running.

| Column | Notes |
|---|---|
| `id` | `CHECK (id = 1)`: at most one Timer. |
| `client_id`, `project_id` | What the time entry will be for. |
| `started_at` | Unix **milliseconds**, wall-clock UTC. Elapsed time is now − `started_at`. |
| `note` | Optional. |

Stopping the Timer inserts the time entry and deletes this row in one transaction.

### `invoices`

An Invoice.

| Column | Notes |
|---|---|
| `client_id` | Its client. |
| `period_start`, `period_end` | Local days, both included. |
| `state` | Enum, `CHECK (state IN ('draft', 'sent', 'paid'))`. Default `'draft'`. |
| `timesheet` | Print the timesheet page. Default 1. |
| `number` | Given at the first Send and kept on Unseal. `NULL` only for a Draft never sent. |
| `net_days` | This invoice's payment terms override, 0–365 (cap enforced by the core). `NULL` uses the client's, else Settings'. |
| `issue_date`, `due_date` | Local days. Set exactly while Sent or Paid. |
| `paid_date` | Local day. Set exactly while Paid. |
| `snapshot` | JSON frozen at Send. Set exactly while Sent or Paid. |
| `created_at` | Unix seconds. |

Invariants:

- **Fixed once sent.** Only a Draft's contents change (time entries, `net_days`, `timesheet`), and only a Draft can be deleted.
- **Snapshot is the record.** A Sent or Paid invoice is read from its `snapshot`, not from live rows. The snapshot holds `number`, `issueDate`, `dueDate`, `seller` (Settings name, business name, address, email, tax id, payment instructions), `client` (bill-to name, address, email), `lines`, `timesheet`, `seconds` and `totalCents`, all camelCase.

### `settings`

One row: the freelancer's invoice header and invoicing defaults. It is created by its migration.

| Column | Notes |
|---|---|
| `id` | `CHECK (id = 1)`. |
| `name` | `''` until first saved, required after. Send refuses while it is blank. |
| `business_name`, `address`, `email`, `tax_id`, `payment_instructions` | Optional seller details. `email` must contain `@`. |
| `net_days` | Default payment terms. `> 0`, default 30. |
| `invoice_prefix` | Default `'INV-'`. |
| `next_invoice_number` | `> 0`, default 1. Goes up by one at each invoice's first Send only. |

### `level_up`

One row: the highest Level a level-up was shown for.

| Column | Notes |
|---|---|
| `id` | `CHECK (id = 1)`. |
| `celebrated_level` | Never lowered. A level-up is pending while the Level from XP is above it. |

The migration seeds it with the Level existing time already reaches. Its recursive query mirrors `core::progress::level_for`; keep the two in step.

### `_sqlx_migrations`

Managed by sqlx: one row per applied migration, with its checksum. Never write to it by hand.

## Migrations

### Adding one

1. Add `src-tauri/migrations/NNNN_short_name.sql`, numbered one past the highest. `sqlx::migrate!()` embeds the folder at compile time.
2. On next launch, `core::open` applies every pending migration, in order.
3. Update this page in the same PR (see the rule below).

### Never edit an applied migration

sqlx stores each migration's checksum. A migration that changed after it was applied fails every database that already has it with a version mismatch. To change the schema, add a new migration.

### Automatic pre-migration backup

Before applying a pending migration to a database that already has migrations applied, `core::open` snapshots it to `backups/pre-migration-<UTC time>.db` beside the database file. The last 3 are kept. If the snapshot fails, nothing is migrated. A brand-new or up-to-date database takes no snapshot.

Two other kinds of backup sit in the same folder: daily backups (`daily-YYYY-MM-DD.db`, last 7 kept) and pre-restore backups (`pre-restore-<UTC time>.db`, last 3 kept).

### Restoring an older backup

Restore checks that the file is a Quest Log database with no migration newer than this app knows. It then snapshots the live database (pre-restore), puts the backup in its place and closes the connection. When the app reopens, `core::open` migrates the restored file like any older database, taking a pre-migration snapshot first.

A backup from a newer Quest Log is refused ("update first"), as is any file that isn't a Quest Log database.

## Rule: migrations update this doc

Any PR that adds a migration also updates DATABASE.md: new tables, columns, enums and invariants. If this page and the migrations ever disagree, the migrations win. Fix the page.

## Pointers

- [ARCHITECTURE.md](ARCHITECTURE.md)
- [CONTEXT.md](CONTEXT.md)
- [ENV.md](ENV.md)
