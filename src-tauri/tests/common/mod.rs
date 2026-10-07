use std::path::PathBuf;
use std::sync::Mutex;

use chrono::{DateTime, TimeZone, Utc};
use quest_log_lib::core::{self, Clock, Db};
use tempfile::TempDir;

/// A clock fixed at a time the test chooses.
pub struct FakeClock(Mutex<DateTime<Utc>>);

impl FakeClock {
    pub fn at(now: DateTime<Utc>) -> Self {
        Self(Mutex::new(now))
    }
}

impl Clock for FakeClock {
    fn now(&self) -> DateTime<Utc> {
        *self.0.lock().unwrap()
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
