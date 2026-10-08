//! XP and Level, always worked out from the saved time entries (no ledger).

use serde::Serialize;

use super::{Db, Result};

/// XP to reach `level`: 5·L·(L−1) hours, one XP per minute.
fn xp_to_reach(level: i64) -> i64 {
    300 * level * (level - 1)
}

/// The Level that `xp` reaches. No cap.
pub fn level_for(xp: i64) -> i64 {
    let mut level = 1;
    while xp >= xp_to_reach(level + 1) {
        level += 1;
    }
    level
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub level: i64,
    pub xp: i64,
    /// XP where this Level starts and the next one does, for the bar.
    pub level_xp: i64,
    pub next_level_xp: i64,
    /// A new highest Level not yet celebrated.
    pub level_up: Option<i64>,
}

/// Hours only, so the running Timer counts once it is stopped.
pub async fn progress(db: &Db) -> Result<Progress> {
    let (seconds, celebrated): (i64, i64) = sqlx::query_as(
        "SELECT (SELECT COALESCE(SUM(seconds), 0) FROM time_entries), celebrated_level FROM level_up",
    )
    .fetch_one(db)
    .await?;
    let xp = seconds / 60;
    let level = level_for(xp);
    Ok(Progress {
        level,
        xp,
        level_xp: xp_to_reach(level),
        next_level_xp: xp_to_reach(level + 1),
        level_up: (level > celebrated).then_some(level),
    })
}

/// The level-up for `level` was shown. Never lowers the highest.
pub async fn acknowledge_level_up(db: &Db, level: i64) -> Result<()> {
    sqlx::query("UPDATE level_up SET celebrated_level = MAX(celebrated_level, ?)")
        .bind(level)
        .execute(db)
        .await?;
    Ok(())
}
