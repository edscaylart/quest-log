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
