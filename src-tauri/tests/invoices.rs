mod common;

use chrono::NaiveDate;
use common::Fixture;
use quest_log_lib::core::clients::{create_client, update_client, Client, ClientEdit, NewClient};
use quest_log_lib::core::dashboard::{PeriodInput, Preset};
use quest_log_lib::core::invoices::{
    add_invoice_entry, create_draft, delete_invoice, draft_candidates, get_invoice, list_invoices,
    remove_invoice_entry, set_invoice_timesheet, Line, NewDraft, State,
};
use quest_log_lib::core::projects::{create_project, update_project, Project, ProjectInput};
use quest_log_lib::core::time_entries::{
    create_entry, delete_entry, update_entry, EntryInput, Span, TimeEntry,
};
use quest_log_lib::core::CoreError;

async fn client(f: &Fixture, name: &str, rate: &str) -> Client {
    let input = NewClient {
        name: name.into(),
        rate: rate.into(),
    };
    create_client(&f.db, &f.clock, input).await.unwrap()
}

async fn log_on(
    f: &Fixture,
    client_id: i64,
    project_id: Option<i64>,
    date: &str,
    duration: &str,
) -> TimeEntry {
    let input = EntryInput {
        client_id,
        project_id,
        date: date.into(),
        span: Span::Duration {
            duration: duration.into(),
        },
        note: None,
    };
    create_entry(&f.db, &f.clock, input).await.unwrap()
}

async fn project(f: &Fixture, client_id: i64, name: &str, rate: &str) -> Project {
    let input = ProjectInput {
        name: name.into(),
        rate: rate.into(),
    };
    create_project(&f.db, &f.clock, client_id, input)
        .await
        .unwrap()
}

fn day(s: &str) -> NaiveDate {
    s.parse().unwrap()
}

fn ids(entries: &[TimeEntry]) -> Vec<i64> {
    entries.iter().map(|e| e.id).collect()
}

// The fixture's today is Wed 2026-10-07.

#[tokio::test]
async fn first_draft_defaults_from_the_earliest_uninvoiced_entry_to_today() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme", "85").await;
    let bolt = client(&f, "Bolt", "85").await;
    let sep = log_on(&f, acme.id, None, "2026-09-14", "1").await;
    let oct = log_on(&f, acme.id, None, "2026-10-06", "1").await;
    log_on(&f, bolt.id, None, "2026-08-01", "1").await;

    let c = draft_candidates(&f.db, &f.clock, acme.id, None)
        .await
        .unwrap();

    assert_eq!(
        (c.period.start, c.period.end),
        (day("2026-09-14"), day("2026-10-07"))
    );
    assert_eq!(ids(&c.entries), [oct.id, sep.id], "newest first, Acme only");
    assert_eq!(c.older, 0);
}

fn draft(client_id: i64, start: &str, end: &str, entry_ids: Vec<i64>) -> NewDraft {
    NewDraft {
        client_id,
        start: start.into(),
        end: end.into(),
        entry_ids,
    }
}

#[tokio::test]
async fn next_draft_defaults_from_the_day_after_the_last_invoice_period_and_hints_older_entries() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme", "85").await;
    let bolt = client(&f, "Bolt", "85").await;
    let billed = log_on(&f, acme.id, None, "2026-09-10", "1").await;
    let unticked = log_on(&f, acme.id, None, "2026-09-12", "1").await;
    let earlier = log_on(&f, acme.id, None, "2026-08-03", "1").await;
    let oct = log_on(&f, acme.id, None, "2026-10-02", "1").await;
    create_draft(
        &f.db,
        &f.clock,
        draft(acme.id, "2026-09-01", "2026-09-30", vec![billed.id]),
    )
    .await
    .unwrap();
    create_draft(
        &f.db,
        &f.clock,
        draft(bolt.id, "2026-10-01", "2026-10-05", vec![]),
    )
    .await
    .unwrap();

    let c = draft_candidates(&f.db, &f.clock, acme.id, None)
        .await
        .unwrap();

    assert_eq!(
        (c.period.start, c.period.end),
        (day("2026-10-01"), day("2026-10-07"))
    );
    assert_eq!(ids(&c.entries), [oct.id]);
    assert_eq!(
        c.older, 2,
        "{} and {} are still uninvoiced",
        unticked.id, earlier.id
    );
    assert_eq!(c.older_since, Some(day("2026-08-03")));
}

