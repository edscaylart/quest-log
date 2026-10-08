CREATE TABLE time_entries (
  id          INTEGER PRIMARY KEY,
  client_id   INTEGER NOT NULL REFERENCES clients(id),
  date        TEXT    NOT NULL,  -- local calendar day, YYYY-MM-DD
  seconds     INTEGER NOT NULL CHECK (seconds BETWEEN 1 AND 86400),
  started_at  INTEGER,           -- unix seconds, start–end entries only
  ended_at    INTEGER,
  note        TEXT,
  created_at  INTEGER NOT NULL
);
