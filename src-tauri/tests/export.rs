mod common;

use common::Fixture;
use quest_log_lib::core::clients::{create_client, update_client, Client, ClientEdit, NewClient};
use quest_log_lib::core::dashboard::{PeriodInput, Preset};
use quest_log_lib::core::export::export_csv;
use quest_log_lib::core::invoices::{create_draft, mark_paid, send_invoice, NewDraft};
use quest_log_lib::core::projects::{create_project, update_project, ProjectInput};
use quest_log_lib::core::settings::{update_settings, SettingsEdit};
use quest_log_lib::core::time_entries::{create_entry, EntryInput, Span, TimeEntry};
use quest_log_lib::core::timer::{start_timer, TimerStart};

async fn client(f: &Fixture, name: &str, rate: &str) -> Client {
    let input = NewClient {
        name: name.into(),
        rate: rate.into(),
    };
    create_client(&f.db, &f.clock, input).await.unwrap()
}

async fn rerate(f: &Fixture, c: &Client, rate: &str) {
    let input = ClientEdit {
        name: c.name.clone(),
        rate: rate.into(),
        billing_name: String::new(),
        address: String::new(),
        email: String::new(),
        net_days: String::new(),
    };
    update_client(&f.db, c.id, input).await.unwrap();
}

async fn log(
    f: &Fixture,
    client_id: i64,
    project_id: Option<i64>,
    date: &str,
    span: Span,
    note: Option<&str>,
) -> TimeEntry {
    let input = EntryInput {
        client_id,
        project_id,
        date: date.into(),
        span,
        note: note.map(Into::into),
    };
    create_entry(&f.db, &f.clock, input).await.unwrap()
}

fn duration(d: &str) -> Span {
    Span::Duration { duration: d.into() }
}

async fn invoice(f: &Fixture, client_id: i64, entry_ids: Vec<i64>) -> i64 {
    let input = NewDraft {
        client_id,
        start: "2026-10-01".into(),
        end: "2026-10-07".into(),
        entry_ids,
    };
    create_draft(&f.db, &f.clock, input).await.unwrap().id
}

fn this_week() -> PeriodInput {
    PeriodInput {
        preset: Preset::OneWeek,
        offset: 0,
        start: None,
        end: None,
    }
}

const HEADER: &str =
    "Date,Start,End,Seconds,Hours,Client,Project,Note,Rate,Amount,Invoice number,Invoice state";

/// The fixture's today is Wed 2026-10-07; this week is Mon 10-05 to Sun 10-11.
/// Acme $100 (later $120) with Website $150 (later $200); Bolt $80 (later $90).
async fn setup() -> (Fixture, Client) {
    let f = Fixture::new().await;
    let seller = SettingsEdit {
        name: "Ed Souza".into(),
        business_name: String::new(),
        address: String::new(),
        email: String::new(),
        tax_id: String::new(),
        payment_instructions: String::new(),
        net_days: "30".into(),
        invoice_prefix: "INV-".into(),
        next_invoice_number: "1".into(),
    };
    update_settings(&f.db, seller).await.unwrap();
    let acme = client(&f, "Acme", "100").await;
    let bolt = client(&f, "Bolt, Inc.", "80").await;
    let web = create_project(
        &f.db,
        &f.clock,
        acme.id,
        ProjectInput {
            name: "Website".into(),
            rate: "150".into(),
        },
    )
    .await
    .unwrap();

    let range = Span::Range {
        start: "09:00".into(),
        end: "10:30".into(),
    };
    let note = "Fixed \"nav\", header\nand footer";
    let paid = log(&f, acme.id, Some(web.id), "2026-10-05", range, Some(note)).await;
    let draft = log(&f, acme.id, None, "2026-10-06", duration("1:00"), None).await;
    let sent = log(&f, bolt.id, None, "2026-10-06", duration("0:20"), None).await;
    log(&f, acme.id, None, "2026-10-04", duration("2:00"), None).await;

    let a = invoice(&f, acme.id, vec![paid.id]).await;
    send_invoice(&f.db, &f.clock, a).await.unwrap();
    mark_paid(&f.db, &f.clock, a, "2026-10-07").await.unwrap();
    let b = invoice(&f, bolt.id, vec![sent.id]).await;
    send_invoice(&f.db, &f.clock, b).await.unwrap();
    invoice(&f, acme.id, vec![draft.id]).await;

    update_project(
        &f.db,
        web.id,
        ProjectInput {
            name: "Website".into(),
            rate: "200".into(),
        },
    )
    .await
    .unwrap();
    rerate(&f, &acme, "120").await;
    rerate(&f, &bolt, "90").await;
    start_timer(
        &f.db,
        &f.clock,
        TimerStart {
            client_id: acme.id,
            project_id: None,
            note: None,
        },
    )
    .await
    .unwrap();
    (f, acme)
}

const PAID: &str =
    "2026-10-05,09:00,10:30,5400,1.50,Acme,Website,\"Fixed \"\"nav\"\", header\nand footer\",150.00,225.00,INV-0001,Paid";
const DRAFT: &str = "2026-10-06,,,3600,1.00,Acme,,,120.00,120.00,,Draft";
const SENT: &str = "2026-10-06,,,1200,0.33,\"Bolt, Inc.\",,,80.00,26.67,INV-0002,Sent";

#[tokio::test]
async fn exports_the_periods_entries_oldest_first_at_frozen_or_live_rates() {
    let (f, _) = setup().await;

    let csv = export_csv(&f.db, &f.clock, &this_week(), None)
        .await
        .unwrap();

    assert_eq!(csv, [HEADER, PAID, DRAFT, SENT, ""].join("\n"));
}

#[tokio::test]
async fn exports_only_one_clients_entries_when_given() {
    let (f, acme) = setup().await;

    let csv = export_csv(&f.db, &f.clock, &this_week(), Some(acme.id))
        .await
        .unwrap();

    assert_eq!(csv, [HEADER, PAID, DRAFT, ""].join("\n"));
}

#[tokio::test]
async fn an_empty_period_exports_just_the_header() {
    let (f, _) = setup().await;
    let input = PeriodInput {
        offset: -3,
        ..this_week()
    };

    let csv = export_csv(&f.db, &f.clock, &input, None).await.unwrap();

    assert_eq!(csv, format!("{HEADER}\n"));
}
