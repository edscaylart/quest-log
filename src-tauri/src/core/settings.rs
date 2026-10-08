//! The freelancer's invoice header and invoicing defaults: one row.

use serde::{Deserialize, Serialize};

use super::clients::{blank_to_none, invalid};
use super::{Db, Result};

#[derive(Debug, PartialEq, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    /// Blank until first saved; required after.
    pub name: String,
    pub business_name: Option<String>,
    pub address: Option<String>,
    pub email: Option<String>,
    pub tax_id: Option<String>,
    pub payment_instructions: Option<String>,
    /// Default payment terms, Net N.
    pub net_days: i64,
    pub invoice_prefix: String,
    pub next_invoice_number: i64,
}

/// Every field as typed in the form; blank clears an optional one.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsEdit {
    pub name: String,
    pub business_name: String,
    pub address: String,
    pub email: String,
    pub tax_id: String,
    pub payment_instructions: String,
    pub net_days: String,
    pub invoice_prefix: String,
    pub next_invoice_number: String,
}

pub async fn get_settings(db: &Db) -> Result<Settings> {
    Ok(sqlx::query_as(
        "SELECT name, business_name, address, email, tax_id, payment_instructions, \
         net_days, invoice_prefix, next_invoice_number FROM settings",
    )
    .fetch_one(db)
    .await?)
}

pub async fn update_settings(db: &Db, input: SettingsEdit) -> Result<Settings> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(invalid("name", "Name is required"));
    }
    let email = blank_to_none(&input.email);
    if email.is_some_and(|e| !e.contains('@')) {
        return Err(invalid("email", "Email must look like name@example.com"));
    }
    let net_days = positive(&input.net_days)
        .ok_or_else(|| invalid("netDays", "Net days must be a whole number, at least 1"))?;
    let next_number = positive(&input.next_invoice_number).ok_or_else(|| {
        invalid(
            "nextInvoiceNumber",
            "Next invoice number must be a whole number, at least 1",
        )
    })?;

    sqlx::query(
        "UPDATE settings SET name = ?, business_name = ?, address = ?, email = ?, tax_id = ?, \
         payment_instructions = ?, net_days = ?, invoice_prefix = ?, next_invoice_number = ?",
    )
    .bind(name)
    .bind(blank_to_none(&input.business_name))
    .bind(blank_to_none(&input.address))
    .bind(email)
    .bind(blank_to_none(&input.tax_id))
    .bind(blank_to_none(&input.payment_instructions))
    .bind(net_days)
    .bind(input.invoice_prefix.trim())
    .bind(next_number)
    .execute(db)
    .await?;
    get_settings(db).await
}

fn positive(text: &str) -> Option<i64> {
    text.trim().parse().ok().filter(|n| *n > 0)
}
