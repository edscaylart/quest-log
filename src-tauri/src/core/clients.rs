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

    Ok(Client {
        id,
        name: name.to_owned(),
        rate_cents,
    })
}

pub async fn list_clients(db: &Db) -> Result<Vec<Client>> {
    Ok(
        sqlx::query_as("SELECT id, name, rate_cents FROM clients ORDER BY name COLLATE NOCASE, id")
            .fetch_all(db)
            .await?,
    )
}

/// "$1,250.5" → 125050. Whole dollars, up to two decimals, never negative.
fn parse_rate(input: &str) -> Result<i64> {
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
