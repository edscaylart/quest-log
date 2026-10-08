//! Invoices. A Draft is a working copy computed live from its time entries.

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use sqlx::SqliteConnection;

use super::clients::{amount, invalid};
use super::dashboard::{period, Period, PeriodInput, Preset};
use super::time_entries::{require_client, TimeEntry, SELECT as ENTRY_SELECT};
use super::{Clock, CoreError, Db, Result};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, sqlx::Type)]
#[serde(rename_all = "camelCase")]
#[sqlx(rename_all = "lowercase")]
pub enum State {
    Draft,
    Sent,
    Paid,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewDraft {
    pub client_id: i64,
    /// Local days, YYYY-MM-DD, both included.
    pub start: String,
    pub end: String,
    /// The client's entries on no invoice; any date.
    pub entry_ids: Vec<i64>,
}

/// One row of an invoice: all its entries for one project, or for none ("General").
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Line {
    pub project_id: Option<i64>,
    pub description: String,
    pub seconds: i64,
    pub rate_cents: i64,
    /// Exact seconds × rate, rounded to the cent once.
    pub amount_cents: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Invoice {
    pub id: i64,
    pub client_id: i64,
    pub client_name: String,
    pub state: State,
    pub period: Period,
    /// Print the timesheet page.
    pub timesheet: bool,
    /// Projects by name, then General.
    pub lines: Vec<Line>,
    pub seconds: i64,
    pub total_cents: i64,
    /// Its entries, newest first.
    pub entries: Vec<TimeEntry>,
    /// The client's entries on no invoice, newest first, that could be added.
    pub available: Vec<TimeEntry>,
    /// How many of `available` fall in the period and were logged after it was created.
    pub new_in_period: i64,
}

/// A row of the invoices list.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceSummary {
    pub id: i64,
    pub client_id: i64,
    pub client_name: String,
    pub state: State,
    pub period: Period,
    pub seconds: i64,
    pub total_cents: i64,
}

/// What a new Draft for a client and period would hold.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftCandidates {
    pub period: Period,
    /// The client's entries in the period on no invoice, newest first.
    pub entries: Vec<TimeEntry>,
    /// The client's entries before the period on no invoice.
    pub older: i64,
    /// The earliest of those, to stretch the period back to.
    pub older_since: Option<NaiveDate>,
}

/// `period` `None` is the default: from the day after the client's last
/// invoice period ended (else its earliest uninvoiced entry) to today.
pub async fn draft_candidates(
    db: &Db,
    clock: &dyn Clock,
    client_id: i64,
    input: Option<&PeriodInput>,
) -> Result<DraftCandidates> {
    let today = clock.today();
    let period = match input {
        // A preset's period may run past today; there's nothing to bill there.
        Some(input) if input.preset != Preset::Custom => {
            let p = period(input, today)?;
            Period {
                end: p.end.min(today).max(p.start),
                ..p
            }
        }
        Some(input) => period(input, today)?,
        None => Period {
            start: default_start(db, client_id)
                .await?
                .unwrap_or(today)
                .min(today),
            end: today,
        },
    };
    let entries: Vec<TimeEntry> = sqlx::query_as(&format!(
        "{ENTRY_SELECT} WHERE e.client_id = ? AND e.invoice_id IS NULL AND e.date BETWEEN ? AND ? \
         {NEWEST_FIRST}"
    ))
    .bind(client_id)
    .bind(period.start.to_string())
    .bind(period.end.to_string())
    .fetch_all(db)
    .await?;
    let (older, older_since): (i64, Option<String>) = sqlx::query_as(
        "SELECT COUNT(*), MIN(date) FROM time_entries \
         WHERE client_id = ? AND invoice_id IS NULL AND date < ?",
    )
    .bind(client_id)
    .bind(period.start.to_string())
    .fetch_one(db)
    .await?;
    Ok(DraftCandidates {
        period,
        entries,
        older,
        older_since: older_since.and_then(|d| d.parse().ok()),
    })
}

