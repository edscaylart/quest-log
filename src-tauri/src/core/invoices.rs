//! Invoices. A Draft is a working copy computed live from its time entries;
//! Sending freezes it into a snapshot, which Sent and Paid read from.

use chrono::{Days, NaiveDate};
use serde::{Deserialize, Serialize};
use sqlx::SqliteConnection;

use super::clients::{amount, invalid, parse_net_days};
use super::dashboard::{period, Period, PeriodInput, Preset};
use super::settings::get_settings;
use super::time_entries::{require_client, TimeEntry, SELECT as ENTRY_SELECT};
use super::{Clock, CoreError, Db, Result};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, sqlx::Type)]
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
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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
    /// Given at the first Send; kept on revert.
    pub number: Option<String>,
    /// Payment terms Send uses: `net_days_override`, else the client's, else Settings'.
    pub net_days: i64,
    pub net_days_override: Option<i64>,
    /// Sent and Paid only.
    pub issue_date: Option<NaiveDate>,
    pub due_date: Option<NaiveDate>,
    /// Paid only.
    pub paid_date: Option<NaiveDate>,
    /// Sent and today is past the due date.
    pub overdue: bool,
    /// Print the timesheet page.
    pub timesheet: bool,
    /// Projects by name, then General. From the snapshot once Sent.
    pub lines: Vec<Line>,
    pub seconds: i64,
    pub total_cents: i64,
    /// Its entries, newest first.
    pub entries: Vec<TimeEntry>,
    /// Draft only: the client's entries on no invoice, newest first, that could be added.
    pub available: Vec<TimeEntry>,
    /// How many of `available` fall in the period and were logged after it was created.
    pub new_in_period: i64,
    /// Sent and Paid only.
    pub snapshot: Option<Snapshot>,
}

