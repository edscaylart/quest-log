mod common;

use common::Fixture;
use quest_log_lib::core::clients::{create_client, Client, NewClient};
use quest_log_lib::core::time_entries::{
    create_entry, delete_entry, last_used_client, list_entries, update_entry, EntryInput, Span,
};
use quest_log_lib::core::CoreError;

async fn client(f: &Fixture, name: &str) -> Client {
    let input = NewClient {
        name: name.into(),
        rate: "85".into(),
    };
    create_client(&f.db, &f.clock, input).await.unwrap()
}

fn by_duration(client_id: i64, date: &str, duration: &str) -> EntryInput {
    EntryInput {
        client_id,
        date: date.into(),
        span: Span::Duration {
            duration: duration.into(),
        },
        note: None,
    }
}

#[tokio::test]
async fn entry_by_duration_is_listed() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme").await;

    let mut input = by_duration(acme.id, "2026-10-06", "1:30");
    input.note = Some("  Kickoff call ".into());
    let entry = create_entry(&f.db, &f.clock, input).await.unwrap();

    assert_eq!(entry.seconds, 5400);
    assert_eq!(entry.date, "2026-10-06");
    assert_eq!(entry.note.as_deref(), Some("Kickoff call"));
    assert_eq!(entry.client_name, "Acme");
    assert_eq!(entry.started_at, None);

    let listed = list_entries(&f.db, None).await.unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, entry.id);
}

fn by_range(client_id: i64, date: &str, start: &str, end: &str) -> EntryInput {
    EntryInput {
        client_id,
        date: date.into(),
        span: Span::Range {
            start: start.into(),
            end: end.into(),
        },
        note: None,
    }
}

#[tokio::test]
async fn entry_by_start_and_end_computes_duration_in_local_time() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme").await;

    let entry = create_entry(
        &f.db,
        &f.clock,
        by_range(acme.id, "2026-10-06", "09:15", "17:45"),
    )
    .await
    .unwrap();

    assert_eq!(entry.seconds, 8 * 3600 + 30 * 60);
    // Fake clock is UTC−3: 09:15 local is 12:15 UTC.
    assert_eq!(entry.started_at, Some(utc(2026, 10, 6, 12, 15)));
    assert_eq!(entry.ended_at, Some(utc(2026, 10, 6, 20, 45)));
}

#[tokio::test]
async fn end_before_start_runs_past_midnight_and_keeps_the_start_day() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme").await;

    let entry = create_entry(
        &f.db,
        &f.clock,
        by_range(acme.id, "2026-10-05", "22:00", "01:30"),
    )
    .await
    .unwrap();

    assert_eq!(entry.seconds, 3 * 3600 + 30 * 60);
    assert_eq!(entry.date, "2026-10-05");
    assert_eq!(entry.ended_at, Some(utc(2026, 10, 6, 4, 30)));
}

fn invalid_field(err: CoreError) -> &'static str {
    match err {
        CoreError::Invalid { field, .. } => field,
        other => panic!("expected a validation error, got {other:?}"),
    }
}

#[tokio::test]
async fn future_dates_are_rejected_by_the_local_day() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme").await;
    // 01:00 UTC on the 8th is still 22:00 on the 7th locally.
    f.clock
        .set(chrono::DateTime::from_timestamp(utc(2026, 10, 8, 1, 0), 0).unwrap());

    let err = create_entry(&f.db, &f.clock, by_duration(acme.id, "2026-10-08", "1:00"))
        .await
        .unwrap_err();
    assert_eq!(err.to_string(), "date: Date can't be in the future");

    create_entry(&f.db, &f.clock, by_duration(acme.id, "2026-10-07", "1:00"))
        .await
        .expect("today is fine");
}

#[tokio::test]
async fn duration_must_be_more_than_zero_and_at_most_24_hours() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme").await;
    let create = |input| create_entry(&f.db, &f.clock, input);

    for (input, message) in [
        (
            by_duration(acme.id, "2026-10-06", "0:00"),
            "duration: Duration must be more than 0",
        ),
        (
            by_duration(acme.id, "2026-10-06", "24:01"),
            "duration: Duration can't be more than 24 hours",
        ),
        (
            by_range(acme.id, "2026-10-06", "09:00", "09:00"),
            "end: Duration must be more than 0",
        ),
        (
            by_duration(acme.id, "2026-10-06", "abc"),
            "duration: Duration must look like 1:30 or 1.5",
        ),
    ] {
        assert_eq!(create(input).await.unwrap_err().to_string(), message);
    }

    for (ok, seconds) in [
        ("24:00", 86400),
        ("0:01", 60),
        ("0.5", 1800),
        ("1:00:30", 3630),
    ] {
        let entry = create(by_duration(acme.id, "2026-10-06", ok))
            .await
            .expect(ok);
        assert_eq!(entry.seconds, seconds, "input {ok:?}");
    }
}

