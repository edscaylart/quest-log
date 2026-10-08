//! Send / Paid lifecycle: Draft → Sent → Paid and back.

mod common;

use chrono::{Duration, NaiveDate};
use common::Fixture;
use quest_log_lib::core::clients::{
    create_client, preview_client_rate, update_client, Client, ClientEdit, NewClient,
};
use quest_log_lib::core::dashboard::{dashboard, PeriodInput, Preset};
use quest_log_lib::core::invoices::{
    add_invoice_entry, create_draft, delete_invoice, get_invoice, list_invoices, mark_paid,
    remove_invoice_entry, send_invoice, set_invoice_net_days, set_invoice_timesheet, unmark_paid,
    unseal_invoice, Invoice, NewDraft, State,
};
use quest_log_lib::core::projects::{create_project, update_project, ProjectInput};
use quest_log_lib::core::settings::{update_settings, SettingsEdit};
use quest_log_lib::core::time_entries::{
    create_entry, delete_entry, list_entries, update_entry, EntryInput, Span, TimeEntry,
};
use quest_log_lib::core::{Clock, CoreError};

// The fixture's today is Wed 2026-10-07.

async fn client(f: &Fixture, name: &str, rate: &str) -> Client {
    let input = NewClient {
        name: name.into(),
        rate: rate.into(),
    };
    create_client(&f.db, &f.clock, input).await.unwrap()
}

fn client_edit(c: &Client, rate: &str, net_days: &str) -> ClientEdit {
    ClientEdit {
        name: c.name.clone(),
        rate: rate.into(),
        billing_name: c.billing_name.clone().unwrap_or_default(),
        address: c.address.clone().unwrap_or_default(),
        email: c.email.clone().unwrap_or_default(),
        net_days: net_days.into(),
    }
}

fn entry_input(client_id: i64, project_id: Option<i64>, date: &str, duration: &str) -> EntryInput {
    EntryInput {
        client_id,
        project_id,
        date: date.into(),
        span: Span::Duration {
            duration: duration.into(),
        },
        note: None,
    }
}

async fn log_on(f: &Fixture, client_id: i64, date: &str, duration: &str) -> TimeEntry {
    create_entry(
        &f.db,
        &f.clock,
        entry_input(client_id, None, date, duration),
    )
    .await
    .unwrap()
}

fn settings(prefix: &str, next: &str, net_days: &str) -> SettingsEdit {
    SettingsEdit {
        name: "Ed Souza".into(),
        business_name: "Souza Dev".into(),
        address: "1 Main St".into(),
        email: "ed@example.com".into(),
        tax_id: String::new(),
        payment_instructions: "Wire to 123".into(),
        net_days: net_days.into(),
        invoice_prefix: prefix.into(),
        next_invoice_number: next.into(),
    }
}

/// Seller set up, Acme at $85/h with one 1:30 entry on a Draft.
async fn setup() -> (Fixture, Client, TimeEntry, Invoice) {
    let f = Fixture::new().await;
    update_settings(&f.db, settings("INV-", "1", "30"))
        .await
        .unwrap();
    let acme = client(&f, "Acme", "85").await;
    let e = log_on(&f, acme.id, "2026-10-05", "1:30").await;
    let d = draft(&f, acme.id, vec![e.id]).await;
    (f, acme, e, d)
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

fn day(s: &str) -> NaiveDate {
    s.parse().unwrap()
}

fn invalid_field(err: CoreError) -> &'static str {
    match err {
        CoreError::Invalid { field, .. } => field,
        other => panic!("expected invalid, got {other:?}"),
    }
}

fn month() -> PeriodInput {
    PeriodInput {
        preset: Preset::Month,
        offset: 0,
        start: None,
        end: None,
    }
}

#[tokio::test]
async fn sending_numbers_dates_snapshots_and_locks() {
    let (f, acme, e, d) = setup().await;

    let sent = send_invoice(&f.db, &f.clock, d.id).await.unwrap();

    assert_eq!(sent.state, State::Sent);
    assert_eq!(sent.number.as_deref(), Some("INV-0001"));
    assert_eq!(sent.issue_date, Some(day("2026-10-07")));
    assert_eq!(sent.due_date, Some(day("2026-11-06")), "Net 30 default");
    assert!(!sent.overdue);
    let snap = sent.snapshot.as_ref().unwrap();
    assert_eq!(
        (snap.number.as_str(), snap.issue_date, snap.due_date),
        ("INV-0001", day("2026-10-07"), day("2026-11-06"))
    );
    assert_eq!(snap.seller.name, "Ed Souza");
    assert_eq!(snap.client.name, "Acme");
    assert_eq!(snap.total_cents, 12750);
    assert_eq!(snap.timesheet.len(), 1);
    assert_eq!(snap.timesheet[0].seconds, 5400);
    assert_eq!(sent.total_cents, 12750);
    assert!(
        sent.available.is_empty(),
        "nothing to add to a Sent invoice"
    );

    let entries = list_entries(&f.db, Some(acme.id)).await.unwrap();
    assert!(entries.iter().find(|x| x.id == e.id).unwrap().locked);
}

