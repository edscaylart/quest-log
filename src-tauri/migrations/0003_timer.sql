CREATE TABLE timer (
  id          INTEGER PRIMARY KEY CHECK (id = 1),  -- at most one Timer
  client_id   INTEGER NOT NULL REFERENCES clients(id),
  started_at  INTEGER NOT NULL,  -- unix milliseconds, wall-clock UTC
  note        TEXT
);
