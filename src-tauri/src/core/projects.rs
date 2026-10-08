use serde::{Deserialize, Serialize};

use super::clients::{get_client, parse_rate, repricing, Repricing};
use super::time_entries::invalid;
use super::{Clock, CoreError, Db, Result};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInput {
    pub name: String,
    /// Dollars as typed, or blank to use the client's rate.
    pub rate: String,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: i64,
    pub client_id: i64,
    pub name: String,
    /// `None` uses the client's rate.
    pub rate_cents: Option<i64>,
    /// What its time bills at: `rate_cents` if set, else the client's rate.
    pub effective_rate_cents: i64,
    pub complete: bool,
}

pub async fn create_project(
    db: &Db,
    clock: &dyn Clock,
    client_id: i64,
    input: ProjectInput,
) -> Result<Project> {
    get_client(db, client_id).await?;
    let (name, rate_cents) = validate(&input)?;
    let id = sqlx::query(
        "INSERT INTO projects (client_id, name, rate_cents, created_at) VALUES (?, ?, ?, ?)",
    )
    .bind(client_id)
    .bind(name)
    .bind(rate_cents)
    .bind(clock.now().timestamp())
    .execute(db)
    .await?
    .last_insert_rowid();
    get_project(db, id).await
}

/// A new rate reprices the project's uninvoiced time; see [`preview_project_rate`].
pub async fn update_project(db: &Db, id: i64, input: ProjectInput) -> Result<Project> {
    let (name, rate_cents) = validate(&input)?;
    let updated = sqlx::query("UPDATE projects SET name = ?, rate_cents = ? WHERE id = ?")
        .bind(name)
        .bind(rate_cents)
        .bind(id)
        .execute(db)
        .await?
        .rows_affected();
    if updated == 0 {
        return Err(not_found());
    }
    get_project(db, id).await
}

/// Complete projects leave the pickers; their entries and history stay.
pub async fn set_project_complete(db: &Db, id: i64, complete: bool) -> Result<Project> {
    let updated = sqlx::query("UPDATE projects SET complete = ? WHERE id = ?")
        .bind(complete)
        .bind(id)
        .execute(db)
        .await?
        .rows_affected();
    if updated == 0 {
        return Err(not_found());
    }
    get_project(db, id).await
}

/// Only a project with no time entries can go; otherwise mark it complete.
// ponytail: stricter than the spec's "none invoiced" so no entry is ever lost;
// relax to deleting uninvoiced entries (with a counted confirm) if it's missed.
pub async fn delete_project(db: &Db, id: i64) -> Result<()> {
    let in_use: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM time_entries WHERE project_id = ?1) \
         OR EXISTS (SELECT 1 FROM timer WHERE project_id = ?1)",
    )
    .bind(id)
    .fetch_one(db)
    .await?;
    if in_use {
        return Err(invalid(
            "project",
            "This project has time logged; mark it complete instead",
        ));
    }
    let deleted = sqlx::query("DELETE FROM projects WHERE id = ?")
        .bind(id)
        .execute(db)
        .await?
        .rows_affected();
    if deleted == 0 {
        return Err(not_found());
    }
    Ok(())
}

/// A client's projects, active first, then by name.
pub async fn list_projects(db: &Db, client_id: i64) -> Result<Vec<Project>> {
    Ok(sqlx::query_as(&format!(
        "{SELECT} WHERE p.client_id = ? ORDER BY p.complete, p.name COLLATE NOCASE, p.id"
    ))
    .bind(client_id)
    .fetch_all(db)
    .await?)
}

pub async fn get_project(db: &Db, id: i64) -> Result<Project> {
    sqlx::query_as(&format!("{SELECT} WHERE p.id = ?"))
        .bind(id)
        .fetch_optional(db)
        .await?
        .ok_or_else(not_found)
}

/// What changing the project's rate to `rate` (blank: the client's) would do
/// to its uninvoiced time.
// ponytail: every entry is uninvoiced until invoices exist.
pub async fn preview_project_rate(db: &Db, id: i64, rate: &str) -> Result<Repricing> {
    let new = parse_project_rate(rate)?;
    let project = get_project(db, id).await?;
    let client_rate = get_client(db, project.client_id).await?.rate_cents;
    let seconds: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(seconds), 0) FROM time_entries WHERE project_id = ?",
    )
    .bind(id)
    .fetch_one(db)
    .await?;
    Ok(repricing(
        seconds,
        project.rate_cents.unwrap_or(client_rate),
        new.unwrap_or(client_rate),
    ))
}

const SELECT: &str = "SELECT p.id, p.client_id, p.name, p.rate_cents, \
    COALESCE(p.rate_cents, c.rate_cents) AS effective_rate_cents, p.complete \
    FROM projects p JOIN clients c ON c.id = p.client_id";

fn validate(input: &ProjectInput) -> Result<(&str, Option<i64>)> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(invalid("name", "Name is required"));
    }
    Ok((name, parse_project_rate(&input.rate)?))
}

fn parse_project_rate(rate: &str) -> Result<Option<i64>> {
    if rate.trim().is_empty() {
        return Ok(None);
    }
    parse_rate(rate).map(Some)
}

fn not_found() -> CoreError {
    CoreError::NotFound {
        message: "Project not found".into(),
    }
}
