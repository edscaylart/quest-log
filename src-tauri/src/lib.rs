pub mod core;

use tauri::{Manager, State};

use crate::core::clients::{self, Client, NewClient};
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
        .invoke_handler(tauri::generate_handler![create_client, list_clients])
        .run(tauri::generate_context!())
        .expect("error while running Quest Log");
}