#[tokio::test]
async fn numbers_come_from_the_settings_sequence_and_survive_unsealing() {
    let (f, acme, _, d) = setup().await;
    update_settings(&f.db, settings("SD-", "42", "30"))
        .await
        .unwrap();
    let e2 = log_on(&f, acme.id, "2026-10-06", "1").await;
    let d2 = draft(&f, acme.id, vec![e2.id]).await;

    let first = send_invoice(&f.db, &f.clock, d.id).await.unwrap();
    let unsealed = unseal_invoice(&f.db, &f.clock, d.id).await.unwrap();
    let resent = send_invoice(&f.db, &f.clock, d.id).await.unwrap();
    let second = send_invoice(&f.db, &f.clock, d2.id).await.unwrap();

    assert_eq!(first.number.as_deref(), Some("SD-0042"));
    assert_eq!(unsealed.state, State::Draft);
    assert_eq!(
        unsealed.number.as_deref(),
        Some("SD-0042"),
        "kept on revert"
    );
    assert!(unsealed.snapshot.is_none());
    assert_eq!(
        resent.number.as_deref(),
        Some("SD-0042"),
        "only the first Send numbers"
    );
    assert_eq!(second.number.as_deref(), Some("SD-0043"));
}

#[tokio::test]
async fn due_date_uses_invoice_then_client_then_settings_net_days() {
    let (f, acme, _, d) = setup().await;
    update_settings(&f.db, settings("INV-", "1", "15"))
        .await
        .unwrap();
    assert_eq!(
        get_invoice(&f.db, &f.clock, d.id).await.unwrap().net_days,
        15
    );

    update_client(&f.db, acme.id, client_edit(&acme, "85", "0"))
        .await
        .unwrap();
    assert_eq!(
        get_invoice(&f.db, &f.clock, d.id).await.unwrap().net_days,
        0
    );

    let d = set_invoice_net_days(&f.db, &f.clock, d.id, "45")
        .await
        .unwrap();
    assert_eq!((d.net_days, d.net_days_override), (45, Some(45)));
    let sent = send_invoice(&f.db, &f.clock, d.id).await.unwrap();
    assert_eq!(sent.due_date, Some(day("2026-11-21")));

    unseal_invoice(&f.db, &f.clock, d.id).await.unwrap();
    let d = set_invoice_net_days(&f.db, &f.clock, d.id, " ")
        .await
        .unwrap();
    assert_eq!((d.net_days, d.net_days_override), (0, None), "blank clears");
    let err = set_invoice_net_days(&f.db, &f.clock, d.id, "-1")
        .await
        .unwrap_err();
    assert_eq!(invalid_field(err), "netDays");
}

#[tokio::test]
async fn a_sent_invoice_is_overdue_only_after_its_due_date() {
    let (f, _, _, d) = setup().await;
    send_invoice(&f.db, &f.clock, d.id).await.unwrap(); // due 2026-11-06

    f.clock.set(f.clock.now() + Duration::days(30)); // 2026-11-06
    assert!(!get_invoice(&f.db, &f.clock, d.id).await.unwrap().overdue);

    f.clock.set(f.clock.now() + Duration::days(1));
    assert!(get_invoice(&f.db, &f.clock, d.id).await.unwrap().overdue);
    assert!(list_invoices(&f.db, &f.clock).await.unwrap()[0].overdue);

    let paid = mark_paid(&f.db, &f.clock, d.id, "2026-11-07")
        .await
        .unwrap();
    assert!(!paid.overdue, "only Sent can be overdue");
}

