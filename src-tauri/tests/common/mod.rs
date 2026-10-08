use std::path::PathBuf;
use std::sync::Mutex;

use chrono::{DateTime, FixedOffset, NaiveDate, NaiveDateTime, TimeZone, Utc};
use quest_log_lib::core::{self, Clock, Db};
use tempfile::TempDir;

/// A clock fixed at a time the test chooses, in UTC−3 (São Paulo, no DST).
pub struct FakeClock(Mutex<DateTime<Utc>>);

impl FakeClock {
    pub fn at(now: DateTime<Utc>) -> Self {
        Self(Mutex::new(now))
    }

    #[allow(dead_code)]
    pub fn set(&self, now: DateTime<Utc>) {
        *self.0.lock().unwrap() = now;
    }

    #[allow(dead_code)]
    pub fn now_plus_minutes(&self, minutes: i64) -> DateTime<Utc> {
        self.now() + chrono::Duration::minutes(minutes)
    }

    fn zone() -> FixedOffset {
        FixedOffset::west_opt(3 * 3600).unwrap()
    }
}

impl Clock for FakeClock {
    fn now(&self) -> DateTime<Utc> {
        *self.0.lock().unwrap()
    }

    fn local_date(&self, at: DateTime<Utc>) -> NaiveDate {
        at.with_timezone(&Self::zone()).date_naive()
    }

    fn to_utc(&self, local: NaiveDateTime) -> Option<DateTime<Utc>> {
        Self::zone()
            .from_local_datetime(&local)
            .single()
            .map(|t| t.to_utc())
    }
}

/// A fresh SQLite file in a temp dir with migrations applied, plus a fake clock.
pub struct Fixture {
    pub db: Db,
    pub clock: FakeClock,
    path: PathBuf,
    _dir: TempDir,
}

impl Fixture {
    pub async fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("quest-log.db");
        Self {
            db: core::open(&path).await.unwrap(),
            clock: FakeClock::at(Utc.with_ymd_and_hms(2026, 10, 7, 9, 0, 0).unwrap()),
            path,
            _dir: dir,
        }
    }

    /// Close the database and open it again, as an app restart would.
    #[allow(dead_code)]
    pub async fn restart(mut self) -> Self {
        self.db.close().await;
        self.db = core::open(&self.path).await.unwrap();
        self
    }
}
