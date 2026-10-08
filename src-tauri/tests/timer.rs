mod common;

use chrono::{DateTime, Duration, TimeZone, Utc};
use common::Fixture;
use quest_log_lib::core::clients::{create_client, Client, NewClient};
use quest_log_lib::core::time_entries::list_entries;
use quest_log_lib::core::time_entries::{EntryInput, Span};
use quest_log_lib::core::timer::{
    discard_timer, finish_timer, get_timer, start_timer, stop_timer, update_timer, Stopped,
    TimerEdit, TimerStart,
};
use quest_log_lib::core::CoreError;

async fn client(f: &Fixture, name: &str) -> Client {
    let input = NewClient {
        name: name.into(),
        rate: "85".into(),
    };
    create_client(&f.db, &f.clock, input).await.unwrap()
}

fn start(client_id: i64) -> TimerStart {
    TimerStart {
        client_id,
        project_id: None,
        note: None,
    }
}

fn utc(y: i32, mo: u32, d: u32, h: u32, mi: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(y, mo, d, h, mi, 0).unwrap()
}

fn saved(outcome: Stopped) -> quest_log_lib::core::time_entries::TimeEntry {
    match outcome {
        Stopped::Saved { entry } => entry,
        other => panic!("expected a saved entry, got {other:?}"),
    }
}

#[tokio::test]
async fn timer_survives_a_restart_and_stops_into_an_entry() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme").await;
    f.clock.set(utc(2026, 10, 7, 12, 0));

    let mut input = start(acme.id);
    input.note = Some(" Design ".into());
    start_timer(&f.db, &f.clock, input).await.unwrap();

    let f = f.restart().await;
    f.clock.set(utc(2026, 10, 7, 13, 30));
    let running = get_timer(&f.db).await.unwrap().unwrap();
    assert_eq!(running.client_name, "Acme");
    assert_eq!(running.note.as_deref(), Some("Design"));

    let entry = saved(stop_timer(&f.db, &f.clock).await.unwrap());
    assert_eq!(entry.seconds, 5400);
    assert_eq!(entry.date, "2026-10-07");
    assert_eq!(entry.started_at, Some(utc(2026, 10, 7, 12, 0).timestamp()));
    assert_eq!(entry.ended_at, Some(utc(2026, 10, 7, 13, 30).timestamp()));
    assert_eq!(entry.note.as_deref(), Some("Design"));

    assert!(get_timer(&f.db).await.unwrap().is_none());
    assert_eq!(list_entries(&f.db, None).await.unwrap().len(), 1);
}

#[tokio::test]
async fn starting_a_second_timer_saves_the_first_as_an_entry() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme").await;
    let bolt = client(&f, "Bolt").await;
    f.clock.set(utc(2026, 10, 7, 12, 0));
    start_timer(&f.db, &f.clock, start(acme.id)).await.unwrap();

    f.clock.set(utc(2026, 10, 7, 12, 45));
    let previous = start_timer(&f.db, &f.clock, start(bolt.id)).await.unwrap();

    let entry = saved(previous.unwrap());
    assert_eq!((entry.client_name.as_str(), entry.seconds), ("Acme", 2700));
    let running = get_timer(&f.db).await.unwrap().unwrap();
    assert_eq!(running.client_name, "Bolt");
    assert_eq!(
        running.started_at,
        utc(2026, 10, 7, 12, 45).timestamp_millis()
    );
}

#[tokio::test]
async fn starting_with_nothing_running_stops_nothing() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme").await;

    let previous = start_timer(&f.db, &f.clock, start(acme.id)).await.unwrap();

    assert!(previous.is_none());
}

#[tokio::test]
async fn a_timer_past_midnight_is_dated_by_its_start_day() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme").await;
    // 23:00 → 01:30 local (UTC−3).
    f.clock.set(utc(2026, 10, 7, 2, 0));
    start_timer(&f.db, &f.clock, start(acme.id)).await.unwrap();

    f.clock.set(utc(2026, 10, 7, 4, 30));
    let entry = saved(stop_timer(&f.db, &f.clock).await.unwrap());

    assert_eq!(entry.date, "2026-10-06");
    assert_eq!(entry.seconds, 9000);
}

#[tokio::test]
async fn sub_second_time_rounds_up() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme").await;
    let t0 = utc(2026, 10, 7, 12, 0);
    f.clock.set(t0);
    start_timer(&f.db, &f.clock, start(acme.id)).await.unwrap();

    f.clock.set(t0 + Duration::milliseconds(200));
    assert_eq!(saved(stop_timer(&f.db, &f.clock).await.unwrap()).seconds, 1);

    start_timer(&f.db, &f.clock, start(acme.id)).await.unwrap();
    f.clock.set(t0 + Duration::milliseconds(200 + 61_500));
    assert_eq!(
        saved(stop_timer(&f.db, &f.clock).await.unwrap()).seconds,
        62
    );
}

