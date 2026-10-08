pub mod core;
mod tray;

use tauri::{Manager, State};

use crate::core::clients::{self, Client, ClientEdit, NewClient, Repricing};
use crate::core::dashboard::{self, Dashboard, PeriodInput};
use crate::core::invoices::{self, DraftCandidates, Invoice, InvoiceSummary, NewDraft};
use crate::core::progress::{self, Progress};
use crate::core::projects::{self, Project, ProjectInput};
use crate::core::settings::{self, Settings, SettingsEdit};
use crate::core::time_entries::{self, EntryInput, LastUsed, TimeEntry};
use crate::core::timer::{self, Stopped, Timer, TimerEdit, TimerStart};
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
async fn get_client(db: State<'_, Db>, id: i64) -> Result<Client, CoreError> {
    clients::get_client(&db, id).await
}

#[tauri::command]
async fn update_client(db: State<'_, Db>, id: i64, input: ClientEdit) -> Result<Client, CoreError> {
    clients::update_client(&db, id, input).await
}

#[tauri::command]
async fn preview_client_rate(
    db: State<'_, Db>,
    id: i64,
    rate: String,
) -> Result<Repricing, CoreError> {
    clients::preview_client_rate(&db, id, &rate).await
}

#[tauri::command]
async fn create_project(
    db: State<'_, Db>,
    client_id: i64,
    input: ProjectInput,
) -> Result<Project, CoreError> {
    projects::create_project(&db, &SystemClock, client_id, input).await
}

#[tauri::command]
async fn update_project(
    db: State<'_, Db>,
    id: i64,
    input: ProjectInput,
) -> Result<Project, CoreError> {
    projects::update_project(&db, id, input).await
}

#[tauri::command]
async fn set_project_complete(
    db: State<'_, Db>,
    id: i64,
    complete: bool,
) -> Result<Project, CoreError> {
    projects::set_project_complete(&db, id, complete).await
}

#[tauri::command]
async fn delete_project(db: State<'_, Db>, id: i64) -> Result<(), CoreError> {
    projects::delete_project(&db, id).await
}

#[tauri::command]
async fn list_projects(db: State<'_, Db>, client_id: i64) -> Result<Vec<Project>, CoreError> {
    projects::list_projects(&db, client_id).await
}

#[tauri::command]
async fn get_project(db: State<'_, Db>, id: i64) -> Result<Project, CoreError> {
    projects::get_project(&db, id).await
}