/// Everything a Sent invoice shows, frozen at Send.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub number: String,
    pub issue_date: NaiveDate,
    pub due_date: NaiveDate,
    pub seller: Seller,
    pub client: BillTo,
    pub lines: Vec<Line>,
    /// Oldest first.
    pub timesheet: Vec<TimesheetRow>,
    pub seconds: i64,
    pub total_cents: i64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Seller {
    pub name: String,
    pub business_name: Option<String>,
    pub address: Option<String>,
    pub email: Option<String>,
    pub tax_id: Option<String>,
    pub payment_instructions: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BillTo {
    /// The billing name, else the client's name.
    pub name: String,
    pub address: Option<String>,
    pub email: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimesheetRow {
    pub date: String,
    /// The project, or "General".
    pub description: String,
    pub note: Option<String>,
    pub seconds: i64,
    /// Unix seconds; start–end entries only.
    pub started_at: Option<i64>,
    pub ended_at: Option<i64>,
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
    pub number: Option<String>,
    pub due_date: Option<NaiveDate>,
    pub overdue: bool,
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
    get_invoice(db, clock, id).await
}

pub async fn get_invoice(db: &Db, clock: &dyn Clock, id: i64) -> Result<Invoice> {
    let row: Row = sqlx::query_as(
        "SELECT i.client_id, c.name AS client_name, i.state, i.period_start, i.period_end, i.timesheet, \
         i.created_at, i.number, i.net_days AS net_days_override, \
         COALESCE(i.net_days, c.net_days, s.net_days) AS net_days, i.issue_date, i.due_date, \
         i.paid_date, i.snapshot \
         FROM invoices i JOIN clients c ON c.id = i.client_id, settings s WHERE i.id = ?",
    )
    .bind(id)
    .fetch_optional(db)
    .await?
    .ok_or_else(not_found)?;
    let period = Period {
        start: parse_day(&row.period_start)?,
        end: parse_day(&row.period_end)?,
    };
    let entries: Vec<TimeEntry> = sqlx::query_as(&format!(
        "{ENTRY_SELECT} WHERE e.invoice_id = ? {NEWEST_FIRST}"
    ))
    .bind(id)
    .fetch_all(db)
    .await?;
    let snapshot: Option<Snapshot> = row
        .snapshot
        .as_deref()
        .map(serde_json::from_str)
        .transpose()
        .map_err(|e| CoreError::Database {
            message: format!("Bad invoice snapshot: {e}"),
        })?;
    let due_date = row.due_date.as_deref().map(parse_day).transpose()?;

    let (lines, seconds, total_cents, available, new_in_period) = match &snapshot {
        Some(s) => (s.lines.clone(), s.seconds, s.total_cents, Vec::new(), 0),
        None => {
            let available: Vec<TimeEntry> = sqlx::query_as(&format!(
                "{ENTRY_SELECT} WHERE e.client_id = ? AND e.invoice_id IS NULL {NEWEST_FIRST}"
            ))
            .bind(row.client_id)
            .fetch_all(db)
            .await?;
            // Entries left out on purpose (unticked or removed) predate the Draft.
            let new_in_period: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM time_entries WHERE client_id = ? AND invoice_id IS NULL \
                 AND date BETWEEN ? AND ? AND created_at > ?",
            )
            .bind(row.client_id)
            .bind(&row.period_start)
            .bind(&row.period_end)
            .bind(row.created_at)
            .fetch_one(db)
            .await?;
            let lines = lines(&entries);
            let seconds = lines.iter().map(|l| l.seconds).sum();
            let total = lines.iter().map(|l| l.amount_cents).sum();
            (lines, seconds, total, available, new_in_period)
        }
    };
    Ok(Invoice {
        id,
        client_id: row.client_id,
        client_name: row.client_name,
        state: row.state,
        period,
        number: row.number,
        net_days: row.net_days,
        net_days_override: row.net_days_override,
        issue_date: row.issue_date.as_deref().map(parse_day).transpose()?,
        overdue: row.state == State::Sent && due_date.is_some_and(|d| clock.today() > d),
        due_date,
        paid_date: row.paid_date.as_deref().map(parse_day).transpose()?,
        timesheet: row.timesheet,
        lines,
        seconds,
        total_cents,
        entries,
        available,
        new_in_period,
        snapshot,
    })
}

#[derive(sqlx::FromRow)]
struct Row {
    client_id: i64,
    client_name: String,
    state: State,
    period_start: String,
    period_end: String,
    timesheet: bool,
    created_at: i64,
    number: Option<String>,
    net_days_override: Option<i64>,
    net_days: i64,
    issue_date: Option<String>,
    due_date: Option<String>,
    paid_date: Option<String>,
    snapshot: Option<String>,
}

/// Newest first.
// ponytail: one get_invoice per row; one grouped query if the list gets long.
pub async fn list_invoices(db: &Db, clock: &dyn Clock) -> Result<Vec<InvoiceSummary>> {
    let ids: Vec<i64> =
        sqlx::query_scalar("SELECT id FROM invoices ORDER BY created_at DESC, id DESC")
            .fetch_all(db)
            .await?;
    let mut list = Vec::with_capacity(ids.len());
    for id in ids {
        let i = get_invoice(db, clock, id).await?;
        list.push(InvoiceSummary {
            id,
            client_id: i.client_id,
            client_name: i.client_name,
            state: i.state,
            period: i.period,
            number: i.number,
            due_date: i.due_date,
            overdue: i.overdue,
            seconds: i.seconds,
            total_cents: i.total_cents,
        });
    }
    Ok(list)
}

/// Draft → Sent. Numbers it if it has no number yet, dates it today, freezes
/// its rates and details into the snapshot, and locks its entries.
pub async fn send_invoice(db: &Db, clock: &dyn Clock, id: i64) -> Result<Invoice> {
    let draft = get_invoice(db, clock, id).await?;
    require_state(draft.state, State::Draft)?;
    if draft.entries.is_empty() {
        return Err(invalid(
            "entries",
            "Add at least one time entry before sending",
        ));
    }
    let settings = get_settings(db).await?;
    if settings.name.is_empty() {
        return Err(invalid("name", "Set your name in Settings before sending"));
    }
    let (client_name, billing_name, address, email): (
        String,
        Option<String>,
        Option<String>,
        Option<String>,
    ) = sqlx::query_as("SELECT name, billing_name, address, email FROM clients WHERE id = ?")
        .bind(draft.client_id)
        .fetch_one(db)
        .await?;
    let timesheet = draft
        .entries
        .iter()
        .rev()
        .map(|e| TimesheetRow {
            date: e.date.clone(),
            description: e.project_name.clone().unwrap_or_else(|| "General".into()),
            note: e.note.clone(),
            seconds: e.seconds,
            started_at: e.started_at,
            ended_at: e.ended_at,
        })
        .collect();
    let issue = clock.today();
    let due = issue
        .checked_add_days(Days::new(draft.net_days.max(0) as u64))
        .ok_or_else(|| invalid("netDays", "That due date is out of range"))?;
    // ponytail: zero-padded to 4; a 5-digit number just grows wider.
    let numbered = draft.number.is_some();
    let number = match draft.number {
        Some(n) => n,
        None => format!(
            "{}{:04}",
            settings.invoice_prefix, settings.next_invoice_number
        ),
    };
    let snapshot = Snapshot {
        number: number.clone(),
        issue_date: issue,
        due_date: due,
        seller: Seller {
            name: settings.name,
            business_name: settings.business_name,
            address: settings.address,
            email: settings.email,
            tax_id: settings.tax_id,
            payment_instructions: settings.payment_instructions,
        },
        client: BillTo {
            name: billing_name.unwrap_or(client_name),
            address,
            email,
        },
        lines: draft.lines,
        timesheet,
        seconds: draft.seconds,
        total_cents: draft.total_cents,
    };
    let json = serde_json::to_string(&snapshot).map_err(|e| CoreError::Database {
        message: e.to_string(),
    })?;

    let mut tx = db.begin().await?;
    if !numbered {
        sqlx::query("UPDATE settings SET next_invoice_number = next_invoice_number + 1")
            .execute(&mut *tx)
            .await?;
    }
    sqlx::query(
        "UPDATE invoices SET state = 'sent', number = ?, issue_date = ?, due_date = ?, snapshot = ? \
         WHERE id = ?",
    )
    .bind(&number)
    .bind(issue.to_string())
    .bind(due.to_string())
    .bind(json)
    .bind(id)
    .execute(&mut *tx)
    .await?;
    // Each line has one rate; its entries keep it, so earnings match the snapshot.
    for line in &snapshot.lines {
        sqlx::query(
            "UPDATE time_entries SET invoiced_rate_cents = ? WHERE invoice_id = ? AND project_id IS ?",
        )
        .bind(line.rate_cents)
        .bind(id)
        .bind(line.project_id)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    get_invoice(db, clock, id).await
}

/// Sent → Draft. Keeps the number; drops the snapshot and dates; unlocks its entries.
pub async fn unseal_invoice(db: &Db, clock: &dyn Clock, id: i64) -> Result<Invoice> {
    require_state(state(db, id).await?, State::Sent)?;
    let mut tx = db.begin().await?;
    sqlx::query(
        "UPDATE invoices SET state = 'draft', issue_date = NULL, due_date = NULL, snapshot = NULL \
         WHERE id = ?",
    )
    .bind(id)
    .execute(&mut *tx)
    .await?;
    sqlx::query("UPDATE time_entries SET invoiced_rate_cents = NULL WHERE invoice_id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    get_invoice(db, clock, id).await
}

/// Sent → Paid, in full, on `paid_date` (YYYY-MM-DD).
pub async fn mark_paid(db: &Db, clock: &dyn Clock, id: i64, paid_date: &str) -> Result<Invoice> {
    require_state(state(db, id).await?, State::Sent)?;
    let paid: NaiveDate = paid_date
        .trim()
        .parse()
        .map_err(|_| invalid("paidDate", "Paid date must be a date like 2026-10-20"))?;
    sqlx::query("UPDATE invoices SET state = 'paid', paid_date = ? WHERE id = ?")
        .bind(paid.to_string())
        .bind(id)
        .execute(db)
        .await?;
    get_invoice(db, clock, id).await
}

/// Paid → Sent, to correct a mistake.
pub async fn unmark_paid(db: &Db, clock: &dyn Clock, id: i64) -> Result<Invoice> {
    require_state(state(db, id).await?, State::Paid)?;
    sqlx::query("UPDATE invoices SET state = 'sent', paid_date = NULL WHERE id = ?")
        .bind(id)
        .execute(db)
        .await?;
    get_invoice(db, clock, id).await
}

/// The Draft's payment terms as typed; blank goes back to the client's or Settings'.
pub async fn set_invoice_net_days(
    db: &Db,
    clock: &dyn Clock,
    id: i64,
    net_days: &str,
) -> Result<Invoice> {
    draft_client(db, id).await?;
    let net_days = parse_net_days(net_days)?;
    sqlx::query("UPDATE invoices SET net_days = ? WHERE id = ?")
        .bind(net_days)
        .bind(id)
        .execute(db)
        .await?;
    get_invoice(db, clock, id).await
}

/// Any of the client's entries on no invoice, whatever its date.
pub async fn add_invoice_entry(
    db: &Db,
    clock: &dyn Clock,
    id: i64,
    entry_id: i64,
) -> Result<Invoice> {
    let client_id = draft_client(db, id).await?;
    attach(&mut *db.acquire().await?, id, client_id, entry_id).await?;
    get_invoice(db, clock, id).await
}

/// The entry goes back to uninvoiced.
pub async fn remove_invoice_entry(
    db: &Db,
    clock: &dyn Clock,
    id: i64,
    entry_id: i64,
) -> Result<Invoice> {
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
    get_invoice(db, clock, id).await
}

pub async fn set_invoice_timesheet(
    db: &Db,
    clock: &dyn Clock,
    id: i64,
    timesheet: bool,
) -> Result<Invoice> {
    draft_client(db, id).await?;
    sqlx::query("UPDATE invoices SET timesheet = ? WHERE id = ?")
        .bind(timesheet)
        .bind(id)
        .execute(db)
        .await?;
    get_invoice(db, clock, id).await
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

async fn state(db: &Db, id: i64) -> Result<State> {
    sqlx::query_scalar("SELECT state FROM invoices WHERE id = ?")
        .bind(id)
        .fetch_optional(db)
        .await?
        .ok_or_else(not_found)
}

fn require_state(actual: State, wanted: State) -> Result<()> {
    if actual == wanted {
        return Ok(());
    }
    let message = match wanted {
        State::Draft => "Only a Draft can be sent",
        State::Sent => "Only a Sent invoice can do that",
        State::Paid => "Only a Paid invoice can go back to Sent",
    };
    Err(invalid("state", message))
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