#[tokio::test]
async fn over_24_hours_needs_an_edit_and_keeps_the_timer() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme").await;
    f.clock.set(utc(2026, 10, 6, 12, 0));
    start_timer(&f.db, &f.clock, start(acme.id)).await.unwrap();
    f.clock.set(utc(2026, 10, 7, 13, 0));

    let Stopped::NeedsEdit { overlong } = stop_timer(&f.db, &f.clock).await.unwrap() else {
        panic!("expected needs-edit");
    };
    assert_eq!(
        (overlong.date.as_str(), overlong.seconds),
        ("2026-10-06", 25 * 3600)
    );
    assert!(
        get_timer(&f.db).await.unwrap().is_some(),
        "never auto-truncated or lost"
    );
    assert!(list_entries(&f.db, None).await.unwrap().is_empty());

    // Starting another Timer can't save it either, so it doesn't start.
    let bolt = client(&f, "Bolt").await;
    let previous = start_timer(&f.db, &f.clock, start(bolt.id)).await.unwrap();
    assert!(matches!(previous, Some(Stopped::NeedsEdit { .. })));
    assert_eq!(get_timer(&f.db).await.unwrap().unwrap().client_name, "Acme");

    // The editor saves only at 24 hours or less.
    let fixed = |duration: &str| EntryInput {
        client_id: acme.id,
        project_id: None,
        date: overlong.date.clone(),
        span: Span::Duration {
            duration: duration.into(),
        },
        note: None,
    };
    let err = finish_timer(&f.db, &f.clock, fixed("25:00"))
        .await
        .unwrap_err();
    assert!(matches!(
        err,
        CoreError::Invalid {
            field: "duration",
            ..
        }
    ));
    assert!(get_timer(&f.db).await.unwrap().is_some());

    let entry = finish_timer(&f.db, &f.clock, fixed("9:00")).await.unwrap();
    assert_eq!(entry.seconds, 9 * 3600);
    assert!(get_timer(&f.db).await.unwrap().is_none());
}

#[tokio::test]
async fn discard_records_nothing() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme").await;
    start_timer(&f.db, &f.clock, start(acme.id)).await.unwrap();
    f.clock.set(utc(2026, 10, 7, 10, 0));

    discard_timer(&f.db).await.unwrap();

    assert!(get_timer(&f.db).await.unwrap().is_none());
    assert!(list_entries(&f.db, None).await.unwrap().is_empty());
    assert!(matches!(
        stop_timer(&f.db, &f.clock).await,
        Err(CoreError::NotFound { .. })
    ));
}

#[tokio::test]
async fn patron_note_and_an_earlier_start_can_be_edited_while_running() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme").await;
    let bolt = client(&f, "Bolt").await;
    f.clock.set(utc(2026, 10, 7, 12, 0)); // 09:00 local
    start_timer(&f.db, &f.clock, start(acme.id)).await.unwrap();
    f.clock.set(utc(2026, 10, 7, 13, 0));

    let edited = update_timer(
        &f.db,
        &f.clock,
        TimerEdit {
            client_id: bolt.id,
            project_id: None,
            note: Some("Review".into()),
            start: Some("2026-10-07T08:15".into()),
        },
    )
    .await
    .unwrap();
    assert_eq!(edited.client_name, "Bolt");
    assert_eq!(edited.note.as_deref(), Some("Review"));
    assert_eq!(
        edited.started_at,
        utc(2026, 10, 7, 11, 15).timestamp_millis()
    );

    // Leaving the start out keeps it to the millisecond.
    let kept = update_timer(
        &f.db,
        &f.clock,
        TimerEdit {
            client_id: bolt.id,
            project_id: None,
            note: None,
            start: None,
        },
    )
    .await
    .unwrap();
    assert_eq!(kept.started_at, edited.started_at);
    assert_eq!(kept.note, None);

    let entry = saved(stop_timer(&f.db, &f.clock).await.unwrap());
    assert_eq!((entry.client_name.as_str(), entry.seconds), ("Bolt", 6300));
}

#[tokio::test]
async fn moving_the_start_later_is_rejected() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme").await;
    f.clock.set(utc(2026, 10, 7, 12, 0)); // 09:00 local
    start_timer(&f.db, &f.clock, start(acme.id)).await.unwrap();
    f.clock.set(utc(2026, 10, 7, 13, 0));

    let err = update_timer(
        &f.db,
        &f.clock,
        TimerEdit {
            client_id: acme.id,
            project_id: None,
            note: None,
            start: Some("2026-10-07T09:01".into()),
        },
    )
    .await
    .unwrap_err();

    assert!(matches!(err, CoreError::Invalid { field: "start", .. }));
    let running = get_timer(&f.db).await.unwrap().unwrap();
    assert_eq!(
        running.started_at,
        utc(2026, 10, 7, 12, 0).timestamp_millis()
    );
}
