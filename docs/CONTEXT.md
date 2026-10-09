# Quest Log

A pixel-art RPG time tracker and invoicer for one freelancer. Each domain term below is canonical in conversation and code; its **RPG label** is the word the app's UI shows instead. Anything a client sees (an invoice document) uses the canonical term, never the RPG label.

## Language

### Work

**Client**:
A person or organization the freelancer bills. Every time entry belongs to exactly one client.
RPG label: "Patron". The list of clients is "Patrons".
_Avoid_: Quest, guild

**Project**:
An optional, finite piece of work under one client. A time entry may belong to a project of its client, or to none.
RPG label: "Quest".

**Client status**:
Whether a client is Active or Archived. Archiving is a reversible filing choice: an archived client leaves the active list, and all its time entries, invoices and history remain. A client can be deleted only while none of its time entries are on an invoice; deleting it also deletes its projects and uninvoiced time entries.
RPG label: Archived → "Retired".
_Avoid_: Inactive, closed

**Project status**:
Whether a project is Active or Complete. A complete project leaves the active list; its time entries and history remain. A project can be deleted only while none of its time entries are on an invoice; deleting it also deletes its time entries.
RPG label: Complete → "Quest complete".

**Time entry**:
One recorded stretch of work for a client: a date and a duration, optionally with start and end times and a note. Its date is the day it started, even if it runs past midnight. It sits on at most one invoice. Once that invoice is Sent, the entry is locked.
RPG label: none — the UI says "Time entry".
_Avoid_: Log entry, session, adventure

**Timer**:
The running clock that becomes a time entry when stopped. At most one runs at a time; starting another stops the first. It keeps running through sleep and app restarts. Discarding a timer records nothing.
RPG label: none — the UI says "Timer".
_Avoid_: Stopwatch, tracker

**Hours**:
Tracked time, as shown to the user.
RPG label: none — the UI says "Hours".

### Money

**Gold**:
RPG label for money, in any state — earned, owed or paid.
_Avoid_: Bounty

**Rate**:
The amount billed per hour of work. Every client has one; a project may override it. A time entry's rate is its project's rate if set, else its client's. Until a time entry is invoiced (on a Sent or Paid invoice) its rate is live — changing a client or project rate reprices its uninvoiced time, including time on a Draft; once Sent, the rate is frozen on the invoice. Every time entry is billable; work not to be charged goes on a project with a rate of zero.
RPG label: "Gold/hr".
_Avoid_: Bounty, wage, fee, billable flag

**Invoice**:
A request for payment to one client, covering a chosen set of its time entries over a period. A Draft is a working copy that follows live rates and details; Sending freezes it into a fixed record with a number, an issue date and a due date.
RPG label: "Scroll".

**Invoice line**:
One row of an invoice: all its time entries for one project, or for no project ("General"). Its amount is the exact hours times the rate, rounded to the cent once.
RPG label: none.

**Invoice number**:
A sequential identifier given to an invoice when it is first Sent. Drafts have none until then; a reverted invoice keeps its number.
RPG label: none.
_Avoid_: Quest complete (for a paid invoice)

**Invoice state**:
Where an invoice is in its life: Draft, Sent or Paid. A Sent invoice can return to Draft, and a Paid one to Sent, to correct mistakes. A Sent invoice past its due date is overdue — a condition, not a state.
RPG labels: Draft → "Unsealed", Sent → "Sealed", Paid → "Redeemed".

**Earnings**:
Gold from time entries, split by where it stands in billing: Uninvoiced (not on a Sent or Paid invoice — Drafts included), Invoiced-unpaid (on a Sent invoice), Paid (on a Paid invoice).
RPG labels: Uninvoiced → "Unclaimed", Invoiced-unpaid → "Owed", Paid → "Treasury".

### Reporting

**Period**:
A range of calendar days that hours and earnings are reported over. A time entry falls in a period when its date does, so the entry's work date — never its invoice or payment date — decides which period its Gold counts in. Weeks start on Monday.
RPG label: none.
_Avoid_: Billing cycle, window

### Progress