#[tokio::test]
async fn default_period_never_starts_after_today() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme", "85").await;
    create_draft(
        &f.db,
        &f.clock,
        draft(acme.id, "2026-10-01", "2026-10-07", vec![]),
    )
    .await
    .unwrap();

    let c = draft_candidates(&f.db, &f.clock, acme.id, None)
        .await
        .unwrap();

    assert_eq!(
        (c.period.start, c.period.end),
        (day("2026-10-07"), day("2026-10-07"))
    );
}

fn line(project_id: Option<i64>, description: &str, seconds: i64, rate: i64, amount: i64) -> Line {
    Line {
        project_id,
        description: description.into(),
        seconds,
        rate_cents: rate,
        amount_cents: amount,
    }
}

#[tokio::test]
async fn lines_are_one_per_quest_then_general_each_rounded_to_the_cent_once() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme", "85").await;
    let site = project(&f, acme.id, "Website", "120").await;
    let pro_bono = project(&f, acme.id, "Pro bono", "0").await;
    let mut ids = Vec::new();
    for (project_id, duration) in [
        (Some(site.id), "1:30"),
        (Some(pro_bono.id), "2"),
        (None, "0:00:20"),
        (None, "0:00:20"),
        (None, "0:00:20"),
        (None, "1:00:01"),
    ] {
        ids.push(
            log_on(&f, acme.id, project_id, "2026-10-05", duration)
                .await
                .id,
        );
    }

    let d = create_draft(
        &f.db,
        &f.clock,
        draft(acme.id, "2026-10-01", "2026-10-07", ids),
    )
    .await
    .unwrap();

    // General: 3661 s × $85/h = $86.4403 → $86.44 (rounding each entry would give $86.43).
    assert_eq!(
        d.lines,
        [
            line(Some(pro_bono.id), "Pro bono", 7200, 0, 0),
            line(Some(site.id), "Website", 5400, 12000, 18000),
            line(None, "General", 3661, 8500, 8644),
        ]
    );
    assert_eq!((d.seconds, d.total_cents), (16261, 26644));
}

#[tokio::test]
async fn a_rate_change_reprices_an_open_draft() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme", "85").await;
    let site = project(&f, acme.id, "Website", "").await;
    let a = log_on(&f, acme.id, None, "2026-10-05", "1:00:01").await;
    let b = log_on(&f, acme.id, Some(site.id), "2026-10-05", "2").await;
    let d = create_draft(
        &f.db,
        &f.clock,
        draft(acme.id, "2026-10-01", "2026-10-07", vec![a.id, b.id]),
    )
    .await
    .unwrap();

    let edit = ClientEdit {
        name: "Acme".into(),
        rate: "100".into(),
        billing_name: String::new(),
        address: String::new(),
        email: String::new(),
        net_days: String::new(),
    };
    update_client(&f.db, acme.id, edit).await.unwrap();
    let input = ProjectInput {
        name: "Website".into(),
        rate: "50".into(),
    };
    update_project(&f.db, site.id, input).await.unwrap();

    let d = get_invoice(&f.db, d.id).await.unwrap();
    assert_eq!(
        d.lines,
        [
            line(Some(site.id), "Website", 7200, 5000, 10000),
            line(None, "General", 3601, 10000, 10003),
        ]
    );
    assert_eq!(d.total_cents, 20003);
}

fn invalid_field(err: CoreError) -> &'static str {
    match err {
        CoreError::Invalid { field, .. } => field,
        other => panic!("expected invalid, got {other:?}"),
    }
}

#[tokio::test]
async fn adding_and_removing_entries_moves_them_on_and_off_the_draft() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme", "85").await;
    let a = log_on(&f, acme.id, None, "2026-10-05", "1").await;
    let old = log_on(&f, acme.id, None, "2026-07-01", "2").await;
    let d = create_draft(
        &f.db,
        &f.clock,
        draft(acme.id, "2026-10-01", "2026-10-07", vec![a.id]),
    )
    .await
    .unwrap();
    assert_eq!(ids(&d.available), [old.id]);

    let d = add_invoice_entry(&f.db, d.id, old.id).await.unwrap();
    assert_eq!(ids(&d.entries), [a.id, old.id], "any date of the client");
    assert_eq!((d.seconds, d.total_cents), (3 * 3600, 25500));
    assert!(d.available.is_empty());

    let d = remove_invoice_entry(&f.db, d.id, a.id).await.unwrap();
    assert_eq!(ids(&d.entries), [old.id]);
    assert_eq!(ids(&d.available), [a.id], "back to uninvoiced");
}

