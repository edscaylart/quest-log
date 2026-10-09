# One archived-Client rule for every picker

Quest Log does not collapse its Client pickers onto a single archived ("Retired") Client rule. The pickers differ on purpose, and each difference comes from a rule in [docs/CONTEXT.md](../docs/CONTEXT.md) ("Client and Project status").

## Why this is out of scope

What looks like several rules is really three, one per job:

- **New work (time entries, Timers):** a Client is selectable when it is Active, or when it is already the record's own Client. An archived Client takes no new time entries or Timers, but existing time entries and a running Timer keep it. The Timer HUD Start modal (`components/timer/Hud.tsx`) looks like a separate "hidden" rule only because a new Timer has no Client yet. The Edit modal and `TimeEntryModal` apply the same rule with a current Client.

  ```ts
  useClients((c) => !c.archived || c.id === initial?.clientId)
  ```

- **Billing (new Draft):** an archived Client can still have its uninvoiced time billed, so `NewDraftModal` shows it while it has available time entries.

  ```ts
  useClients((c) => !c.archived || c.hasAvailable)
  ```

- **Browse and report (Log filter, CSV export, Clients page):** every Client is listed, because history stays reachable after archiving.

Merging the new-work and billing rules would either block billing an archived Client's leftover time or let new work land on archived Clients. Both contradict the domain rules.

The only real divergence is presentation in the all-Client pickers: the Log filter groups archived Clients under an optgroup, while the CSV export and new-Draft pickers add a "(Retired)" suffix. That is cosmetic. Reopen as a narrow presentation issue if it starts to bother anyone, rather than as a rule unification.

## Prior requests

- #50: "Unify archived Client filter rules across pickers"