**XP**:
Experience the freelancer has gained, earned from Hours only — never from Gold, so unpaid work counts the same. It is always worked out from the current time entries, so editing or deleting an entry changes it.
RPG label: "XP".
_Avoid_: Points, score

**Level**:
The freelancer's single overall rank, set by total XP. There is one Level for the freelancer, not one per client or project. It can fall if time entries are removed. Only reaching a new highest Level is celebrated, with a level-up shown in the app; regaining a Level already reached is not.
RPG label: "Lv".
_Avoid_: Rank, tier

## Rules

Behavior the Rust core (`src-tauri/src/core/`) enforces, checked by its tests (`src-tauri/tests/`). Money is whole cents; time is whole seconds.

### XP and Level

- XP is total tracked seconds across all time entries, divided by 60 and rounded down: one XP per whole minute.
- A running Timer earns no XP until it is stopped into a time entry.
- Reaching Level L takes 300·L·(L−1) XP, i.e. 5·L·(L−1) Hours: Level 2 at 10 Hours, Level 3 at 30, Level 4 at 60. There is no cap.
- A level-up is pending while the Level is above the highest Level already celebrated. Acknowledging it raises that highest mark and never lowers it.
- A jump of several Levels at once is one level-up, for the final Level.
- When upgrading to the version that added level-ups, the highest celebrated Level starts at the Level existing time already reaches, so nothing is celebrated for past work.

### Invoice states

| State | Allowed | Moves to |
|---|---|---|
| Draft | add or remove the client's time entries; set payment terms (Net days) and the timesheet page; delete the invoice | Sent (Send) |
| Sent | nothing changes; overdue once today is past its due date | Draft (Unseal), Paid (Mark paid) |
| Paid | nothing changes | Sent (Unmark paid) |

Any other move is rejected, and only a Draft can be deleted.

- **Draft.** Lines, totals and rates are worked out live from its time entries. It can hold any of its client's time entries that are on no invoice, whatever their date; the period does not limit them. It is created with any set of those time entries, including none. Deleting it frees its time entries back to uninvoiced.
- **Send** (Draft → Sent):
  - Needs at least one time entry and the freelancer's name in Settings. A zero total is fine.
  - Gives the invoice a number the first time only: the Settings prefix plus the next number, zero-padded to 4 digits (`INV-0001`). The next number then goes up by one. A number is never reused or given again.
  - Sets the issue date to today and the due date to issue date + Net days. Net days is the invoice's own override if set, else the client's, else the Settings default.
  - Freezes the lines, totals, timesheet, seller details and bill-to details into a snapshot. The bill-to name is the client's billing name if set, else its name. Later changes to Rates, client details or Settings do not reach a Sent or Paid invoice.
  - Freezes each line's Rate onto its time entries and locks them: a locked time entry cannot be edited or deleted.
- **Unseal** (Sent → Draft): keeps the number; clears the issue date, due date and snapshot; unlocks the time entries, which follow live Rates again. Sending again re-dates it and takes a fresh snapshot, but keeps the number and does not use up a new one.
- **Mark paid** (Sent → Paid): paid in full, on a date the user gives. **Unmark paid** (Paid → Sent) clears that date.
- **Invoice line** amount: the line's total seconds × its Rate ÷ 3600, rounded half up to the cent once per line. Lines are sorted by project name, with General last.
- **Default period of a new Draft:** from the day after the client's latest invoice period ended (any state), else from the client's earliest uninvoiced time entry. It runs to today and never starts after today. A preset period is cut off at today.
- A Draft reports how many of the client's uninvoiced time entries fall in its period and were logged after it was created, so they can be added. Time entries left off on purpose predate the Draft and are not counted.

### Time entries

