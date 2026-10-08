use serde::{Deserialize, Serialize};

use super::{Clock, CoreError, Db, Result};

#[derive(Debug, Deserialize)]
pub struct NewClient {
    pub name: String,
    /// Dollars as typed, e.g. "85" or "$1,250.50".
    pub rate: String,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Client {
    pub id: i64,
    pub name: String,
    pub rate_cents: i64,
    /// `None` bills under `name`.
    pub billing_name: Option<String>,
    pub address: Option<String>,
    pub email: Option<String>,
    /// Payment terms override; `None` uses the default.
    pub net_days: Option<i64>,
}

/// Every editable field of a client, as typed in the edit form.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientEdit {
    pub name: String,
    pub rate: String,
    pub billing_name: String,
    pub address: String,
    pub email: String,
    /// Whole days, or blank for the default.
    pub net_days: String,
}

/// What a rate change would do to uninvoiced time, for the confirm.
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Repricing {
    pub seconds: i64,
    pub old_cents: i64,
    pub new_cents: i64,
}

pub async fn create_client(db: &Db, clock: &dyn Clock, input: NewClient) -> Result<Client> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(invalid("name", "Name is required"));
    }
    let rate_cents = parse_rate(&input.rate)?;

    let id = sqlx::query("INSERT INTO clients (name, rate_cents, created_at) VALUES (?, ?, ?)")
        .bind(name)
        .bind(rate_cents)
        .bind(clock.now().timestamp())
        .execute(db)
        .await?
        .last_insert_rowid();

    get_client(db, id).await
}

const SELECT: &str =
    "SELECT id, name, rate_cents, billing_name, address, email, net_days FROM clients";

pub async fn list_clients(db: &Db) -> Result<Vec<Client>> {
    Ok(
        sqlx::query_as(&format!("{SELECT} ORDER BY name COLLATE NOCASE, id"))
            .fetch_all(db)
            .await?,
    )
}

pub async fn get_client(db: &Db, id: i64) -> Result<Client> {
    sqlx::query_as(&format!("{SELECT} WHERE id = ?"))
        .bind(id)
        .fetch_optional(db)
        .await?
        .ok_or_else(not_found)
}

/// A new rate reprices all of the client's uninvoiced time; see [`preview_client_rate`].
pub async fn update_client(db: &Db, id: i64, input: ClientEdit) -> Result<Client> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(invalid("name", "Name is required"));
    }
    let rate_cents = parse_rate(&input.rate)?;
    let email = blank_to_none(&input.email);
    if email.is_some_and(|e| !e.contains('@')) {
        return Err(invalid("email", "Email must look like name@example.com"));
    }
    let net_days = match blank_to_none(&input.net_days) {
        None => None,
        Some(text) => Some(
            text.parse::<i64>()
                .ok()
                .filter(|d| (0..=365).contains(d))
                .ok_or_else(|| {
                    invalid("netDays", "Net days must be a whole number from 0 to 365")
                })?,
        ),
    };

    let updated = sqlx::query(
        "UPDATE clients SET name = ?, rate_cents = ?, billing_name = ?, address = ?, email = ?, net_days = ? \
         WHERE id = ?",
    )
    .bind(name)
    .bind(rate_cents)
    .bind(blank_to_none(&input.billing_name))
    .bind(blank_to_none(&input.address))
    .bind(email)
    .bind(net_days)
    .bind(id)
    .execute(db)
    .await?
    .rows_affected();
    if updated == 0 {
        return Err(not_found());
    }
    get_client(db, id).await
}

/// What changing the client's rate to `rate` would do to its uninvoiced time
/// that follows the client rate (no project, or a project without its own).
// ponytail: every entry is uninvoiced until invoices exist.
pub async fn preview_client_rate(db: &Db, id: i64, rate: &str) -> Result<Repricing> {
    let new = parse_rate(rate)?;
    let client = get_client(db, id).await?;
    let seconds: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(e.seconds), 0) FROM time_entries e \
         LEFT JOIN projects p ON p.id = e.project_id \
         WHERE e.client_id = ? AND p.rate_cents IS NULL",
    )
    .bind(id)
    .fetch_one(db)
    .await?;
    Ok(repricing(seconds, client.rate_cents, new))
}

/// All affected time shares one old and one new rate, so each total rounds once.
pub(super) fn repricing(seconds: i64, old_rate: i64, new_rate: i64) -> Repricing {
    Repricing {
        seconds,
        old_cents: amount(seconds, old_rate),
        new_cents: amount(seconds, new_rate),
    }
}

/// Seconds × cents/hour, rounded half up to the cent.
pub(super) fn amount(seconds: i64, rate_cents: i64) -> i64 {
    (seconds * rate_cents + 1800) / 3600
}

fn blank_to_none(text: &str) -> Option<&str> {
    Some(text.trim()).filter(|t| !t.is_empty())
}

fn not_found() -> CoreError {
    CoreError::NotFound {
        message: "Client not found".into(),
    }
}

/// "$1,250.5" → 125050. Whole dollars, up to two decimals, never negative.
pub(super) fn parse_rate(input: &str) -> Result<i64> {
    let text: String = input.trim().trim_start_matches('$').replace(',', "");
    if text.is_empty() {
        return Err(invalid("rate", "Rate is required"));
    }
    let malformed = || {
        invalid(
            "rate",
            "Rate must be an amount like 85 or 85.50, at least 0",
        )
    };

    let (whole, frac) = text.split_once('.').unwrap_or((&text, ""));
    let all_digits = |s: &str| s.bytes().all(|b| b.is_ascii_digit());
    if !all_digits(whole) || !all_digits(frac) || frac.len() > 2 || whole.len() + frac.len() == 0 {
        return Err(malformed());
    }
    let dollars: i64 = if whole.is_empty() {
        0
    } else {
        whole.parse().map_err(|_| malformed())?
    };
    let cents: i64 = format!("{frac:0<2}").parse().unwrap();
    dollars
        .checked_mul(100)
        .and_then(|d| d.checked_add(cents))
        .ok_or_else(malformed)
}

fn invalid(field: &'static str, message: &str) -> CoreError {
    CoreError::Invalid {
        field,
        message: message.to_owned(),
    }
}
