CREATE TABLE invoices (
  id            INTEGER PRIMARY KEY,
  client_id     INTEGER NOT NULL REFERENCES clients(id),
  period_start  TEXT    NOT NULL,  -- local calendar days, YYYY-MM-DD, both included
  period_end    TEXT    NOT NULL,
  state         TEXT    NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'sent', 'paid')),
  timesheet     INTEGER NOT NULL DEFAULT 1,  -- print the timesheet page
  created_at    INTEGER NOT NULL
);

-- One column, so an entry sits on at most one invoice of any state.
ALTER TABLE time_entries ADD COLUMN invoice_id INTEGER REFERENCES invoices(id);
