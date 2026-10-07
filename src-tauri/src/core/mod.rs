//! Every domain rule lives here. Functions take a [`Db`], a [`Clock`] where
//! time matters, and typed input; they return typed output or a [`CoreError`].

pub mod clients;

use std::path::Path;

use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool};

pub type Db = SqlitePool;

/// Where "now" comes from. Faked in tests.
// ponytail: local time zone joins this trait with the first rule that needs local dates.
pub trait Clock: Send + Sync {
    fn now(&self) -> DateTime<Utc>;
}

pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> DateTime<Utc> {
        Utc::now()
    }
}

#[derive(Debug, thiserror::Error, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CoreError {
    #[error("{field}: {message}")]
    Invalid {
        field: &'static str,
        message: String,
    },
    #[error("database error: {message}")]
    Database { message: String },
}

impl From<sqlx::Error> for CoreError {
    fn from(e: sqlx::Error) -> Self {
        Self::Database {
            message: e.to_string(),
        }
    }
}

impl From<sqlx::migrate::MigrateError> for CoreError {
    fn from(e: sqlx::migrate::MigrateError) -> Self {
        Self::Database {
            message: e.to_string(),
        }
    }
}

pub type Result<T> = std::result::Result<T, CoreError>;

/// Open (creating if needed) the database file and apply pending migrations.
pub async fn open(path: &Path) -> Result<Db> {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true);
    let db = SqlitePool::connect_with(options).await?;
    sqlx::migrate!().run(&db).await?;
    Ok(db)
}
