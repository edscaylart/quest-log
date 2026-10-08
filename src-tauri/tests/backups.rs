mod common;

use std::path::{Path, PathBuf};

use chrono::{NaiveDate, TimeZone, Utc};
use common::{FakeClock, Fixture};
use quest_log_lib::core::backups::{back_up, daily_backup, inspect_backup, restore, LastBackup};
use quest_log_lib::core::open;
use quest_log_lib::core::settings::get_settings;
use quest_log_lib::core::Clock;
use sqlx::migrate::Migrator;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool};

fn names(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(dir)
        .map(|d| {
            d.map(|e| e.unwrap().file_name().into_string().unwrap())
                .collect()
        })
        .unwrap_or_default();
    names.sort();
    names
}

fn backups(f: &Fixture) -> PathBuf {
    f.path.parent().unwrap().join("backups")
}

fn date(d: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 10, d).unwrap()
}

#[tokio::test]
async fn daily_backup_is_made_once_per_local_day() {
    let f = Fixture::new().await;

    assert_eq!(
        daily_backup(&f.db, &f.clock, &f.path).await,
        LastBackup::Done { date: date(7) }
    );
    // Later the same local day (23:30 in UTC−3 is 02:30 UTC the next day).
    f.clock
        .set(Utc.with_ymd_and_hms(2026, 10, 8, 2, 30, 0).unwrap());
    assert_eq!(
        daily_backup(&f.db, &f.clock, &f.path).await,
        LastBackup::Done { date: date(7) }
    );

    assert_eq!(names(&backups(&f)), ["daily-2026-10-07.db"]);
}

#[tokio::test]
async fn daily_backup_is_a_working_database() {
    let f = Fixture::new().await;
    sqlx::query("UPDATE settings SET name = 'Ed'")
        .execute(&f.db)
        .await
        .unwrap();

    daily_backup(&f.db, &f.clock, &f.path).await;

    let copy = open(&backups(&f).join("daily-2026-10-07.db"), &f.clock)
        .await
        .unwrap();
    let name: String = sqlx::query_scalar("SELECT name FROM settings")
        .fetch_one(&copy)
        .await
        .unwrap();
    assert_eq!(name, "Ed");
}

#[tokio::test]
async fn the_last_seven_daily_backups_are_kept() {
    let f = Fixture::new().await;

    for day in 1..=9 {
        f.clock
            .set(Utc.with_ymd_and_hms(2026, 10, day, 12, 0, 0).unwrap());
        daily_backup(&f.db, &f.clock, &f.path).await;
    }

    assert_eq!(
        names(&backups(&f)),
        (3..=9)
            .map(|d| format!("daily-2026-10-0{d}.db"))
            .collect::<Vec<_>>()
    );
}

#[tokio::test]
async fn a_failed_daily_backup_is_reported_not_raised() {
    let f = Fixture::new().await;
    std::fs::write(backups(&f), "not a folder").unwrap();

    match daily_backup(&f.db, &f.clock, &f.path).await {
        LastBackup::Failed { date: d, .. } => assert_eq!(d, date(7)),
        other => panic!("expected failure, got {other:?}"),
    }
}

/// A database file at `path` with only the first `n` migrations applied, as
/// an older Quest Log left it.
async fn older_db(path: &Path, n: usize) {
    let dir = tempfile::tempdir().unwrap();
    let mut files = names(&Path::new(env!("CARGO_MANIFEST_DIR")).join("migrations"));
    files.truncate(n);
    for file in files {
        std::fs::copy(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("migrations")
                .join(&file),
            dir.path().join(&file),
        )
        .unwrap();
    }
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true);
    let db = SqlitePool::connect_with(options).await.unwrap();
    Migrator::new(dir.path())
        .await
        .unwrap()
        .run(&db)
        .await
        .unwrap();
    db.close().await;
}

async fn schema_version(db: &SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT MAX(version) FROM _sqlx_migrations")
        .fetch_one(db)
        .await
        .unwrap()
}

#[tokio::test]
async fn migrating_snapshots_the_old_database_first() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("quest-log.db");
    older_db(&path, 5).await;
    let clock = FakeClock::at(Utc.with_ymd_and_hms(2026, 10, 7, 9, 0, 0).unwrap());

    let db = open(&path, &clock).await.unwrap();

    assert!(schema_version(&db).await > 5);
    let snaps = names(&dir.path().join("backups"));
    assert_eq!(snaps, ["pre-migration-20261007T090000Z.db"]);
    let snap = SqlitePool::connect_with(
        SqliteConnectOptions::new().filename(dir.path().join("backups").join(&snaps[0])),
    )
    .await
    .unwrap();
    assert_eq!(schema_version(&snap).await, 5);
}

#[tokio::test]
async fn up_to_date_and_new_databases_take_no_snapshot() {
    let f = Fixture::new().await;
    let f = f.restart().await;

    assert_eq!(names(&backups(&f)), Vec::<String>::new());
}

#[tokio::test]
async fn the_last_three_pre_migration_snapshots_are_kept() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("quest-log.db");
    let clock = FakeClock::at(Utc.with_ymd_and_hms(2026, 10, 7, 9, 0, 0).unwrap());

    for minute in 1..=5 {
        let _ = std::fs::remove_file(&path);
        older_db(&path, 5).await;
        clock.set(Utc.with_ymd_and_hms(2026, 10, 7, 9, minute, 0).unwrap());
        open(&path, &clock).await.unwrap().close().await;
    }

    assert_eq!(
        names(&dir.path().join("backups")),
        (3..=5)
            .map(|m| format!("pre-migration-20261007T090{m}00Z.db"))
            .collect::<Vec<_>>()
    );
}

