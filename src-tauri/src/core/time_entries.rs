use chrono::{Days, NaiveDate, NaiveTime};
use serde::{Deserialize, Serialize};

use super::{Clock, CoreError, Db, Result};

/// A time entry as typed in the entry form. Strings are parsed here, not in the UI.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryInput {
    pub client_id: i64,
    /// Local calendar day, YYYY-MM-DD.
    pub date: String,
    pub span: Span,
    pub note: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "mode", rename_all = "camelCase")]
pub enum Span {
    /// "1:30" (H:MM) or "1.5" (hours).
    Duration { duration: String },
    /// Local "HH:MM" on the entry's date; an end before the start runs past midnight.
    Range { start: String, end: String },
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct TimeEntry {
    pub id: i64,
    pub client_id: i64,
    pub client_name: String,
    pub date: String,
    pub seconds: i64,
    /// Unix seconds; set only for entries logged by start–end.
    pub started_at: Option<i64>,
    pub ended_at: Option<i64>,
    pub note: Option<String>,
}

pub async fn create_entry(db: &Db, clock: &dyn Clock, input: EntryInput) -> Result<TimeEntry> {
    let v = validate(db, clock, &input).await?;

    let id = sqlx::query(
        "INSERT INTO time_entries (client_id, date, seconds, started_at, ended_at, note, created_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(input.client_id)
    .bind(v.date.to_string())
    .bind(v.seconds)
    .bind(v.started_at)
    .bind(v.ended_at)
    .bind(v.note)
    .bind(clock.now().timestamp())
    .execute(db)
    .await?
    .last_insert_rowid();

    get_entry(db, id).await
}

/// Replaces every field of an entry, under the same rules as creating one.
pub async fn update_entry(
    db: &Db,
    clock: &dyn Clock,
    id: i64,
    input: EntryInput,
) -> Result<TimeEntry> {
    let v = validate(db, clock, &input).await?;

    let updated = sqlx::query(
        "UPDATE time_entries SET client_id = ?, date = ?, seconds = ?, started_at = ?, ended_at = ?, note = ? \
         WHERE id = ?",
    )
    .bind(input.client_id)
    .bind(v.date.to_string())
    .bind(v.seconds)
    .bind(v.started_at)
    .bind(v.ended_at)
    .bind(v.note)
    .bind(id)
    .execute(db)
    .await?
    .rows_affected();
    if updated == 0 {
        return Err(not_found());
    }

    get_entry(db, id).await
}

/// Permanent. Locking for invoiced entries arrives with invoices.
pub async fn delete_entry(db: &Db, id: i64) -> Result<()> {
    let deleted = sqlx::query("DELETE FROM time_entries WHERE id = ?")
        .bind(id)
        .execute(db)
        .await?
        .rows_affected();
    if deleted == 0 {
        return Err(not_found());
    }
    Ok(())
}

/// The client of the most recently logged entry, to pre-fill the next one.
// ponytail: derived from entries; becomes a stored setting if the Timer needs it to differ.
pub async fn last_used_client(db: &Db) -> Result<Option<i64>> {
    Ok(
        sqlx::query_scalar("SELECT client_id FROM time_entries ORDER BY id DESC LIMIT 1")
            .fetch_optional(db)
            .await?,
    )
}

pub async fn list_entries(db: &Db, client_id: Option<i64>) -> Result<Vec<TimeEntry>> {
    Ok(sqlx::query_as(&format!(
        "{SELECT} WHERE ?1 IS NULL OR e.client_id = ?1 ORDER BY e.date DESC, e.started_at DESC, e.id DESC"
    ))
    .bind(client_id)
    .fetch_all(db)
    .await?)
}

const SELECT: &str = "SELECT e.id, e.client_id, c.name AS client_name, e.date, e.seconds, \
    e.started_at, e.ended_at, e.note FROM time_entries e JOIN clients c ON c.id = e.client_id";

async fn get_entry(db: &Db, id: i64) -> Result<TimeEntry> {
    sqlx::query_as(&format!("{SELECT} WHERE e.id = ?"))
        .bind(id)
        .fetch_optional(db)
        .await?
        .ok_or_else(not_found)
}

fn not_found() -> CoreError {
    CoreError::NotFound {
        message: "Time entry not found".into(),
    }
}

struct Valid<'a> {
    date: NaiveDate,
    seconds: i64,
    started_at: Option<i64>,
    ended_at: Option<i64>,
    note: Option<&'a str>,
}

async fn validate<'a>(db: &Db, clock: &dyn Clock, input: &'a EntryInput) -> Result<Valid<'a>> {
    let client: Option<i64> = sqlx::query_scalar("SELECT id FROM clients WHERE id = ?")
        .bind(input.client_id)
        .fetch_optional(db)
        .await?;
    if client.is_none() {
        return Err(invalid("client", "Client is required"));
    }

    let date = NaiveDate::parse_from_str(input.date.trim(), "%Y-%m-%d")
        .map_err(|_| invalid("date", "Date is required"))?;
    if date > clock.today() {
        return Err(invalid("date", "Date can't be in the future"));
    }

    // `field` is where a bad duration is reported: the duration itself, or the end time.
    let (field, seconds, started_at, ended_at) = match &input.span {
        Span::Duration { duration } => ("duration", parse_duration(duration)?, None, None),
        Span::Range { start, end } => {
            let start = date.and_time(parse_time("start", start)?);
            let mut end = date.and_time(parse_time("end", end)?);
            if end < start {
                end = end + Days::new(1);
            }
            let skipped = |field| invalid(field, "That time is skipped by a clock change");
            let start = clock.to_utc(start).ok_or_else(|| skipped("start"))?;
            let end = clock.to_utc(end).ok_or_else(|| skipped("end"))?;
            let (start, end) = (start.timestamp(), end.timestamp());
            ("end", end - start, Some(start), Some(end))
        }
    };
    if seconds <= 0 {
        return Err(invalid(field, "Duration must be more than 0"));
    }
    if seconds > 24 * 3600 {
        return Err(invalid(field, "Duration can't be more than 24 hours"));
    }

    Ok(Valid {
        date,
        seconds,
        started_at,
        ended_at,
        note: input
            .note
            .as_deref()
            .map(str::trim)
            .filter(|n| !n.is_empty()),
    })
}