#[tokio::test]
async fn an_empty_draft_cant_be_sent_but_a_zero_total_can() {
    let f = Fixture::new().await;
    update_settings(&f.db, settings("INV-", "1", "30"))
        .await
        .unwrap();
    let free = client(&f, "Free", "0").await;
    let empty = draft(&f, free.id, vec![]).await;
    let e = log_on(&f, free.id, "2026-10-05", "1").await;
    let zero = draft(&f, free.id, vec![e.id]).await;

    let err = send_invoice(&f.db, &f.clock, empty.id).await.unwrap_err();
    assert_eq!(invalid_field(err), "entries");
    let sent = send_invoice(&f.db, &f.clock, zero.id).await.unwrap();
    assert_eq!((sent.state, sent.total_cents), (State::Sent, 0));
}

#[tokio::test]
async fn sending_needs_the_sellers_name() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme", "85").await;
    let e = log_on(&f, acme.id, "2026-10-05", "1").await;
    let d = draft(&f, acme.id, vec![e.id]).await;

    let err = send_invoice(&f.db, &f.clock, d.id).await.unwrap_err();
    assert_eq!(invalid_field(err), "name");
}

#[tokio::test]
async fn paid_records_a_date_and_reverts_to_sent() {
    let (f, _, _, d) = setup().await;
    send_invoice(&f.db, &f.clock, d.id).await.unwrap();

    let paid = mark_paid(&f.db, &f.clock, d.id, "2026-10-20")
        .await
        .unwrap();
    assert_eq!(
        (paid.state, paid.paid_date),
        (State::Paid, Some(day("2026-10-20")))
    );

    let back = unmark_paid(&f.db, &f.clock, d.id).await.unwrap();
    assert_eq!((back.state, back.paid_date), (State::Sent, None));
    assert_eq!(back.number.as_deref(), Some("INV-0001"));
    let err = mark_paid(&f.db, &f.clock, d.id, "").await.unwrap_err();
    assert_eq!(invalid_field(err), "paidDate");
}

#[tokio::test]
async fn illegal_transitions_are_rejected() {
    let (f, _, e, d) = setup().await;
    let state_err = |r: Result<Invoice, CoreError>| invalid_field(r.unwrap_err());

    // Draft: only Send.
    assert_eq!(
        state_err(unseal_invoice(&f.db, &f.clock, d.id).await),
        "state"
    );
    assert_eq!(
        state_err(mark_paid(&f.db, &f.clock, d.id, "2026-10-07").await),
        "state"
    );
    assert_eq!(state_err(unmark_paid(&f.db, &f.clock, d.id).await), "state");

    // Sent: no editing, no re-Send, no Paid revert, no delete.
    send_invoice(&f.db, &f.clock, d.id).await.unwrap();
    assert_eq!(
        state_err(send_invoice(&f.db, &f.clock, d.id).await),
        "state"
    );
    assert_eq!(state_err(unmark_paid(&f.db, &f.clock, d.id).await), "state");
    assert_eq!(
        state_err(remove_invoice_entry(&f.db, &f.clock, d.id, e.id).await),
        "state"
    );
    assert_eq!(
        state_err(set_invoice_timesheet(&f.db, &f.clock, d.id, false).await),
        "state"
    );
    assert_eq!(
        state_err(set_invoice_net_days(&f.db, &f.clock, d.id, "5").await),
        "state"
    );
    assert_eq!(
        invalid_field(delete_invoice(&f.db, d.id).await.unwrap_err()),
        "state"
    );

    // Paid: no Send, no Unseal, no second Paid.
    mark_paid(&f.db, &f.clock, d.id, "2026-10-07")
        .await
        .unwrap();
    assert_eq!(
        state_err(send_invoice(&f.db, &f.clock, d.id).await),
        "state"
    );
    assert_eq!(
        state_err(unseal_invoice(&f.db, &f.clock, d.id).await),
        "state"
    );
    assert_eq!(
        state_err(mark_paid(&f.db, &f.clock, d.id, "2026-10-07").await),
        "state"
    );
    let other = log_on(&f, d.client_id, "2026-10-06", "1").await;
    assert_eq!(
        state_err(add_invoice_entry(&f.db, &f.clock, d.id, other.id).await),
        "state"
    );

    assert!(matches!(
        send_invoice(&f.db, &f.clock, 999).await,
        Err(CoreError::NotFound { .. })
    ));
}