#[tokio::test]
async fn a_failed_snapshot_blocks_the_migration() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("quest-log.db");
    older_db(&path, 5).await;
    std::fs::write(dir.path().join("backups"), "not a folder").unwrap();
    let clock = FakeClock::at(Utc.with_ymd_and_hms(2026, 10, 7, 9, 0, 0).unwrap());

    assert!(open(&path, &clock).await.is_err());

    let db = SqlitePool::connect_with(SqliteConnectOptions::new().filename(&path))
        .await
        .unwrap();
    assert_eq!(schema_version(&db).await, 5);
}

#[tokio::test]
async fn back_up_now_writes_a_working_database_to_the_chosen_path() {
    let f = Fixture::new().await;
    sqlx::query("UPDATE settings SET name = 'Ed'")
        .execute(&f.db)
        .await
        .unwrap();
    let dest = tempfile::tempdir().unwrap();
    let chosen = dest.path().join("my backup.db");
    std::fs::write(&chosen, "an older file the save panel agreed to replace").unwrap();

    back_up(&f.db, &f.path, &chosen).await.unwrap();

    let copy = open(&chosen, &f.clock).await.unwrap();
    let name: String = sqlx::query_scalar("SELECT name FROM settings")
        .fetch_one(&copy)
        .await
        .unwrap();
    assert_eq!(name, "Ed");
}

#[tokio::test]
async fn back_up_now_refuses_to_replace_the_live_database() {
    let f = Fixture::new().await;

    assert!(back_up(&f.db, &f.path, &f.path).await.is_err());
    assert!(get_settings(&f.db).await.is_ok());
}

async fn client_names(db: &SqlitePool) -> Vec<String> {
    sqlx::query_scalar("SELECT name FROM clients ORDER BY name")
        .fetch_all(db)
        .await
        .unwrap()
}

async fn add_client(db: &SqlitePool, name: &str) {
    sqlx::query("INSERT INTO clients (name, rate_cents, created_at) VALUES (?, 100, 0)")
        .bind(name)
        .execute(db)
        .await
        .unwrap();
}

#[tokio::test]
async fn restoring_an_older_backup_replaces_the_data_and_migrates_it() {
    let f = Fixture::new().await;
    add_client(&f.db, "Current").await;
    let elsewhere = tempfile::tempdir().unwrap();
    let backup = elsewhere.path().join("old.db");
    older_db(&backup, 1).await;
    let old = SqlitePool::connect_with(SqliteConnectOptions::new().filename(&backup))
        .await
        .unwrap();
    add_client(&old, "From backup").await;
    old.close().await;

    restore(&f.db, &f.clock, &f.path, &backup).await.unwrap();
    // The app reloads: opening runs the migrations.
    let db = open(&f.path, &f.clock).await.unwrap();

    assert_eq!(client_names(&db).await, ["From backup"]);
    assert!(
        get_settings(&db).await.is_ok(),
        "migrated to the current schema"
    );
    let before = backups(&f).join("pre-restore-20261007T090000Z.db");
    let before = SqlitePool::connect_with(SqliteConnectOptions::new().filename(before))
        .await
        .unwrap();
    assert_eq!(client_names(&before).await, ["Current"]);
}

#[tokio::test]
async fn a_backup_says_when_it_was_made() {
    let f = Fixture::new().await;
    let backup = backups(&f).join("daily-2026-10-07.db");
    daily_backup(&f.db, &f.clock, &f.path).await;

    let info = inspect_backup(&f.clock, &backup).await.unwrap();

    // The file's modified time, as a local day; the fake clock can't set it.
    let modified = std::fs::metadata(&backup).unwrap().modified().unwrap();
    assert_eq!(info.date, f.clock.local_date(modified.into()));
}

#[tokio::test]
async fn a_backup_from_a_newer_quest_log_is_refused() {
    let f = Fixture::new().await;
    add_client(&f.db, "Current").await;
    let elsewhere = tempfile::tempdir().unwrap();
    let backup = elsewhere.path().join("newer.db");
    back_up(&f.db, &f.path, &backup).await.unwrap();
    let newer = SqlitePool::connect_with(SqliteConnectOptions::new().filename(&backup))
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time) \
         VALUES (9999, 'from the future', 1, x'00', 0)",
    )
    .execute(&newer)
    .await
    .unwrap();
    newer.close().await;

    for err in [
        inspect_backup(&f.clock, &backup).await.unwrap_err(),
        restore(&f.db, &f.clock, &f.path, &backup)
            .await
            .unwrap_err(),
    ] {
        assert_eq!(
            err.to_string(),
            "file: This backup is from a newer Quest Log — update first."
        );
    }
    assert_eq!(client_names(&f.db).await, ["Current"]);
}

#[tokio::test]
async fn a_file_that_is_not_a_quest_log_backup_is_refused() {
    let f = Fixture::new().await;
    let elsewhere = tempfile::tempdir().unwrap();
    let junk = elsewhere.path().join("notes.db");
    std::fs::write(&junk, "just some text").unwrap();
    let empty = elsewhere.path().join("empty.db");
    SqlitePool::connect_with(
        SqliteConnectOptions::new()
            .filename(&empty)
            .create_if_missing(true),
    )
    .await
    .unwrap()
    .close()
    .await;

    for file in [junk, empty] {
        let err = restore(&f.db, &f.clock, &f.path, &file).await.unwrap_err();
        assert_eq!(err.to_string(), "file: This isn't a Quest Log backup.");
    }
    assert!(get_settings(&f.db).await.is_ok());
}
