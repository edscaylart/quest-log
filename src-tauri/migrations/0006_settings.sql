CREATE TABLE settings (
  id                    INTEGER PRIMARY KEY CHECK (id = 1),
  -- The freelancer's invoice header; name is required once set, blank until then.
  name                  TEXT    NOT NULL DEFAULT '',
  business_name         TEXT,
  address               TEXT,
  email                 TEXT,
  tax_id                TEXT,
  payment_instructions  TEXT,
  net_days              INTEGER NOT NULL DEFAULT 30 CHECK (net_days > 0),
  invoice_prefix        TEXT    NOT NULL DEFAULT 'INV-',
  next_invoice_number   INTEGER NOT NULL DEFAULT 1 CHECK (next_invoice_number > 0)
);

INSERT INTO settings (id) VALUES (1);
