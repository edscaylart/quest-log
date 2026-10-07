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

**Project status**:
Whether a project is Active or Complete. A complete project leaves the active list; its time entries and history remain.
RPG label: Complete → "Quest complete".

**Time entry**:
One recorded stretch of work for a client: a date and a duration, optionally with start and end times and a note. Its date is the day it started, even if it runs past midnight. Once on an invoice it is locked.
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
The amount billed per hour of work. Every client has one; a project may override it. A time entry's rate is its project's rate if set, else its client's. Until a time entry is on an invoice its rate is live — changing a client or project rate reprices its uninvoiced time; once invoiced, the rate is frozen on the invoice. Every time entry is billable; work not to be charged goes on a project with a rate of zero.
RPG label: "Gold/hr".
_Avoid_: Bounty, wage, fee, billable flag

**Invoice**:
A request for payment to one client, covering time entries over a period.
RPG label: "Scroll".
_Avoid_: Quest complete (for a paid invoice)

**Invoice state**:
Where an invoice is in its life: Draft, Sent or Paid.
RPG labels: Draft → "Unsealed", Sent → "Sealed", Paid → "Redeemed".

**Earnings**:
Gold from time entries, split by where it stands in billing: Uninvoiced (not on any invoice), Invoiced-unpaid (on a Sent invoice), Paid (on a Paid invoice).
RPG labels: Uninvoiced → "Unclaimed", Invoiced-unpaid → "Owed", Paid → "Treasury".