async fn default_start(db: &Db, client_id: i64) -> Result<Option<NaiveDate>> {
    let last_end: Option<String> =
        sqlx::query_scalar("SELECT MAX(period_end) FROM invoices WHERE client_id = ?")
            .bind(client_id)
            .fetch_one(db)
            .await?;
    if let Some(end) = last_end.and_then(|d| d.parse::<NaiveDate>().ok()) {
        return Ok(end.succ_opt());
    }
    let earliest: Option<String> = sqlx::query_scalar(
        "SELECT MIN(date) FROM time_entries WHERE client_id = ? AND invoice_id IS NULL",
    )
    .bind(client_id)
    .fetch_one(db)
    .await?;
    Ok(earliest.and_then(|d| d.parse().ok()))
}

/// Entries go on the Draft only if they are the client's and on no invoice.
pub async fn create_draft(db: &Db, clock: &dyn Clock, input: NewDraft) -> Result<Invoice> {
    require_client(db, input.client_id).await?;
    let custom = PeriodInput {
        preset: Preset::Custom,
        offset: 0,
        start: Some(input.start),
        end: Some(input.end),
    };
    let p = period(&custom, clock.today())?;

    let mut tx = db.begin().await?;
    let id = sqlx::query(
        "INSERT INTO invoices (client_id, period_start, period_end, created_at) VALUES (?, ?, ?, ?)",
    )
    .bind(input.client_id)
    .bind(p.start.to_string())
    .bind(p.end.to_string())
    .bind(clock.now().timestamp())
    .execute(&mut *tx)
    .await?
    .last_insert_rowid();
    for entry_id in input.entry_ids {
        attach(&mut tx, id, input.client_id, entry_id).await?;
    }
    tx.commit().await?;
    get_invoice(db, id).await
}

pub async fn get_invoice(db: &Db, id: i64) -> Result<Invoice> {
    let (client_id, client_name, state, start, end, timesheet, created_at): (
        i64,
        String,
        State,
        String,
        String,
        bool,
        i64,
    ) = sqlx::query_as(
        "SELECT i.client_id, c.name, i.state, i.period_start, i.period_end, i.timesheet, i.created_at \
         FROM invoices i JOIN clients c ON c.id = i.client_id WHERE i.id = ?",
    )
    .bind(id)
    .fetch_optional(db)
    .await?
    .ok_or_else(not_found)?;
    let period = Period {
        start: parse_day(&start)?,
        end: parse_day(&end)?,
    };
    let entries: Vec<TimeEntry> = sqlx::query_as(&format!(
        "{ENTRY_SELECT} WHERE e.invoice_id = ? {NEWEST_FIRST}"
    ))
    .bind(id)
    .fetch_all(db)
    .await?;
    let available: Vec<TimeEntry> = sqlx::query_as(&format!(
        "{ENTRY_SELECT} WHERE e.client_id = ? AND e.invoice_id IS NULL {NEWEST_FIRST}"
    ))
    .bind(client_id)
    .fetch_all(db)
    .await?;
    // Entries left out on purpose (unticked or removed) predate the Draft.
    let new_in_period: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM time_entries WHERE client_id = ? AND invoice_id IS NULL \
         AND date BETWEEN ? AND ? AND created_at > ?",
    )
    .bind(client_id)
    .bind(&start)
    .bind(&end)
    .bind(created_at)
    .fetch_one(db)
    .await?;
    let lines = lines(&entries);
    Ok(Invoice {
        id,
        client_id,
        client_name,
        state,
        period,
        timesheet,
        seconds: lines.iter().map(|l| l.seconds).sum(),
        total_cents: lines.iter().map(|l| l.amount_cents).sum(),
        lines,
        new_in_period,
        entries,
        available,
    })
}

/// Newest first.
// ponytail: one get_invoice per row; one grouped query if the list gets long.
pub async fn list_invoices(db: &Db) -> Result<Vec<InvoiceSummary>> {
    let ids: Vec<i64> =
        sqlx::query_scalar("SELECT id FROM invoices ORDER BY created_at DESC, id DESC")
            .fetch_all(db)
            .await?;
    let mut list = Vec::with_capacity(ids.len());
    for id in ids {
        let i = get_invoice(db, id).await?;
        list.push(InvoiceSummary {
            id,
            client_id: i.client_id,
            client_name: i.client_name,
            state: i.state,
            period: i.period,
            seconds: i.seconds,
            total_cents: i.total_cents,
        });
    }
    Ok(list)
}