#[tokio::test]
async fn an_entry_sits_on_at_most_one_invoice() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme", "85").await;
    let bolt = client(&f, "Bolt", "85").await;
    let a = log_on(&f, acme.id, None, "2026-10-05", "1").await;
    let theirs = log_on(&f, bolt.id, None, "2026-10-05", "1").await;
    let first = create_draft(
        &f.db,
        &f.clock,
        draft(acme.id, "2026-10-01", "2026-10-07", vec![a.id]),
    )
    .await
    .unwrap();

    let err = create_draft(
        &f.db,
        &f.clock,
        draft(acme.id, "2026-10-01", "2026-10-07", vec![a.id]),
    )
    .await
    .unwrap_err();
    assert_eq!(invalid_field(err), "entries");
    assert_eq!(
        list_invoices(&f.db).await.unwrap().len(),
        1,
        "nothing half-created"
    );

    let second = create_draft(
        &f.db,
        &f.clock,
        draft(acme.id, "2026-10-01", "2026-10-07", vec![]),
    )
    .await
    .unwrap();
    let err = add_invoice_entry(&f.db, second.id, a.id).await.unwrap_err();
    assert_eq!(invalid_field(err), "entries");
    let err = add_invoice_entry(&f.db, second.id, theirs.id)
        .await
        .unwrap_err();
    assert_eq!(invalid_field(err), "entries", "another client's entry");
    let err = remove_invoice_entry(&f.db, second.id, a.id)
        .await
        .unwrap_err();
    assert_eq!(invalid_field(err), "entries", "not on this one");
    assert_eq!(
        ids(&get_invoice(&f.db, first.id).await.unwrap().entries),
        [a.id]
    );
}

#[tokio::test]
async fn draft_entries_stay_editable_and_deleting_one_drops_it_from_the_draft() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme", "85").await;
    let bolt = client(&f, "Bolt", "85").await;
    let a = log_on(&f, acme.id, None, "2026-10-05", "1").await;
    let b = log_on(&f, acme.id, None, "2026-10-06", "1").await;
    let c = log_on(&f, acme.id, None, "2026-10-06", "1").await;
    let d = create_draft(
        &f.db,
        &f.clock,
        draft(acme.id, "2026-10-01", "2026-10-07", vec![a.id, b.id, c.id]),
    )
    .await
    .unwrap();

    let longer = EntryInput {
        client_id: acme.id,
        project_id: None,
        date: "2026-10-05".into(),
        span: Span::Duration {
            duration: "2".into(),
        },
        note: None,
    };
    update_entry(&f.db, &f.clock, a.id, longer).await.unwrap();
    delete_entry(&f.db, b.id).await.unwrap();
    let moved = EntryInput {
        client_id: bolt.id,
        project_id: None,
        date: "2026-10-06".into(),
        span: Span::Duration {
            duration: "1".into(),
        },
        note: None,
    };
    update_entry(&f.db, &f.clock, c.id, moved).await.unwrap();

    let d = get_invoice(&f.db, d.id).await.unwrap();
    assert_eq!(
        ids(&d.entries),
        [a.id],
        "deleted and moved-to-another-client entries drop off"
    );
    assert_eq!(d.seconds, 2 * 3600);
    assert_eq!(
        ids(&draft_candidates(&f.db, &f.clock, bolt.id, None)
            .await
            .unwrap()
            .entries),
        [c.id]
    );
}

