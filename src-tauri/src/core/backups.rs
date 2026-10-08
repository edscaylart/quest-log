//! Snapshots of the database in a `backups/` folder beside it, always taken
//! with `VACUUM INTO` so a copy is never caught mid-write.

use std::path::{Path, PathBuf};

use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool};

use super::{Clock, CoreError, Db, Result, MIGRATOR};

/// How the launch's daily backup went, for Settings → Data.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LastBackup {
    Done { date: NaiveDate },
    Failed { date: NaiveDate, message: String },
}

/// Settings → Data: where the database lives and how today's backup went.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataInfo {
    pub path: PathBuf,
    pub last_backup: LastBackup,
}

const DAILY_KEPT: usize = 7;
const PRE_MIGRATION_KEPT: usize = 3;
const PRE_RESTORE_KEPT: usize = 3;

pub fn backups_dir(db_path: &Path) -> PathBuf {
    db_path.with_file_name("backups")
}

/// Today's snapshot, unless one exists already; keeps the last 7. Never fails
/// the launch: a failure comes back as [`LastBackup::Failed`].
pub async fn daily_backup(db: &Db, clock: &dyn Clock, db_path: &Path) -> LastBackup {
    let date = clock.today();
    let dir = backups_dir(db_path);
    let made = async {
        let dest = dir.join(format!("daily-{date}.db"));
        if !dest.exists() {
            snapshot_into(db, &dest).await?;
        }
        prune(&dir, "daily-", DAILY_KEPT)
    };
    match made.await {
        Ok(()) => LastBackup::Done { date },
        Err(e) => LastBackup::Failed {
            date,
            message: e.to_string(),
        },
    }
}

/// "Back up now": a snapshot to wherever the user chose, replacing what's
/// there (the save panel already asked) — except the live database itself.
pub async fn back_up(db: &Db, db_path: &Path, dest: &Path) -> Result<()> {
    if same_file(db_path, dest) {
        return Err(invalid(
            "Choose a different file from Quest Log's own database",
        ));
    }
    snapshot_into(db, dest).await
}

#[derive(Debug, Serialize)]
pub struct BackupInfo {
    /// The local day the file was last written.
    pub date: NaiveDate,
}

/// Checks a file can be restored and says when it was made, for the confirm.
pub async fn inspect_backup(clock: &dyn Clock, backup: &Path) -> Result<BackupInfo> {
    open_backup(backup).await?.close().await;
    let modified = std::fs::metadata(backup)
        .and_then(|m| m.modified())
        .map_err(io)?;
    Ok(BackupInfo {
        date: clock.local_date(DateTime::<Utc>::from(modified)),
    })
}

/// Replaces the live database with `backup`, snapshotting it first (last 3
/// kept). Closes `db`: the app must reopen, which migrates an older backup.
pub async fn restore(db: &Db, clock: &dyn Clock, db_path: &Path, backup: &Path) -> Result<()> {
    let source = open_backup(backup).await?;
    let incoming = db_path.with_extension("restoring");
    let copied = async {
        stamped_backup(db, clock, db_path, "pre-restore-", PRE_RESTORE_KEPT).await?;
        snapshot_into(&source, &incoming).await
    }
    .await;
    source.close().await;
    copied?;
    db.close().await;
    std::fs::rename(&incoming, db_path).map_err(io)
}

/// Read-only, and only if it's a Quest Log database this version can migrate.
async fn open_backup(path: &Path) -> Result<Db> {
    let not_ours = || invalid("This isn't a Quest Log backup.");
    if !path.is_file() {
        return Err(not_ours());
    }
    let options = SqliteConnectOptions::new().filename(path).read_only(true);
    let db = SqlitePool::connect_with(options)
        .await
        .map_err(|_| not_ours())?;
    let checked = match applied_migrations(&db).await {
        Ok(applied) if applied.is_empty() => Err(not_ours()),
        Ok(applied)
            if applied
                .iter()
                .any(|v| !MIGRATOR.iter().any(|m| m.version == *v)) =>
        {
            Err(invalid(
                "This backup is from a newer Quest Log — update first.",
            ))
        }
        Ok(_) => Ok(()),
        Err(_) => Err(not_ours()),
    };
    if let Err(e) = checked {
        db.close().await;
        return Err(e);
    }
    Ok(db)
}

/// Shows the database file selected in Finder.
pub fn reveal(db_path: &Path) -> Result<()> {
    // ponytail: macOS-only app (ADR 0001), so Finder's own `open -R`.
    let status = std::process::Command::new("open")
        .arg("-R")
        .arg(db_path)
        .status()
        .map_err(io)?;
    if status.success() {
        Ok(())
    } else {
        Err(CoreError::NotFound {
            message: "Finder couldn't show the database file".into(),
        })
    }
}

/// Before a schema migration; keeps the last 3. Its failure blocks the migration.
pub(super) async fn pre_migration_backup(db: &Db, clock: &dyn Clock, db_path: &Path) -> Result<()> {
    stamped_backup(db, clock, db_path, "pre-migration-", PRE_MIGRATION_KEPT).await
}

/// `<prefix><UTC time>.db` in the backups folder, keeping the newest `keep`.
async fn stamped_backup(
    db: &Db,
    clock: &dyn Clock,
    db_path: &Path,
    prefix: &str,
    keep: usize,
) -> Result<()> {
    let dir = backups_dir(db_path);
    let stamp = clock.now().format("%Y%m%dT%H%M%SZ");
    snapshot_into(db, &dir.join(format!("{prefix}{stamp}.db"))).await?;
    prune(&dir, prefix, keep)
}

/// Schema versions applied to a database; none for a new or foreign one.
pub(super) async fn applied_migrations(db: &Db) -> Result<Vec<i64>> {
    let has_table: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM sqlite_master WHERE name = '_sqlx_migrations')",
    )
    .fetch_one(db)
    .await?;
    if !has_table {
        return Ok(vec![]);
    }
    Ok(sqlx::query_scalar("SELECT version FROM _sqlx_migrations")
        .fetch_all(db)
        .await?)
}

/// `VACUUM INTO` a temp file beside `dest`, then rename it into place, so a
/// failed snapshot never leaves a half-written file under the real name.
async fn snapshot_into(db: &Db, dest: &Path) -> Result<()> {
    if let Some(dir) = dest.parent() {
        std::fs::create_dir_all(dir).map_err(io)?;
    }
    let tmp = dest.with_extension("partial");
    let _ = std::fs::remove_file(&tmp);
    sqlx::query("VACUUM INTO ?")
        .bind(tmp.to_string_lossy())
        .execute(db)
        .await?;
    std::fs::rename(&tmp, dest).map_err(io)
}

/// Keep the newest `keep` files named `<prefix>…db`; names sort by time.
fn prune(dir: &Path, prefix: &str, keep: usize) -> Result<()> {
    let mut set: Vec<PathBuf> = std::fs::read_dir(dir)
        .map_err(io)?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with(prefix) && n.ends_with(".db"))
        })
        .collect();
    set.sort();
    for old in &set[..set.len().saturating_sub(keep)] {
        std::fs::remove_file(old).map_err(io)?;
    }
    Ok(())
}

fn same_file(a: &Path, b: &Path) -> bool {
    matches!((a.canonicalize(), b.canonicalize()), (Ok(a), Ok(b)) if a == b)
}

fn invalid(message: &str) -> CoreError {
    CoreError::Invalid {
        field: "file",
        message: message.into(),
    }
}

fn io(e: std::io::Error) -> CoreError {
    CoreError::Database {
        message: e.to_string(),
    }
}
