ALTER TABLE clients ADD COLUMN billing_name TEXT;  -- NULL falls back to name
ALTER TABLE clients ADD COLUMN address      TEXT;
ALTER TABLE clients ADD COLUMN email        TEXT;
ALTER TABLE clients ADD COLUMN net_days     INTEGER CHECK (net_days >= 0);  -- NULL uses the default

CREATE TABLE projects (
  id          INTEGER PRIMARY KEY,
  client_id   INTEGER NOT NULL REFERENCES clients(id),
  name        TEXT    NOT NULL,
  rate_cents  INTEGER CHECK (rate_cents >= 0),  -- NULL uses the client's rate
  complete    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

ALTER TABLE time_entries ADD COLUMN project_id INTEGER REFERENCES projects(id);
ALTER TABLE timer        ADD COLUMN project_id INTEGER REFERENCES projects(id);