#[tokio::test]
async fn a_draft_counts_entries_logged_into_its_period_since_it_was_created() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme", "85").await;
    let unticked = log_on(&f, acme.id, None, "2026-10-05", "1").await;
    let removed = log_on(&f, acme.id, None, "2026-10-05", "1").await;
    let d = create_draft(
        &f.db,
        &f.clock,
        draft(acme.id, "2026-10-01", "2026-10-07", vec![removed.id]),
    )
    .await
    .unwrap();
    remove_invoice_entry(&f.db, d.id, removed.id).await.unwrap();
    assert_eq!(
        d.new_in_period, 0,
        "{} was left out on purpose",
        unticked.id
    );

    f.clock.set(f.clock.now_plus_minutes(5));
    log_on(&f, acme.id, None, "2026-10-06", "1").await;
    log_on(&f, acme.id, None, "2026-10-07", "1").await;
    log_on(&f, acme.id, None, "2026-09-30", "1").await;

    let d = get_invoice(&f.db, d.id).await.unwrap();
    assert_eq!(d.new_in_period, 2);
    assert_eq!(d.entries.len(), 0, "never auto-added");
}

#[tokio::test]
async fn presets_list_completed_months_and_the_last_two_weeks_up_to_today() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme", "85").await;
    let preset = |preset: Preset, offset| PeriodInput {
        preset,
        offset,
        start: None,
        end: None,
    };

    let weeks = draft_candidates(&f.db, &f.clock, acme.id, Some(&preset(Preset::TwoWeeks, 0)))
        .await
        .unwrap();
    let month = draft_candidates(&f.db, &f.clock, acme.id, Some(&preset(Preset::Month, -1)))
        .await
        .unwrap();

    assert_eq!(
        (weeks.period.start, weeks.period.end),
        (day("2026-09-28"), day("2026-10-07"))
    );
    assert_eq!(
        (month.period.start, month.period.end),
        (day("2026-09-01"), day("2026-09-30"))
    );
}

#[tokio::test]
async fn deleting_a_draft_frees_its_entries() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme", "85").await;
    let a = log_on(&f, acme.id, None, "2026-10-05", "1").await;
    let d = create_draft(
        &f.db,
        &f.clock,
        draft(acme.id, "2026-10-01", "2026-10-07", vec![a.id]),
    )
    .await
    .unwrap();

    delete_invoice(&f.db, d.id).await.unwrap();

    assert!(list_invoices(&f.db).await.unwrap().is_empty());
    assert!(matches!(
        get_invoice(&f.db, d.id).await,
        Err(CoreError::NotFound { .. })
    ));
    let c = draft_candidates(&f.db, &f.clock, acme.id, None)
        .await
        .unwrap();
    assert_eq!(ids(&c.entries), [a.id]);
}

#[tokio::test]
async fn timesheet_page_is_on_by_default_and_toggles() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme", "85").await;
    let d = create_draft(
        &f.db,
        &f.clock,
        draft(acme.id, "2026-10-01", "2026-10-07", vec![]),
    )
    .await
    .unwrap();
    assert!(d.timesheet);

    assert!(
        !set_invoice_timesheet(&f.db, d.id, false)
            .await
            .unwrap()
            .timesheet
    );
    assert!(!get_invoice(&f.db, d.id).await.unwrap().timesheet);
}

#[tokio::test]
async fn invoices_list_newest_first_with_totals() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme", "85").await;
    let bolt = client(&f, "Bolt", "120").await;
    let a = log_on(&f, acme.id, None, "2026-10-05", "1:30").await;
    let first = create_draft(
        &f.db,
        &f.clock,
        draft(acme.id, "2026-10-01", "2026-10-07", vec![a.id]),
    )
    .await
    .unwrap();
    let second = create_draft(
        &f.db,
        &f.clock,
        draft(bolt.id, "2026-09-01", "2026-09-30", vec![]),
    )
    .await
    .unwrap();

    let list = list_invoices(&f.db).await.unwrap();

    let rows: Vec<_> = list
        .iter()
        .map(|i| (i.id, i.client_name.as_str(), i.state, i.total_cents))
        .collect();
    assert_eq!(
        rows,
        [
            (second.id, "Bolt", State::Draft, 0),
            (first.id, "Acme", State::Draft, 12750),
        ]
    );
}

#[tokio::test]
async fn creating_a_draft_checks_client_and_period() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme", "85").await;

    let err = create_draft(
        &f.db,
        &f.clock,
        draft(999, "2026-10-01", "2026-10-07", vec![]),
    )
    .await
    .unwrap_err();
    assert_eq!(invalid_field(err), "client");
    let err = create_draft(
        &f.db,
        &f.clock,
        draft(acme.id, "2026-10-07", "2026-10-01", vec![]),
    )
    .await
    .unwrap_err();
    assert_eq!(invalid_field(err), "end");
}
