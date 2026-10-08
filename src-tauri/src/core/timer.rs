//! The one Timer. Its start is stored as wall-clock UTC and elapsed time is
//! always `now − started_at`, so it keeps counting through sleep, quit and crash.

use chrono::{DateTime, NaiveDateTime};
use serde::{Deserialize, Serialize};

use super::time_entries::{
    clean_note, get_entry, insert, invalid, require_client, require_project, validate, EntryInput,
    TimeEntry, Valid,
};
use super::{Clock, CoreError, Db, Result};

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Timer {
    pub client_id: i64,
    pub client_name: String,
    pub project_id: Option<i64>,
    pub project_name: Option<String>,
    /// Unix milliseconds.
    pub started_at: i64,
    pub note: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimerStart {
    pub client_id: i64,
    pub project_id: Option<i64>,
    pub note: Option<String>,
}

/// A running Timer's editable fields.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimerEdit {
    pub client_id: i64,
    pub project_id: Option<i64>,
    pub note: Option<String>,
    /// Local "YYYY-MM-DDTHH:MM"; `None` keeps the start as is.
    pub start: Option<String>,
}

/// What stopping a Timer did.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Stopped {
    Saved {
        entry: TimeEntry,
    },
    /// Ran over 24 hours. Nothing was saved and the Timer is still running;
    /// the entry editor resolves it with [`finish_timer`] or [`discard_timer`].
    NeedsEdit {
        overlong: Overlong,
    },
}

/// A time entry the Timer would make, for the editor to fix.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overlong {
    pub client_id: i64,
    pub project_id: Option<i64>,
    pub date: String,
    pub seconds: i64,
    pub note: Option<String>,
}

pub async fn get_timer(db: &Db) -> Result<Option<Timer>> {
    Ok(sqlx::query_as(
        "SELECT t.client_id, c.name AS client_name, t.project_id, p.name AS project_name, \
         t.started_at, t.note FROM timer t JOIN clients c ON c.id = t.client_id \
         LEFT JOIN projects p ON p.id = t.project_id",
    )
    .fetch_optional(db)
    .await?)
}

/// Starts the Timer. A running one is stopped first, and what that did is
/// returned; if it needs editing, the new Timer does not start.
pub async fn start_timer(db: &Db, clock: &dyn Clock, input: TimerStart) -> Result<Option<Stopped>> {
    require_client(db, input.client_id).await?;
    require_project(db, input.client_id, input.project_id, None).await?;
    let previous = match get_timer(db).await? {
        Some(_) => Some(stop_timer(db, clock).await?),
        None => None,
    };
    if let Some(Stopped::NeedsEdit { .. }) = previous {
        return Ok(previous);
    }
    sqlx::query(
        "INSERT INTO timer (id, client_id, project_id, started_at, note) VALUES (1, ?, ?, ?, ?)",
    )
    .bind(input.client_id)
    .bind(input.project_id)
    .bind(clock.now().timestamp_millis())
    .bind(input.note.as_deref().and_then(clean_note))
    .execute(db)
    .await?;
    Ok(previous)
}

pub async fn stop_timer(db: &Db, clock: &dyn Clock) -> Result<Stopped> {
    let timer = get_timer(db).await?.ok_or_else(not_running)?;
    // Sub-second rounds up, so even a 0.2s Timer records 1s.
    let elapsed_ms = clock.now().timestamp_millis() - timer.started_at;
    let seconds = ((elapsed_ms + 999) / 1000).max(1);
    let start = DateTime::from_timestamp_millis(timer.started_at).ok_or_else(not_running)?;
    // Dated to the start's local day, even past midnight.
    let date = clock.local_date(start);

    if seconds > 24 * 3600 {
        return Ok(Stopped::NeedsEdit {
            overlong: Overlong {
                client_id: timer.client_id,
                project_id: timer.project_id,
                date: date.to_string(),
                seconds,
                note: timer.note,
            },
        });
    }

    let started_at = start.timestamp();
    let valid = Valid {
        project_id: timer.project_id,
        date,
        seconds,
        started_at: Some(started_at),
        ended_at: Some(started_at + seconds),
        note: timer.note.as_deref(),
    };
    Ok(Stopped::Saved {
        entry: save_and_clear(db, clock, timer.client_id, valid).await?,
    })
}

/// Changes the client, project and note; the start may only move earlier.
pub async fn update_timer(db: &Db, clock: &dyn Clock, input: TimerEdit) -> Result<Timer> {
    let timer = get_timer(db).await?.ok_or_else(not_running)?;
    require_client(db, input.client_id).await?;
    require_project(db, input.client_id, input.project_id, timer.project_id).await?;
    let started_at = match input.start.as_deref().map(str::trim) {
        None => timer.started_at,
        Some(text) => {
            let local = NaiveDateTime::parse_from_str(text, "%Y-%m-%dT%H:%M")
                .map_err(|_| invalid("start", "Start is required"))?;
            let start = clock
                .to_utc(local)
                .ok_or_else(|| invalid("start", "That time is skipped by a clock change"))?
                .timestamp_millis();
            if start > timer.started_at {
                return Err(invalid("start", "Start can only move earlier"));
            }
            start
        }
    };

    sqlx::query("UPDATE timer SET client_id = ?, project_id = ?, started_at = ?, note = ?")
        .bind(input.client_id)
        .bind(input.project_id)
        .bind(started_at)
        .bind(input.note.as_deref().and_then(clean_note))
        .execute(db)
        .await?;
    get_timer(db).await?.ok_or_else(not_running)
}

/// Saves the editor's fixed version of a Timer that [`Stopped::NeedsEdit`],
/// under the usual entry rules, and clears the Timer.
pub async fn finish_timer(db: &Db, clock: &dyn Clock, input: EntryInput) -> Result<TimeEntry> {
    let timer = get_timer(db).await?.ok_or_else(not_running)?;
    let v = validate(db, clock, &input, timer.project_id).await?;
    save_and_clear(db, clock, input.client_id, v).await
}

/// Writes the entry and clears the Timer together, so a crash can neither
/// lose the time nor save it twice.
async fn save_and_clear(
    db: &Db,
    clock: &dyn Clock,
    client_id: i64,
    v: Valid<'_>,
) -> Result<TimeEntry> {
    let mut tx = db.begin().await?;
    let id = insert(&mut tx, clock, client_id, v).await?;
    sqlx::query("DELETE FROM timer").execute(&mut *tx).await?;
    tx.commit().await?;
    get_entry(db, id).await
}

/// Records nothing.
pub async fn discard_timer(db: &Db) -> Result<()> {
    sqlx::query("DELETE FROM timer").execute(db).await?;
    Ok(())
}

fn not_running() -> CoreError {
    CoreError::NotFound {
        message: "No Timer is running".into(),
    }
}
