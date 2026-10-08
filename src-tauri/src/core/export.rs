//! Time entries as CSV, for analysis outside the app.

use chrono::DateTime;

use super::clients::amount;
use super::dashboard::{period, PeriodInput};
use super::invoices::State;
use super::{Clock, Db, Result};

const HEADER: &str =
    "Date,Start,End,Seconds,Hours,Client,Project,Note,Rate,Amount,Invoice number,Invoice state";

/// The period's time entries, oldest first, optionally for one client. The
/// running Timer isn't a time entry yet, so it's left out. Rate is frozen if
/// the entry is on a Sent or Paid invoice, else live; amount is rounded per
/// row, so a sum can differ from invoice line totals by a few cents.
pub async fn export_csv(
    db: &Db,
    clock: &dyn Clock,
    input: &PeriodInput,
    client_id: Option<i64>,
) -> Result<String> {
    let period = period(input, clock.today())?;
    let rows: Vec<Row> = sqlx::query_as(
        "SELECT e.date, e.started_at, e.ended_at, e.seconds, c.name AS client, p.name AS project, e.note, \
         COALESCE(e.invoiced_rate_cents, p.rate_cents, c.rate_cents) AS rate_cents, i.number, i.state \
         FROM time_entries e JOIN clients c ON c.id = e.client_id \
         LEFT JOIN projects p ON p.id = e.project_id LEFT JOIN invoices i ON i.id = e.invoice_id \
         WHERE e.date BETWEEN ? AND ? AND (? IS NULL OR e.client_id = ?) \
         ORDER BY e.date, e.started_at, e.id",
    )
    .bind(period.start.to_string())
    .bind(period.end.to_string())
    .bind(client_id)
    .bind(client_id)
    .fetch_all(db)
    .await?;

    let time = |unix: Option<i64>| {
        unix.and_then(|s| DateTime::from_timestamp(s, 0))
            .map(|at| clock.local(at).format("%H:%M").to_string())
            .unwrap_or_default()
    };
    let mut csv = format!("{HEADER}\n");
    for r in rows {
        let state = match r.state {
            None => "",
            Some(State::Draft) => "Draft",
            Some(State::Sent) => "Sent",
            Some(State::Paid) => "Paid",
        };
        let fields = [
            r.date,
            time(r.started_at),
            time(r.ended_at),
            r.seconds.to_string(),
            format!("{:.2}", r.seconds as f64 / 3600.0),
            r.client,
            r.project.unwrap_or_default(),
            r.note.unwrap_or_default(),
            dollars(r.rate_cents),
            dollars(amount(r.seconds, r.rate_cents)),
            r.number.unwrap_or_default(),
            state.into(),
        ];
        let fields: Vec<String> = fields.iter().map(|f| csv_field(f)).collect();
        csv += &fields.join(",");
        csv.push('\n');
    }
    Ok(csv)
}

#[derive(sqlx::FromRow)]
struct Row {
    date: String,
    started_at: Option<i64>,
    ended_at: Option<i64>,
    seconds: i64,
    client: String,
    project: Option<String>,
    note: Option<String>,
    /// Frozen if on a Sent or Paid invoice, else live.
    rate_cents: i64,
    number: Option<String>,
    state: Option<State>,
}

fn dollars(cents: i64) -> String {
    format!("{}.{:02}", cents / 100, cents % 100)
}

/// RFC 4180: quoted, with quotes doubled, when it holds a comma, quote or line break.
fn csv_field(text: &str) -> String {
    if text.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", text.replace('"', "\"\""))
    } else {
        text.into()
    }
}
