ALTER TABLE invoices ADD COLUMN number     TEXT;     -- given at the first Send, kept on revert
ALTER TABLE invoices ADD COLUMN net_days   INTEGER CHECK (net_days >= 0);  -- NULL uses the client's, else Settings'
ALTER TABLE invoices ADD COLUMN issue_date TEXT;     -- local days, YYYY-MM-DD; Sent and Paid only
ALTER TABLE invoices ADD COLUMN due_date   TEXT;
ALTER TABLE invoices ADD COLUMN paid_date  TEXT;     -- Paid only
ALTER TABLE invoices ADD COLUMN snapshot   TEXT;     -- JSON frozen at Send; Sent and Paid only

-- The rate frozen at Send: set exactly while the entry is on a Sent or Paid invoice, which locks it.
ALTER TABLE time_entries ADD COLUMN invoiced_rate_cents INTEGER;