- Date: a local calendar day, not in the future.
- Duration: more than 0 and at most 24 hours. It is entered as `H:MM`, `H:MM:SS` or decimal hours, or as local start and end times.
- An end time before the start time runs past midnight, and the time entry keeps its start date.
- Start and end are converted through the local time zone, so a clock change is counted. A time skipped by a clock change is rejected.
- Overlapping time entries are allowed.
- A time entry's project must belong to its client and be Active. The exception is an edit, which may keep the project it already has even if that project is Complete now.
- Moving a time entry to another client takes it off its Draft, because the Draft belongs to the old client.
- Deleting a time entry on a Draft takes it off the Draft.
- A time entry on a Sent or Paid invoice is locked until that invoice is Unsealed.
- The last-used client and project (to pre-fill the next time entry) come from the most recently logged time entry of an Active client. A Complete project is dropped from it.

### Timer

- Its start is stored as a wall-clock UTC instant, and elapsed time is always now − start. It therefore keeps counting through sleep, quit and crash.
- Stopping saves a time entry dated to the start's local day, even past midnight. Elapsed time rounds up to the whole second, minimum 1 second. Saving the time entry and clearing the Timer happen together.
- Over 24 hours, stopping saves nothing and the Timer keeps running. The user must fix the time entry in the editor (which applies the usual time entry rules) or discard the Timer.
- Starting a Timer while one runs stops the first. If the first needs that fix, the new Timer does not start.
- While running, the Timer's client, project and note can change, and its start can move earlier but never later.
- Discarding records nothing.

### Rate

- A Rate is typed as dollars with up to two decimals (`$` and `,` allowed) and is never negative.
- A project's Rate may be left blank to use its client's Rate.
- **Repricing.**
  - Changing a client's Rate reprices all its uninvoiced time that follows the client Rate: time entries with no project, or on a project without its own Rate.
  - Changing a project's Rate (or blanking it) reprices that project's uninvoiced time.
  - Uninvoiced includes time entries on a Draft. Locked time entries keep their frozen Rate.
  - The confirm preview shows the affected time's old and new totals, each rounded to the cent once.

### Client and Project status

- **Archiving a client** is reversible and allowed at any time. An archived client:
  - takes no new time entries, Timers or projects, and no time entry can move onto it;
  - keeps its details, projects and existing time entries editable, and those time entries may stay on it;
  - can still have its uninvoiced time billed: Draft, Send, Paid. The client list flags clients with time entries on no invoice for this;
  - does not stop a Timer already running for it, which keeps running and saves normally.
- **Completing a project** is reversible. A Complete project leaves the pickers for new time entries and Timers. Its time entries and history stay. Projects list Active first, then by name.
- **Deleting a client** is permanent and only allowed while none of its time entries is on an invoice of any state (archive it instead). It removes its projects, time entries, running Timer and its invoices, which can only be Drafts with no time entries. The confirm first shows how many projects and time entries, and how many Hours, it would remove.
- **Deleting a project** is permanent and only allowed while none of its time entries is on an invoice of any state (complete it instead). It removes its time entries. A Timer running on it keeps running with no project.

### Period

- Presets:
  - **1W:** this Monday to Sunday.
  - **2W and 3W:** end on this week's Sunday.
  - **Month:** the calendar month.
  - **Custom:** any start and end, end not before start.
- Stepping back or forward moves by the period's own length: 1, 2 or 3 weeks, a calendar month, or the custom range's day count. Stepping out of the calendar's range is an error.
- Home charts a period by day up to 42 days. Beyond that it charts by Monday week, and the first bucket may start mid-week.

### Earnings

- Uninvoiced + Invoiced-unpaid + Paid always equals earned.
- A time entry on a Sent or Paid invoice earns at its frozen Rate. Any other time entry, including one on a Draft, earns at its live Rate: its project's if set, else its client's.
- Per client, each part is summed exactly as seconds × Rate and rounded to the cent once. Earned is the sum of those rounded parts, and period totals add up the clients.
- A running Timer counts live as Uninvoiced on its start day (it earns Gold before it is stopped, but no XP).
- Home's all-time figures, which ignore the period: total Invoiced-unpaid, total Uninvoiced, and the count of overdue invoices.
- **CSV export:** the period's time entries, oldest first, optionally for one client. The running Timer is left out. Each row's amount is rounded on its own, so a sum can differ from invoice line totals by a few cents.
