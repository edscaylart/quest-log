//! Every domain rule lives here. Functions take a [`Db`], a [`Clock`] where
//! time matters, and typed input; they return typed output or a [`CoreError`].

pub mod clients;
pub mod time_entries;

use std::path::Path;

use chrono::{DateTime, Local, NaiveDate, NaiveDateTime, TimeZone, Utc};
use serde::Serialize;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool};

pub type Db = SqlitePool;

/// Where "now" and the local time zone come from. Faked in tests.
pub trait Clock: Send + Sync {
    fn now(&self) -> DateTime<Utc>;
    /// The local calendar day at an instant.
    fn local_date(&self, at: DateTime<Utc>) -> NaiveDate;
    /// A local wall time as an instant; `None` if a clock change skips it.
    fn to_utc(&self, local: NaiveDateTime) -> Option<DateTime<Utc>>;

    fn today(&self) -> NaiveDate {
        self.local_date(self.now())
    }
}

pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> DateTime<Utc> {
        Utc::now()
    }

    fn local_date(&self, at: DateTime<Utc>) -> NaiveDate {
        at.with_timezone(&Local).date_naive()
    }

    fn to_utc(&self, local: NaiveDateTime) -> Option<DateTime<Utc>> {
        Local
            .from_local_datetime(&local)
            .earliest()
            .map(|t| t.to_utc())
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
    #[error("{message}")]
    NotFound { message: String },
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