#[tauri::command]
async fn preview_project_rate(
    db: State<'_, Db>,
    id: i64,
    rate: String,
) -> Result<Repricing, CoreError> {
    projects::preview_project_rate(&db, id, &rate).await
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
async fn last_used(db: State<'_, Db>) -> Result<Option<LastUsed>, CoreError> {
    time_entries::last_used(&db).await
}

#[tauri::command]
async fn get_timer(db: State<'_, Db>) -> Result<Option<Timer>, CoreError> {
    timer::get_timer(&db).await
}

#[tauri::command]
async fn start_timer(db: State<'_, Db>, input: TimerStart) -> Result<Option<Stopped>, CoreError> {
    timer::start_timer(&db, &SystemClock, input).await
}

#[tauri::command]
async fn stop_timer(db: State<'_, Db>) -> Result<Stopped, CoreError> {
    timer::stop_timer(&db, &SystemClock).await
}

#[tauri::command]
async fn update_timer(db: State<'_, Db>, input: TimerEdit) -> Result<Timer, CoreError> {
    timer::update_timer(&db, &SystemClock, input).await
}

#[tauri::command]
async fn finish_timer(db: State<'_, Db>, input: EntryInput) -> Result<TimeEntry, CoreError> {
    timer::finish_timer(&db, &SystemClock, input).await
}

#[tauri::command]
async fn discard_timer(db: State<'_, Db>) -> Result<(), CoreError> {
    timer::discard_timer(&db).await
}

#[tauri::command]
async fn dashboard(db: State<'_, Db>, input: PeriodInput) -> Result<Dashboard, CoreError> {
    dashboard::dashboard(&db, &SystemClock, &input).await
}

#[tauri::command]
async fn progress(db: State<'_, Db>) -> Result<Progress, CoreError> {
    progress::progress(&db).await
}

#[tauri::command]
async fn acknowledge_level_up(db: State<'_, Db>, level: i64) -> Result<(), CoreError> {
    progress::acknowledge_level_up(&db, level).await
}

#[tauri::command]
async fn get_settings(db: State<'_, Db>) -> Result<Settings, CoreError> {
    settings::get_settings(&db).await
}

#[tauri::command]
async fn update_settings(db: State<'_, Db>, input: SettingsEdit) -> Result<Settings, CoreError> {
    settings::update_settings(&db, input).await
}

#[tauri::command]
async fn draft_candidates(
    db: State<'_, Db>,
    client_id: i64,
    period: Option<PeriodInput>,
) -> Result<DraftCandidates, CoreError> {
    invoices::draft_candidates(&db, &SystemClock, client_id, period.as_ref()).await
}

#[tauri::command]
async fn create_draft(db: State<'_, Db>, input: NewDraft) -> Result<Invoice, CoreError> {
    invoices::create_draft(&db, &SystemClock, input).await
}

#[tauri::command]
async fn list_invoices(db: State<'_, Db>) -> Result<Vec<InvoiceSummary>, CoreError> {
    invoices::list_invoices(&db, &SystemClock).await
}

#[tauri::command]
async fn get_invoice(db: State<'_, Db>, id: i64) -> Result<Invoice, CoreError> {
    invoices::get_invoice(&db, &SystemClock, id).await
}

#[tauri::command]
async fn add_invoice_entry(
    db: State<'_, Db>,
    id: i64,
    entry_id: i64,
) -> Result<Invoice, CoreError> {
    invoices::add_invoice_entry(&db, &SystemClock, id, entry_id).await
}

#[tauri::command]
async fn remove_invoice_entry(
    db: State<'_, Db>,
    id: i64,
    entry_id: i64,
) -> Result<Invoice, CoreError> {
    invoices::remove_invoice_entry(&db, &SystemClock, id, entry_id).await
}

#[tauri::command]
async fn set_invoice_timesheet(
    db: State<'_, Db>,
    id: i64,
    timesheet: bool,
) -> Result<Invoice, CoreError> {
    invoices::set_invoice_timesheet(&db, &SystemClock, id, timesheet).await
}

#[tauri::command]
async fn set_invoice_net_days(
    db: State<'_, Db>,
    id: i64,
    net_days: String,
) -> Result<Invoice, CoreError> {
    invoices::set_invoice_net_days(&db, &SystemClock, id, &net_days).await
}

#[tauri::command]
async fn send_invoice(db: State<'_, Db>, id: i64) -> Result<Invoice, CoreError> {
    invoices::send_invoice(&db, &SystemClock, id).await
}

#[tauri::command]
async fn unseal_invoice(db: State<'_, Db>, id: i64) -> Result<Invoice, CoreError> {
    invoices::unseal_invoice(&db, &SystemClock, id).await
}

#[tauri::command]
async fn mark_paid(db: State<'_, Db>, id: i64, paid_date: String) -> Result<Invoice, CoreError> {
    invoices::mark_paid(&db, &SystemClock, id, &paid_date).await
}

#[tauri::command]
async fn unmark_paid(db: State<'_, Db>, id: i64) -> Result<Invoice, CoreError> {
    invoices::unmark_paid(&db, &SystemClock, id).await
}

#[tauri::command]
async fn delete_invoice(db: State<'_, Db>, id: i64) -> Result<(), CoreError> {
    invoices::delete_invoice(&db, id).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let db = tauri::async_runtime::block_on(core::open(&dir.join("quest-log.db")))?;
            app.manage(db);
            tray::setup(app.handle())?;
            Ok(())
        })
        // Closing hides the window; the app and Timer keep running until ⌘Q or tray Quit.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            create_client,
            list_clients,
            get_client,
            update_client,
            preview_client_rate,
            create_project,
            update_project,
            set_project_complete,
            delete_project,
            list_projects,
            get_project,
            preview_project_rate,
            create_time_entry,
            update_time_entry,
            delete_time_entry,
            list_time_entries,
            last_used,
            get_timer,
            start_timer,
            stop_timer,
            update_timer,
            finish_timer,
            discard_timer,
            dashboard,
            progress,
            acknowledge_level_up,
            get_settings,
            update_settings,
            draft_candidates,
            create_draft,
            list_invoices,
            get_invoice,
            add_invoice_entry,
            remove_invoice_entry,
            set_invoice_timesheet,
            set_invoice_net_days,
            send_invoice,
            unseal_invoice,
            mark_paid,
            unmark_paid,
            delete_invoice
        ])
        .build(tauri::generate_context!())
        .expect("error while building Quest Log")
        .run(|app, event| {
            // Dock icon click brings the hidden window back.
            if let tauri::RunEvent::Reopen { .. } = event {
                tray::show(app);
            }
        });
}
