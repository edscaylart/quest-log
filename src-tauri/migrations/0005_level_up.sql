CREATE TABLE level_up (
  id                INTEGER PRIMARY KEY CHECK (id = 1),
  celebrated_level  INTEGER NOT NULL  -- highest Level a level-up was shown for
);

-- Start at the Level existing time already reaches, so upgrading celebrates nothing.
-- Level L needs 300·L·(L−1) XP (minutes); mirrors core::progress::level_for.
INSERT INTO level_up (id, celebrated_level)
WITH RECURSIVE
  xp(minutes) AS (SELECT COALESCE(SUM(seconds), 0) / 60 FROM time_entries),
  levels(n) AS (
    SELECT 1
    UNION ALL
    SELECT n + 1 FROM levels, xp WHERE 300 * (n + 1) * n <= minutes
  )
SELECT 1, MAX(n) FROM levels;