fn parse_time(field: &'static str, input: &str) -> Result<NaiveTime> {
    NaiveTime::parse_from_str(input.trim(), "%H:%M")
        .map_err(|_| invalid(field, "Time must look like 09:30"))
}

/// "1:30" → 5400, "1:00:30" → 3630, "1.5" → 5400, "2" → 7200.
fn parse_duration(input: &str) -> Result<i64> {
    let text = input.trim();
    let malformed = || invalid("duration", "Duration must look like 1:30 or 1.5");
    if text.is_empty() {
        return Err(invalid("duration", "Duration is required"));
    }
    if text.contains(':') {
        let parts: Vec<&str> = text.split(':').collect();
        let digits = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
        let sixty = |s: &&str| s.len() == 2 && digits(s) && s < &"60";
        if !(2..=3).contains(&parts.len()) || !digits(parts[0]) || !parts[1..].iter().all(sixty) {
            return Err(malformed());
        }
        let hours: i64 = parts[0].parse().map_err(|_| malformed())?;
        let rest = parts[1..]
            .iter()
            .zip([60, 1])
            .map(|(p, unit)| p.parse::<i64>().unwrap() * unit)
            .sum::<i64>();
        return Ok(hours.saturating_mul(3600).saturating_add(rest));
    }
    let hours: f64 = text.parse().map_err(|_| malformed())?;
    if !hours.is_finite() || hours < 0.0 {
        return Err(malformed());
    }
    Ok((hours * 3600.0).round() as i64)
}

fn invalid(field: &'static str, message: &str) -> CoreError {
    CoreError::Invalid {
        field,
        message: message.to_owned(),
    }
}
