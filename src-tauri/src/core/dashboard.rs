//! Hours and earnings over a period, for Home.

use std::collections::BTreeMap;

use chrono::{DateTime, Datelike, Days, Months, NaiveDate};
use serde::{Deserialize, Serialize};

use super::clients::amount;
use super::invoices::State;
use super::time_entries::invalid;
use super::{Clock, CoreError, Db, Result};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum Preset {
    #[serde(rename = "1w")]
    OneWeek,
    #[serde(rename = "2w")]
    TwoWeeks,
    #[serde(rename = "3w")]
    ThreeWeeks,
    #[serde(rename = "month")]
    Month,
    #[serde(rename = "custom")]
    Custom,
}

/// A preset's current period, stepped `offset` period lengths away.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeriodInput {
    pub preset: Preset,
    pub offset: i64,
    /// Custom only: local days, YYYY-MM-DD.
    pub start: Option<String>,
    pub end: Option<String>,
}

/// Calendar days, both ends included.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Period {
    pub start: NaiveDate,
    pub end: NaiveDate,
}

impl Period {
    pub fn days(&self) -> i64 {
        (self.end - self.start).num_days() + 1
    }
}

/// Weeks start Monday; 2W and 3W end with this week; M is the calendar month.
pub fn period(input: &PeriodInput, today: NaiveDate) -> Result<Period> {
    let monday = monday(today);
    let weeks = |n: i64| {
        let start = monday - Days::new(7 * (n as u64 - 1));
        shift(
            start,
            monday + Days::new(6),
            input.offset.checked_mul(7 * n),
        )
    };
    match input.preset {
        Preset::OneWeek => weeks(1),
        Preset::TwoWeeks => weeks(2),
        Preset::ThreeWeeks => weeks(3),
        Preset::Month => {
            let first = today.with_day(1).unwrap();
            let months = u32::try_from(input.offset.unsigned_abs())
                .ok()
                .map(Months::new);
            let start = months.and_then(|m| {
                if input.offset < 0 {
                    first.checked_sub_months(m)
                } else {
                    first.checked_add_months(m)
                }
            });
            let end = start.and_then(|s| s.checked_add_months(Months::new(1))?.pred_opt());
            match (start, end) {
                (Some(start), Some(end)) => Ok(Period { start, end }),
                _ => Err(out_of_range()),
            }
        }
        Preset::Custom => {
            let start = parse_day("start", input.start.as_deref())?;
            let end = parse_day("end", input.end.as_deref())?;
            if end < start {
                return Err(invalid("end", "End can't be before start"));
            }
            let days = (end - start).num_days() + 1;
            shift(start, end, input.offset.checked_mul(days))
        }
    }
}

/// Moves both ends by `days`; `None` (an overflowed offset) is out of range.
fn shift(start: NaiveDate, end: NaiveDate, days: Option<i64>) -> Result<Period> {
    let by = days.and_then(chrono::Duration::try_days);
    let moved = |d: NaiveDate| by.and_then(|by| d.checked_add_signed(by));
    match (moved(start), moved(end)) {
        (Some(start), Some(end)) => Ok(Period { start, end }),
        _ => Err(out_of_range()),
    }
}

fn out_of_range() -> CoreError {
    invalid("offset", "That period is out of range")
}

fn parse_day(field: &'static str, text: Option<&str>) -> Result<NaiveDate> {
    NaiveDate::parse_from_str(text.unwrap_or("").trim(), "%Y-%m-%d")
        .map_err(|_| invalid(field, "Date is required"))
}

/// Hours and earnings. Uninvoiced + invoiced-unpaid + paid always equals earned.
#[derive(Debug, Default, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Figures {
    pub seconds: i64,
    pub earned_cents: i64,
    /// Uninvoiced.
    pub uninvoiced_cents: i64,
    /// Invoiced-unpaid.
    pub invoiced_unpaid_cents: i64,
    /// Paid.
    pub paid_cents: i64,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientFigures {
    pub client_id: i64,
    pub client_name: String,
    #[serde(flatten)]
    pub figures: Figures,
}

/// Hours from `start` up to the next bucket's start.
#[derive(Debug, PartialEq, Serialize)]
pub struct Bucket {
    pub start: NaiveDate,
    pub seconds: i64,
}

