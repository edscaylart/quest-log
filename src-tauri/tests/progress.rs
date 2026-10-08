mod common;

use common::Fixture;
use quest_log_lib::core::clients::{create_client, NewClient};
use quest_log_lib::core::progress::{acknowledge_level_up, level_for, progress, Progress};
use quest_log_lib::core::time_entries::{create_entry, delete_entry, EntryInput, Span, TimeEntry};
use quest_log_lib::core::timer::{start_timer, TimerStart};

const HOUR: i64 = 60;

async fn acme(f: &Fixture) -> i64 {
    let input = NewClient {
        name: "Acme".into(),
        rate: "85".into(),
    };
    create_client(&f.db, &f.clock, input).await.unwrap().id
}

async fn log(f: &Fixture, client_id: i64, duration: &str) -> TimeEntry {
    let input = EntryInput {
        client_id,
        project_id: None,
        date: "2026-10-06".into(),
        span: Span::Duration {
            duration: duration.into(),
        },
        note: None,
    };
    create_entry(&f.db, &f.clock, input).await.unwrap()
}

#[test]
fn levels_follow_five_l_times_l_minus_one_hours() {
    assert_eq!(level_for(0), 1);
    assert_eq!(level_for(10 * HOUR - 1), 1);
    assert_eq!(level_for(10 * HOUR), 2);
    assert_eq!(level_for(30 * HOUR), 3);
    assert_eq!(level_for(100 * HOUR - 1), 4);
    assert_eq!(level_for(100 * HOUR), 5);
    assert_eq!(level_for(450 * HOUR - 1), 9);
    assert_eq!(level_for(450 * HOUR), 10);
    // No cap.
    assert_eq!(level_for(5 * 100 * 99 * HOUR), 100);
}

#[tokio::test]
async fn starts_at_level_one_with_nothing_to_celebrate() {
    let f = Fixture::new().await;

    assert_eq!(
        progress(&f.db).await.unwrap(),
        Progress {
            level: 1,
            xp: 0,
            level_xp: 0,
            next_level_xp: 10 * HOUR,
            level_up: None,
        }
    );
}

#[tokio::test]
async fn xp_is_one_per_whole_tracked_minute_and_ignores_the_running_timer() {
    let f = Fixture::new().await;
    let acme = acme(&f).await;
    log(&f, acme, "1:30").await;
    log(&f, acme, "0:45").await;
    let start = TimerStart {
        client_id: acme,
        project_id: None,
        note: None,
    };
    start_timer(&f.db, &f.clock, start).await.unwrap();
    f.clock.set(f.clock.now_plus_minutes(600));

    let p = progress(&f.db).await.unwrap();

    assert_eq!(p.xp, 135);
    assert_eq!(p.level, 1);
}

#[tokio::test]
async fn reaching_a_new_level_is_pending_until_acknowledged() {
    let f = Fixture::new().await;
    let acme = acme(&f).await;
    log(&f, acme, "10:00").await;

    let p = progress(&f.db).await.unwrap();
    assert_eq!(
        p,
        Progress {
            level: 2,
            xp: 10 * HOUR,
            level_xp: 10 * HOUR,
            next_level_xp: 30 * HOUR,
            level_up: Some(2),
        }
    );

    acknowledge_level_up(&f.db, 2).await.unwrap();
    assert_eq!(progress(&f.db).await.unwrap().level_up, None);
}

#[tokio::test]
async fn a_multi_level_jump_is_one_level_up_for_the_final_level() {
    let f = Fixture::new().await;
    let acme = acme(&f).await;
    log(&f, acme, "20:00").await;
    log(&f, acme, "20:00").await;

    let p = progress(&f.db).await.unwrap();
    assert_eq!((p.level, p.level_up), (3, Some(3)));

    acknowledge_level_up(&f.db, 3).await.unwrap();
    assert_eq!(progress(&f.db).await.unwrap().level_up, None);
}

#[tokio::test]
async fn level_drops_after_deleting_entries_and_regaining_it_is_not_celebrated() {
    let f = Fixture::new().await;
    let acme = acme(&f).await;
    let entry = log(&f, acme, "10:00").await;
    acknowledge_level_up(&f.db, 2).await.unwrap();

    delete_entry(&f.db, entry.id).await.unwrap();
    let p = progress(&f.db).await.unwrap();
    assert_eq!((p.level, p.xp, p.level_up), (1, 0, None));

    log(&f, acme, "10:00").await;
    let p = progress(&f.db).await.unwrap();
    assert_eq!((p.level, p.level_up), (2, None));
}

#[tokio::test]
async fn acknowledging_a_lower_level_keeps_the_highest() {
    let f = Fixture::new().await;
    let acme = acme(&f).await;
    log(&f, acme, "20:00").await;
    log(&f, acme, "20:00").await;
    acknowledge_level_up(&f.db, 3).await.unwrap();

    acknowledge_level_up(&f.db, 2).await.unwrap();

    assert_eq!(progress(&f.db).await.unwrap().level_up, None);
}