#[tokio::test]
async fn the_snapshot_ignores_later_rate_and_detail_changes_until_resent() {
    let (f, acme, e, d) = setup().await;
    let site = create_project(
        &f.db,
        &f.clock,
        acme.id,
        ProjectInput {
            name: "Website".into(),
            rate: "100".into(),
        },
    )
    .await
    .unwrap();
    let on_site = create_entry(
        &f.db,
        &f.clock,
        entry_input(acme.id, Some(site.id), "2026-10-06", "1"),
    )
    .await
    .unwrap();
    add_invoice_entry(&f.db, &f.clock, d.id, on_site.id)
        .await
        .unwrap();
    send_invoice(&f.db, &f.clock, d.id).await.unwrap();

    update_client(&f.db, acme.id, client_edit(&acme, "200", ""))
        .await
        .unwrap();
    update_project(
        &f.db,
        site.id,
        ProjectInput {
            name: "Site 2".into(),
            rate: "300".into(),
        },
    )
    .await
    .unwrap();
    let mut renamed = settings("INV-", "1", "30");
    renamed.name = "New Name".into();
    update_settings(&f.db, renamed).await.unwrap();

    let sent = get_invoice(&f.db, &f.clock, d.id).await.unwrap();
    assert_eq!(sent.total_cents, 12750 + 10000);
    assert_eq!(sent.lines[0].description, "Website");
    let snap = sent.snapshot.unwrap();
    assert_eq!(snap.seller.name, "Ed Souza");
    let locked = list_entries(&f.db, Some(acme.id)).await.unwrap();
    assert_eq!(
        locked.iter().find(|x| x.id == e.id).unwrap().rate_cents,
        8500
    );
    assert_eq!(
        preview_client_rate(&f.db, acme.id, "100")
            .await
            .unwrap()
            .seconds,
        0,
        "Sent time doesn't reprice"
    );

    let unsealed = unseal_invoice(&f.db, &f.clock, d.id).await.unwrap();
    assert_eq!(
        unsealed.total_cents,
        30000 + 30000,
        "a Draft follows live rates"
    );
    remove_invoice_entry(&f.db, &f.clock, d.id, on_site.id)
        .await
        .unwrap();
    let resent = send_invoice(&f.db, &f.clock, d.id).await.unwrap();
    assert_eq!(resent.total_cents, 30000);
    assert_eq!(resent.snapshot.unwrap().seller.name, "New Name");
}

#[tokio::test]
async fn locked_entries_reject_edit_and_delete_until_unsealed() {
    let (f, acme, e, d) = setup().await;
    send_invoice(&f.db, &f.clock, d.id).await.unwrap();

    let edit = update_entry(
        &f.db,
        &f.clock,
        e.id,
        entry_input(acme.id, None, "2026-10-05", "2"),
    )
    .await
    .unwrap_err();
    assert!(matches!(edit, CoreError::Locked { .. }), "{edit:?}");
    assert!(matches!(
        delete_entry(&f.db, e.id).await.unwrap_err(),
        CoreError::Locked { .. }
    ));

    unseal_invoice(&f.db, &f.clock, d.id).await.unwrap();
    let edited = update_entry(
        &f.db,
        &f.clock,
        e.id,
        entry_input(acme.id, None, "2026-10-05", "2"),
    )
    .await
    .unwrap();
    assert!(!edited.locked);
}

#[tokio::test]
async fn dashboard_splits_earnings_by_billing_state_at_the_sent_rate() {
    let (f, acme, _, d) = setup().await; // 1:30 at $85 on d
    let owed = log_on(&f, acme.id, "2026-10-06", "1").await;
    let d2 = draft(&f, acme.id, vec![owed.id]).await;
    log_on(&f, acme.id, "2026-10-07", "2").await; // uninvoiced
    send_invoice(&f.db, &f.clock, d.id).await.unwrap();
    mark_paid(&f.db, &f.clock, d.id, "2026-10-07")
        .await
        .unwrap();
    send_invoice(&f.db, &f.clock, d2.id).await.unwrap();
    update_client(&f.db, acme.id, client_edit(&acme, "100", ""))
        .await
        .unwrap();

    let dash = dashboard(&f.db, &f.clock, &month()).await.unwrap();

    assert_eq!(dash.total.paid_cents, 12750);
    assert_eq!(dash.total.invoiced_unpaid_cents, 8500);
    assert_eq!(dash.total.uninvoiced_cents, 20000, "live rate");
    assert_eq!(dash.total.earned_cents, 12750 + 8500 + 20000);
    assert_eq!(dash.clients[0].figures, dash.total);
    assert_eq!(dash.all_time.invoiced_unpaid_cents, 8500);
    assert_eq!(dash.all_time.uninvoiced_cents, 20000);
    assert_eq!(dash.all_time.overdue, 0);

    f.clock.set(f.clock.now() + Duration::days(31));
    let dash = dashboard(&f.db, &f.clock, &month()).await.unwrap();
    assert_eq!(dash.all_time.overdue, 1);
}