#[tokio::test]
async fn overlapping_entries_are_accepted() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme").await;

    for _ in 0..2 {
        create_entry(
            &f.db,
            &f.clock,
            by_range(acme.id, "2026-10-06", "09:00", "12:00"),
        )
        .await
        .unwrap();
    }

    assert_eq!(list_entries(&f.db, None).await.unwrap().len(), 2);
}

#[tokio::test]
async fn client_must_exist() {
    let f = Fixture::new().await;

    let err = create_entry(&f.db, &f.clock, by_duration(99, "2026-10-06", "1:00"))
        .await
        .unwrap_err();

    assert_eq!(invalid_field(err), "client");
}

#[tokio::test]
async fn edit_replaces_every_field_and_is_validated() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme").await;
    let bolt = client(&f, "Bolt").await;
    let entry = create_entry(
        &f.db,
        &f.clock,
        by_range(acme.id, "2026-10-06", "09:00", "10:00"),
    )
    .await
    .unwrap();

    let mut input = by_duration(bolt.id, "2026-10-05", "2:15");
    input.note = Some("Moved".into());
    let edited = update_entry(&f.db, &f.clock, entry.id, input)
        .await
        .unwrap();

    assert_eq!(edited.id, entry.id);
    assert_eq!(
        (
            edited.client_name.as_str(),
            edited.date.as_str(),
            edited.seconds
        ),
        ("Bolt", "2026-10-05", 8100)
    );
    assert_eq!(
        (edited.started_at, edited.note.as_deref()),
        (None, Some("Moved"))
    );

    let err = update_entry(
        &f.db,
        &f.clock,
        entry.id,
        by_duration(bolt.id, "2026-10-05", "0"),
    )
    .await
    .unwrap_err();
    assert_eq!(invalid_field(err), "duration");
    assert_eq!(list_entries(&f.db, None).await.unwrap()[0].seconds, 8100);
}

#[tokio::test]
async fn delete_removes_the_entry() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme").await;
    let entry = create_entry(&f.db, &f.clock, by_duration(acme.id, "2026-10-06", "1:00"))
        .await
        .unwrap();

    delete_entry(&f.db, entry.id).await.unwrap();

    assert!(list_entries(&f.db, None).await.unwrap().is_empty());
    let err = delete_entry(&f.db, entry.id).await.unwrap_err();
    assert!(matches!(err, CoreError::NotFound { .. }), "{err:?}");
    let err = update_entry(
        &f.db,
        &f.clock,
        entry.id,
        by_duration(acme.id, "2026-10-06", "1:00"),
    )
    .await
    .unwrap_err();
    assert!(matches!(err, CoreError::NotFound { .. }), "{err:?}");
}

#[tokio::test]
async fn list_is_newest_day_first_and_filters_by_client() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme").await;
    let bolt = client(&f, "Bolt").await;
    for input in [
        by_range(acme.id, "2026-10-05", "09:00", "10:00"),
        by_range(bolt.id, "2026-10-06", "08:00", "09:00"),
        by_range(acme.id, "2026-10-06", "14:00", "15:00"),
        by_duration(acme.id, "2026-10-04", "1:00"),
    ] {
        create_entry(&f.db, &f.clock, input).await.unwrap();
    }

    let summary = |entries: Vec<quest_log_lib::core::time_entries::TimeEntry>| {
        entries
            .into_iter()
            .map(|e| format!("{} {}", e.date, e.client_name))
            .collect::<Vec<_>>()
    };
    assert_eq!(
        summary(list_entries(&f.db, None).await.unwrap()),
        [
            "2026-10-06 Acme",
            "2026-10-06 Bolt",
            "2026-10-05 Acme",
            "2026-10-04 Acme"
        ]
    );
    assert_eq!(
        summary(list_entries(&f.db, Some(bolt.id)).await.unwrap()),
        ["2026-10-06 Bolt"]
    );
}

#[tokio::test]
async fn last_used_client_is_the_one_most_recently_logged() {
    let f = Fixture::new().await;
    assert_eq!(last_used_client(&f.db).await.unwrap(), None);
    let acme = client(&f, "Acme").await;
    let bolt = client(&f, "Bolt").await;

    create_entry(&f.db, &f.clock, by_duration(bolt.id, "2026-10-06", "1:00"))
        .await
        .unwrap();
    create_entry(&f.db, &f.clock, by_duration(acme.id, "2026-10-01", "1:00"))
        .await
        .unwrap();

    assert_eq!(last_used_client(&f.db).await.unwrap(), Some(acme.id));
}

fn utc(y: i32, mo: u32, d: u32, h: u32, mi: u32) -> i64 {
    use chrono::TimeZone;
    chrono::Utc
        .with_ymd_and_hms(y, mo, d, h, mi, 0)
        .unwrap()
        .timestamp()
}
