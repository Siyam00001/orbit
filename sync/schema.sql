-- Orbit sync store: one row per (device group, sync key). See worker.js.
CREATE TABLE IF NOT EXISTS docs (
  space TEXT NOT NULL,     -- SHA-256 of the sync code
  k     TEXT NOT NULL,     -- sync key, e.g. d|2026-10-15|velo, s|city, i|1760000000000123
  v     TEXT,              -- JSON value; 'null' = deleted
  t     INTEGER NOT NULL,  -- when the edit was made (ms), newest wins
  seq   INTEGER NOT NULL,  -- per-space change counter for pulls
  PRIMARY KEY (space, k)
);
CREATE INDEX IF NOT EXISTS docs_seq ON docs (space, seq);
