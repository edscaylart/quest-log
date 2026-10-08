pub mod core;

use tauri::{Manager, State};

use crate::core::clients::{self, Client, NewClient};
use crate::core::time_entries::{self, EntryInput, TimeEntry};
use crate::core::{CoreError, Db, SystemClock};

// Thin wrappers: one command per core function, no logic.

#[tauri::command]
async fn create_client(db: State<'_, Db>, input: NewClient) -> Result<Client, CoreError> {
    clients::create_client(&db, &SystemClock, input).await
}

#[tauri::command]
async fn list_clients(db: State<'_, Db>) -> Result<Vec<Client>, CoreError> {
    clients::list_clients(&db).await
}

#[tauri::command]
async fn create_time_entry(db: State<'_, Db>, input: EntryInput) -> Result<TimeEntry, CoreError> {
    time_entries::create_entry(&db, &SystemClock, input).await
}

#[tauri::command]
async fn update_time_entry(
    db: State<'_, Db>,
    id: i64,
    input: EntryInput,
) -> Result<TimeEntry, CoreError> {
    time_entries::update_entry(&db, &SystemClock, id, input).await
}

#[tauri::command]
async fn delete_time_entry(db: State<'_, Db>, id: i64) -> Result<(), CoreError> {
    time_entries::delete_entry(&db, id).await
}

#[tauri::command]
async fn list_time_entries(
    db: State<'_, Db>,
    client_id: Option<i64>,
) -> Result<Vec<TimeEntry>, CoreError> {
    time_entries::list_entries(&db, client_id).await
}

#[tauri::command]
async fn last_used_client(db: State<'_, Db>) -> Result<Option<i64>, CoreError> {
    time_entries::last_used_client(&db).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let db = tauri::async_runtime::block_on(core::open(&dir.join("quest-log.db")))?;
            app.manage(db);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_client,
            list_clients,
            create_time_entry,
            update_time_entry,
            delete_time_entry,
            list_time_entries,
            last_used_client
        ])
        .run(tauri::generate_context!())
        .expect("error while running Quest Log");
}
