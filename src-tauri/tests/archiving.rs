//! Client archiving and deletion, and project deletion.

mod common;

use common::Fixture;
use quest_log_lib::core::clients::{
    client_deletion, create_client, delete_client, get_client, list_clients, set_client_archived,
    update_client, Client, ClientDeletion, ClientEdit, NewClient,
};
use quest_log_lib::core::invoices::{create_draft, mark_paid, send_invoice, Invoice, NewDraft};
use quest_log_lib::core::projects::{
    create_project, delete_project, list_projects, update_project, Project, ProjectInput,
};
use quest_log_lib::core::settings::{update_settings, SettingsEdit};
use quest_log_lib::core::time_entries::{
    create_entry, last_used, list_entries, update_entry, EntryInput, LastUsed, Span, TimeEntry,
};
use quest_log_lib::core::timer::{
    get_timer, start_timer, stop_timer, update_timer, Stopped, TimerEdit, TimerStart,
};
use quest_log_lib::core::CoreError;

// The fixture's today is Wed 2026-10-07.

async fn client(f: &Fixture, name: &str) -> Client {
    let input = NewClient {
        name: name.into(),
        rate: "85".into(),
    };
    create_client(&f.db, &f.clock, input).await.unwrap()
}

async fn project(f: &Fixture, client_id: i64, name: &str) -> Project {
    let input = ProjectInput {
        name: name.into(),
        rate: String::new(),
    };
    create_project(&f.db, &f.clock, client_id, input)
        .await
        .unwrap()
}

fn entry_input(client_id: i64, project_id: Option<i64>, duration: &str) -> EntryInput {
    EntryInput {
        client_id,
        project_id,
        date: "2026-10-05".into(),
        span: Span::Duration {
            duration: duration.into(),
        },
        note: None,
    }
}

async fn log(f: &Fixture, client_id: i64, project_id: Option<i64>, duration: &str) -> TimeEntry {
    create_entry(&f.db, &f.clock, entry_input(client_id, project_id, duration))
        .await
        .unwrap()
}

async fn draft(f: &Fixture, client_id: i64, entry_ids: Vec<i64>) -> Invoice {
    let input = NewDraft {
        client_id,
        start: "2026-10-01".into(),
        end: "2026-10-07".into(),
        entry_ids,
    };
    create_draft(&f.db, &f.clock, input).await.unwrap()
}

fn timer_start(client_id: i64, project_id: Option<i64>) -> TimerStart {
    TimerStart {
        client_id,
        project_id,
        note: None,
    }
}

async fn archive(f: &Fixture, id: i64) -> Client {
    set_client_archived(&f.db, id, true).await.unwrap()
}

fn invalid_field(err: CoreError) -> &'static str {
    match err {
        CoreError::Invalid { field, .. } => field,
        other => panic!("expected invalid, got {other:?}"),
    }
}

#[tokio::test]
async fn archiving_round_trips_and_keeps_the_client_listed() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme").await;
    assert!(!acme.archived);

    assert!(archive(&f, acme.id).await.archived);
    assert!(get_client(&f.db, acme.id).await.unwrap().archived);
    assert_eq!(list_clients(&f.db).await.unwrap().len(), 1);

    let back = set_client_archived(&f.db, acme.id, false).await.unwrap();
    assert!(!back.archived);

    let err = set_client_archived(&f.db, 999, true).await.unwrap_err();
    assert!(matches!(err, CoreError::NotFound { .. }), "{err:?}");
}

#[tokio::test]
async fn an_archived_client_takes_no_new_entries_timers_or_projects() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme").await;
    archive(&f, acme.id).await;

    let err = create_entry(&f.db, &f.clock, entry_input(acme.id, None, "1"))
        .await
        .unwrap_err();
    assert_eq!(invalid_field(err), "client");
    let err = start_timer(&f.db, &f.clock, timer_start(acme.id, None))
        .await
        .unwrap_err();
    assert_eq!(invalid_field(err), "client");
    let input = ProjectInput {
        name: "Site".into(),
        rate: String::new(),
    };
    let err = create_project(&f.db, &f.clock, acme.id, input)
        .await
        .unwrap_err();
    assert_eq!(invalid_field(err), "client");
}

#[tokio::test]
async fn an_archived_clients_details_projects_and_uninvoiced_entries_stay_editable() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme").await;
    let site = project(&f, acme.id, "Site").await;
    let e = log(&f, acme.id, Some(site.id), "1").await;
    archive(&f, acme.id).await;

    let edit = ClientEdit {
        name: "Acme".into(),
        rate: "90".into(),
        billing_name: String::new(),
        address: String::new(),
        email: String::new(),
        net_days: String::new(),
    };
    let saved = update_client(&f.db, acme.id, edit).await.unwrap();
    assert_eq!(saved.rate_cents, 9000);
    assert!(saved.archived);
    let input = ProjectInput {
        name: "Website".into(),
        rate: String::new(),
    };
    update_project(&f.db, site.id, input).await.unwrap();
    let edited = update_entry(&f.db, &f.clock, e.id, entry_input(acme.id, Some(site.id), "2"))
        .await
        .unwrap();
    assert_eq!(edited.seconds, 7200);
}

#[tokio::test]
async fn an_entry_cannot_move_to_an_archived_client() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme").await;
    let bolt = client(&f, "Bolt").await;
    let e = log(&f, acme.id, None, "1").await;
    archive(&f, bolt.id).await;

    let err = update_entry(&f.db, &f.clock, e.id, entry_input(bolt.id, None, "1"))
        .await
        .unwrap_err();
    assert_eq!(invalid_field(err), "client");
}

