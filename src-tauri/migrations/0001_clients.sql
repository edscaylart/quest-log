CREATE TABLE clients (
  id          INTEGER PRIMARY KEY,
  name        TEXT    NOT NULL,
  rate_cents  INTEGER NOT NULL CHECK (rate_cents >= 0),
  created_at  INTEGER NOT NULL
);