/// Any of the client's entries on no invoice, whatever its date.
pub async fn add_invoice_entry(db: &Db, id: i64, entry_id: i64) -> Result<Invoice> {
    let client_id = draft_client(db, id).await?;
    attach(&mut *db.acquire().await?, id, client_id, entry_id).await?;
    get_invoice(db, id).await
}

/// The entry goes back to uninvoiced.
pub async fn remove_invoice_entry(db: &Db, id: i64, entry_id: i64) -> Result<Invoice> {
    draft_client(db, id).await?;
    let removed =
        sqlx::query("UPDATE time_entries SET invoice_id = NULL WHERE id = ? AND invoice_id = ?")
            .bind(entry_id)
            .bind(id)
            .execute(db)
            .await?
            .rows_affected();
    if removed == 0 {
        return Err(invalid("entries", "That time entry isn't on this invoice"));
    }
    get_invoice(db, id).await
}

pub async fn set_invoice_timesheet(db: &Db, id: i64, timesheet: bool) -> Result<Invoice> {
    draft_client(db, id).await?;
    sqlx::query("UPDATE invoices SET timesheet = ? WHERE id = ?")
        .bind(timesheet)
        .bind(id)
        .execute(db)
        .await?;
    get_invoice(db, id).await
}

/// Frees its entries back to uninvoiced.
pub async fn delete_invoice(db: &Db, id: i64) -> Result<()> {
    draft_client(db, id).await?;
    let mut tx = db.begin().await?;
    sqlx::query("UPDATE time_entries SET invoice_id = NULL WHERE invoice_id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM invoices WHERE id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

/// The Draft's client; only a Draft's contents change.
async fn draft_client(db: &Db, id: i64) -> Result<i64> {
    let found: Option<(i64, State)> =
        sqlx::query_as("SELECT client_id, state FROM invoices WHERE id = ?")
            .bind(id)
            .fetch_optional(db)
            .await?;
    match found {
        Some((client_id, State::Draft)) => Ok(client_id),
        Some(_) => Err(invalid("state", "Only a Draft can change")),
        None => Err(not_found()),
    }
}

const NEWEST_FIRST: &str = "ORDER BY e.date DESC, e.started_at DESC, e.id DESC";

/// One line per project, by name, then General; each line has one rate.
fn lines(entries: &[TimeEntry]) -> Vec<Line> {
    let mut lines: Vec<Line> = Vec::new();
    for e in entries {
        match lines.iter_mut().find(|l| l.project_id == e.project_id) {
            Some(line) => line.seconds += e.seconds,
            None => lines.push(Line {
                project_id: e.project_id,
                description: e.project_name.clone().unwrap_or_else(|| "General".into()),
                seconds: e.seconds,
                rate_cents: e.rate_cents,
                amount_cents: 0,
            }),
        }
    }
    lines.sort_by_key(|l| {
        (
            l.project_id.is_none(),
            l.description.to_lowercase(),
            l.project_id,
        )
    });
    for line in &mut lines {
        line.amount_cents = amount(line.seconds, line.rate_cents);
    }
    lines
}

/// Puts one of the client's free entries on the invoice.
async fn attach(
    conn: &mut SqliteConnection,
    invoice_id: i64,
    client_id: i64,
    entry_id: i64,
) -> Result<()> {
    let attached = sqlx::query(
        "UPDATE time_entries SET invoice_id = ? WHERE id = ? AND client_id = ? AND invoice_id IS NULL",
    )
    .bind(invoice_id)
    .bind(entry_id)
    .bind(client_id)
    .execute(conn)
    .await?
    .rows_affected();
    if attached == 0 {
        return Err(invalid(
            "entries",
            "That time entry is already on an invoice or belongs to another client",
        ));
    }
    Ok(())
}

fn parse_day(text: &str) -> Result<NaiveDate> {
    text.parse().map_err(|_| CoreError::Database {
        message: format!("Bad invoice date: {text}"),
    })
}

fn not_found() -> CoreError {
    CoreError::NotFound {
        message: "Invoice not found".into(),
    }
}