#[tokio::test]
async fn a_running_timer_keeps_running_and_saves_after_its_client_is_archived() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme").await;
    start_timer(&f.db, &f.clock, timer_start(acme.id, None))
        .await
        .unwrap();
    archive(&f, acme.id).await;
    f.clock.set(f.clock.now_plus_minutes(30));

    let edit = TimerEdit {
        client_id: acme.id,
        project_id: None,
        note: Some("still going".into()),
        start: None,
    };
    update_timer(&f.db, &f.clock, edit).await.unwrap();
    let Stopped::Saved { entry } = stop_timer(&f.db, &f.clock).await.unwrap() else {
        panic!("expected saved");
    };
    assert_eq!((entry.client_id, entry.seconds), (acme.id, 1800));
}

#[tokio::test]
async fn last_used_skips_archived_clients() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme").await;
    let bolt = client(&f, "Bolt").await;
    log(&f, acme.id, None, "1").await;
    log(&f, bolt.id, None, "1").await;

    archive(&f, bolt.id).await;
    assert_eq!(
        last_used(&f.db).await.unwrap(),
        Some(LastUsed {
            client_id: acme.id,
            project_id: None
        })
    );
    archive(&f, acme.id).await;
    assert_eq!(last_used(&f.db).await.unwrap(), None);
}

#[tokio::test]
async fn an_archived_client_can_still_be_billed_and_paid() {
    let f = Fixture::new().await;
    update_settings(
        &f.db,
        SettingsEdit {
            name: "Ed Souza".into(),
            business_name: String::new(),
            address: String::new(),
            email: String::new(),
            tax_id: String::new(),
            payment_instructions: String::new(),
            net_days: "30".into(),
            invoice_prefix: "INV-".into(),
            next_invoice_number: "1".into(),
        },
    )
    .await
    .unwrap();
    let acme = client(&f, "Acme").await;
    let e = log(&f, acme.id, None, "1").await;
    assert!(!client(&f, "Bolt").await.has_available);
    assert!(archive(&f, acme.id).await.has_available);

    let d = draft(&f, acme.id, vec![e.id]).await;
    assert!(!get_client(&f.db, acme.id).await.unwrap().has_available);
    send_invoice(&f.db, &f.clock, d.id).await.unwrap();
    mark_paid(&f.db, &f.clock, d.id, "2026-10-07").await.unwrap();
}

#[tokio::test]
async fn deleting_a_client_counts_then_removes_its_projects_entries_and_timer() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme").await;
    let bolt = client(&f, "Bolt").await;
    let site = project(&f, acme.id, "Site").await;
    project(&f, acme.id, "App").await;
    log(&f, acme.id, Some(site.id), "1:30").await;
    log(&f, acme.id, None, "1").await;
    log(&f, bolt.id, None, "2").await;
    // An empty Draft holds none of its entries, so it doesn't block.
    draft(&f, acme.id, vec![]).await;
    start_timer(&f.db, &f.clock, timer_start(acme.id, Some(site.id)))
        .await
        .unwrap();

    assert_eq!(
        client_deletion(&f.db, acme.id).await.unwrap(),
        ClientDeletion {
            projects: 2,
            entries: 2,
            seconds: 9000
        }
    );
    delete_client(&f.db, acme.id).await.unwrap();

    let names: Vec<_> = list_clients(&f.db)
        .await
        .unwrap()
        .into_iter()
        .map(|c| c.name)
        .collect();
    assert_eq!(names, ["Bolt"]);
    assert!(list_projects(&f.db, acme.id).await.unwrap().is_empty());
    assert_eq!(list_entries(&f.db, None).await.unwrap().len(), 1);
    assert!(get_timer(&f.db).await.unwrap().is_none());
    let err = delete_client(&f.db, acme.id).await.unwrap_err();
    assert!(matches!(err, CoreError::NotFound { .. }), "{err:?}");
}

#[tokio::test]
async fn a_client_with_an_entry_on_any_invoice_cannot_be_deleted() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme").await;
    let e = log(&f, acme.id, None, "1").await;
    draft(&f, acme.id, vec![e.id]).await;

    let err = client_deletion(&f.db, acme.id).await.unwrap_err();
    assert_eq!(invalid_field(err), "client");
    let err = delete_client(&f.db, acme.id).await.unwrap_err();
    assert_eq!(invalid_field(err), "client");
    assert_eq!(list_entries(&f.db, None).await.unwrap().len(), 1);
}

#[tokio::test]
async fn a_project_with_an_entry_on_any_invoice_cannot_be_deleted() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme").await;
    let site = project(&f, acme.id, "Site").await;
    let e = log(&f, acme.id, Some(site.id), "1").await;
    log(&f, acme.id, Some(site.id), "1").await;
    draft(&f, acme.id, vec![e.id]).await;

    let err = delete_project(&f.db, site.id).await.unwrap_err();
    assert_eq!(invalid_field(err), "project");
    assert_eq!(list_entries(&f.db, None).await.unwrap().len(), 2);
}

#[tokio::test]
async fn deleting_a_project_removes_its_uninvoiced_entries_and_frees_the_timer() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme").await;
    let site = project(&f, acme.id, "Site").await;
    log(&f, acme.id, Some(site.id), "1").await;
    log(&f, acme.id, None, "2").await;
    start_timer(&f.db, &f.clock, timer_start(acme.id, Some(site.id)))
        .await
        .unwrap();

    delete_project(&f.db, site.id).await.unwrap();

    assert!(list_projects(&f.db, acme.id).await.unwrap().is_empty());
    let left: Vec<_> = list_entries(&f.db, None)
        .await
        .unwrap()
        .into_iter()
        .map(|e| e.seconds)
        .collect();
    assert_eq!(left, [7200]);
    let timer = get_timer(&f.db).await.unwrap().unwrap();
    assert_eq!((timer.client_id, timer.project_id), (acme.id, None));
}