/// Not tied to the period.
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AllTime {
    pub invoiced_unpaid_cents: i64,
    /// Sent invoices past their due date.
    pub overdue: i64,
    pub uninvoiced_cents: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Dashboard {
    pub period: Period,
    pub total: Figures,
    /// Clients with time in the period, most hours first.
    pub clients: Vec<ClientFigures>,
    /// One per day, or per Monday week (the first may start mid-week) when `weekly`.
    pub buckets: Vec<Bucket>,
    /// Set when the period is over six weeks.
    pub weekly: bool,
    pub all_time: AllTime,
}

/// Longest period charted by day.
const DAILY_MAX_DAYS: i64 = 42;

/// Time entries count by their date; a running Timer counts live on its start day.
pub async fn dashboard(db: &Db, clock: &dyn Clock, input: &PeriodInput) -> Result<Dashboard> {
    let period = period(input, clock.today())?;
    // ponytail: every row is loaded and summed here; aggregate in SQL if it gets slow.
    let rows = rows(db, clock).await?;

    let weekly = period.days() > DAILY_MAX_DAYS;
    let bucket_of = |date: NaiveDate| {
        if weekly {
            monday(date).max(period.start)
        } else {
            date
        }
    };
    let mut buckets = BTreeMap::new();
    let mut day = period.start;
    while day <= period.end {
        buckets.insert(day, 0);
        day = if weekly {
            monday(day) + Days::new(7)
        } else {
            day + Days::new(1)
        };
    }

    // Per client: name, seconds, Σ seconds × rate per billing status (each rounded once at the end).
    let mut in_period: BTreeMap<i64, (String, i64, Split)> = BTreeMap::new();
    let mut all_time = Split::default();
    for row in rows {
        all_time.add(row.state, row.seconds * row.rate_cents);
        if row.date < period.start || row.date > period.end {
            continue;
        }
        *buckets.get_mut(&bucket_of(row.date)).unwrap() += row.seconds;
        let client =
            in_period
                .entry(row.client_id)
                .or_insert((row.client_name, 0, Split::default()));
        client.1 += row.seconds;
        client.2.add(row.state, row.seconds * row.rate_cents);
    }

    let mut clients: Vec<ClientFigures> = in_period
        .into_iter()
        .map(|(client_id, (client_name, seconds, split))| ClientFigures {
            client_id,
            client_name,
            figures: split.figures(seconds),
        })
        .collect();
    clients.sort_by_key(|c| std::cmp::Reverse(c.figures.seconds));
    let total = clients.iter().fold(Figures::default(), |t, c| Figures {
        seconds: t.seconds + c.figures.seconds,
        earned_cents: t.earned_cents + c.figures.earned_cents,
        uninvoiced_cents: t.uninvoiced_cents + c.figures.uninvoiced_cents,
        invoiced_unpaid_cents: t.invoiced_unpaid_cents + c.figures.invoiced_unpaid_cents,
        paid_cents: t.paid_cents + c.figures.paid_cents,
    });
    let overdue: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM invoices WHERE state = 'sent' AND due_date < ?")
            .bind(clock.today().to_string())
            .fetch_one(db)
            .await?;
    let all_time = all_time.figures(0);

    Ok(Dashboard {
        period,
        total,
        clients,
        buckets: buckets
            .into_iter()
            .map(|(start, seconds)| Bucket { start, seconds })
            .collect(),
        weekly,
        all_time: AllTime {
            invoiced_unpaid_cents: all_time.invoiced_unpaid_cents,
            overdue,
            uninvoiced_cents: all_time.uninvoiced_cents,
        },
    })
}

/// Cent-seconds (seconds × cents/hour) by billing status.
#[derive(Default)]
struct Split {
    uninvoiced: i64,
    invoiced_unpaid: i64,
    paid: i64,
}

impl Split {
    fn add(&mut self, state: Option<State>, cent_seconds: i64) {
        match state {
            None | Some(State::Draft) => self.uninvoiced += cent_seconds,
            Some(State::Sent) => self.invoiced_unpaid += cent_seconds,
            Some(State::Paid) => self.paid += cent_seconds,
        }
    }

    /// Earned is the sum of the rounded parts, so they always add up.
    fn figures(&self, seconds: i64) -> Figures {
        let [uninvoiced, invoiced_unpaid, paid] =
            [self.uninvoiced, self.invoiced_unpaid, self.paid].map(|cs| amount(1, cs));
        Figures {
            seconds,
            earned_cents: uninvoiced + invoiced_unpaid + paid,
            uninvoiced_cents: uninvoiced,
            invoiced_unpaid_cents: invoiced_unpaid,
            paid_cents: paid,
        }
    }
}

fn monday(date: NaiveDate) -> NaiveDate {
    date - Days::new(date.weekday().num_days_from_monday().into())
}

struct Row {
    client_id: i64,
    client_name: String,
    date: NaiveDate,
    seconds: i64,
    /// Frozen at Send if invoiced, else live: the project's if set, else the client's.
    rate_cents: i64,
    /// Its invoice's, if any.
    state: Option<State>,
}

/// Every time entry, plus the running Timer as one so far.
async fn rows(db: &Db, clock: &dyn Clock) -> Result<Vec<Row>> {
    let entries: Vec<(i64, String, String, i64, i64, Option<State>)> = sqlx::query_as(
        "SELECT e.client_id, c.name, e.date, e.seconds, \
         COALESCE(e.invoiced_rate_cents, p.rate_cents, c.rate_cents), i.state FROM time_entries e \
         JOIN clients c ON c.id = e.client_id LEFT JOIN projects p ON p.id = e.project_id \
         LEFT JOIN invoices i ON i.id = e.invoice_id",
    )
    .fetch_all(db)
    .await?;
    let mut rows = Vec::with_capacity(entries.len() + 1);
    for (client_id, client_name, date, seconds, rate_cents, state) in entries {
        rows.push(Row {
            client_id,
            client_name,
            date: date.parse().map_err(|_| CoreError::Database {
                message: format!("Bad time entry date: {date}"),
            })?,
            seconds,
            rate_cents,
            state,
        });
    }
    let timer: Option<(i64, String, i64, i64)> = sqlx::query_as(
        "SELECT t.client_id, c.name, t.started_at, COALESCE(p.rate_cents, c.rate_cents) \
         FROM timer t JOIN clients c ON c.id = t.client_id LEFT JOIN projects p ON p.id = t.project_id",
    )
    .fetch_optional(db)
    .await?;
    if let Some((client_id, client_name, started_ms, rate_cents)) = timer {
        let now = clock.now();
        let start = DateTime::from_timestamp_millis(started_ms).unwrap_or(now);
        rows.push(Row {
            client_id,
            client_name,
            date: clock.local_date(start),
            seconds: (now - start).num_seconds().max(0),
            rate_cents,
            state: None,
        });
    }
    Ok(rows)
}
