mod common;

use chrono::NaiveDate;
use common::Fixture;
use quest_log_lib::core::clients::{create_client, NewClient};
use quest_log_lib::core::dashboard::{
    dashboard, period, Bucket, ClientFigures, Figures, Period, PeriodInput, Preset,
};
use quest_log_lib::core::projects::{create_project, ProjectInput};
use quest_log_lib::core::time_entries::{create_entry, EntryInput, Span};
use quest_log_lib::core::timer::{start_timer, TimerStart};
use quest_log_lib::core::CoreError;

fn day(text: &str) -> NaiveDate {
    text.parse().unwrap()
}

fn span(start: &str, end: &str) -> Period {
    Period {
        start: day(start),
        end: day(end),
    }
}

fn preset(preset: Preset, offset: i64) -> PeriodInput {
    PeriodInput {
        preset,
        offset,
        start: None,
        end: None,
    }
}

fn custom(start: &str, end: &str, offset: i64) -> PeriodInput {
    PeriodInput {
        preset: Preset::Custom,
        offset,
        start: Some(start.into()),
        end: Some(end.into()),
    }
}

// 2026-10-07 is a Wednesday; that week starts Monday 2026-10-05.
const WED: &str = "2026-10-07";

#[test]
fn one_week_is_this_monday_to_sunday_and_steps_by_a_week() {
    let today = day(WED);
    assert_eq!(
        period(&preset(Preset::OneWeek, 0), today).unwrap(),
        span("2026-10-05", "2026-10-11")
    );
    assert_eq!(
        period(&preset(Preset::OneWeek, -1), today).unwrap(),
        span("2026-09-28", "2026-10-04")
    );
    assert_eq!(
        period(&preset(Preset::OneWeek, 1), today).unwrap(),
        span("2026-10-12", "2026-10-18")
    );
}

#[test]
fn weeks_start_monday_even_on_a_monday_or_sunday() {
    let week = span("2026-10-05", "2026-10-11");
    assert_eq!(
        period(&preset(Preset::OneWeek, 0), day("2026-10-05")).unwrap(),
        week
    );
    assert_eq!(
        period(&preset(Preset::OneWeek, 0), day("2026-10-11")).unwrap(),
        week
    );
}

#[test]
fn two_and_three_weeks_end_this_week_and_step_by_their_length() {
    let today = day(WED);
    assert_eq!(
        period(&preset(Preset::TwoWeeks, 0), today).unwrap(),
        span("2026-09-28", "2026-10-11")
    );
    assert_eq!(
        period(&preset(Preset::TwoWeeks, -1), today).unwrap(),
        span("2026-09-14", "2026-09-27")
    );
    assert_eq!(
        period(&preset(Preset::ThreeWeeks, 0), today).unwrap(),
        span("2026-09-21", "2026-10-11")
    );
    assert_eq!(
        period(&preset(Preset::ThreeWeeks, -1), today).unwrap(),
        span("2026-08-31", "2026-09-20")
    );
}

#[test]
fn month_is_the_calendar_month_and_steps_by_months() {
    let today = day(WED);
    assert_eq!(
        period(&preset(Preset::Month, 0), today).unwrap(),
        span("2026-10-01", "2026-10-31")
    );
    assert_eq!(
        period(&preset(Preset::Month, -1), today).unwrap(),
        span("2026-09-01", "2026-09-30")
    );
    assert_eq!(
        period(&preset(Preset::Month, -8), today).unwrap(),
        span("2026-02-01", "2026-02-28")
    );
    assert_eq!(
        period(&preset(Preset::Month, 3), today).unwrap(),
        span("2027-01-01", "2027-01-31")
    );
}

#[test]
fn custom_is_its_own_days_and_steps_by_its_length() {
    let today = day(WED);
    assert_eq!(
        period(&custom("2026-10-01", "2026-10-10", 0), today).unwrap(),
        span("2026-10-01", "2026-10-10")
    );
    assert_eq!(
        period(&custom("2026-10-01", "2026-10-10", -1), today).unwrap(),
        span("2026-09-21", "2026-09-30")
    );
    assert_eq!(
        period(&custom("2026-10-07", "2026-10-07", 2), today).unwrap(),
        span("2026-10-09", "2026-10-09")
    );
}

#[test]
fn stepping_out_of_the_calendar_is_an_error_not_a_crash() {
    for p in [Preset::OneWeek, Preset::Month, Preset::Custom] {
        let input = PeriodInput {
            offset: i64::MIN,
            ..custom("2026-10-01", "2026-10-10", 0)
        };
        let input = PeriodInput { preset: p, ..input };
        assert!(matches!(
            period(&input, day(WED)),
            Err(CoreError::Invalid {
                field: "offset",
                ..
            })
        ));
    }
}

#[test]
fn custom_needs_both_dates_in_order() {
    let today = day(WED);
    let field = |input: PeriodInput| match period(&input, today) {
        Err(CoreError::Invalid { field, .. }) => field,
        other => panic!("expected invalid, got {other:?}"),
    };
    assert_eq!(field(custom("2026-10-10", "2026-10-01", 0)), "end");
    assert_eq!(field(custom("", "2026-10-01", 0)), "start");
    assert_eq!(
        field(PeriodInput {
            end: None,
            ..custom("2026-10-01", "x", 0)
        }),
        "end"
    );
}

async fn client(f: &Fixture, name: &str, rate: &str) -> i64 {
    let input = NewClient {
        name: name.into(),
        rate: rate.into(),
    };
    create_client(&f.db, &f.clock, input).await.unwrap().id
}

async fn log(f: &Fixture, client_id: i64, project_id: Option<i64>, date: &str, duration: &str) {
    let input = EntryInput {
        client_id,
        project_id,
        date: date.into(),
        span: Span::Duration {
            duration: duration.into(),
        },
        note: None,
    };
    create_entry(&f.db, &f.clock, input).await.unwrap();
}

/// Everything is uninvoiced until invoices exist.
fn uninvoiced(seconds: i64, cents: i64) -> Figures {
    Figures {
        seconds,
        earned_cents: cents,
        uninvoiced_cents: cents,
        invoiced_unpaid_cents: 0,
        paid_cents: 0,
    }
}

#[tokio::test]
async fn figures_use_effective_rates_overall_and_per_client_by_hours() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme", "85").await;
    let bolt = client(&f, "Bolt", "100").await;
    client(&f, "Idle", "50").await;
    let site = create_project(
        &f.db,
        &f.clock,
        acme,
        ProjectInput {
            name: "Website".into(),
            rate: "120".into(),
        },
    )
    .await
    .unwrap()
    .id;
    log(&f, acme, None, "2026-10-05", "1:30").await; // $127.50
    log(&f, acme, Some(site), "2026-10-07", "0:20").await; // $40.00
    log(&f, bolt, None, "2026-10-06", "2:10").await; // $216.666… → $216.67
    log(&f, bolt, None, "2026-10-04", "5:00").await; // last week: outside

    let d = dashboard(&f.db, &f.clock, &preset(Preset::OneWeek, 0))
        .await
        .unwrap();

    assert_eq!(d.period, span("2026-10-05", "2026-10-11"));
    assert_eq!(
        d.total,
        uninvoiced(5400 + 1200 + 7800, 12750 + 4000 + 21667)
    );
    assert_eq!(
        d.clients,
        vec![
            ClientFigures {
                client_id: bolt,
                client_name: "Bolt".into(),
                figures: uninvoiced(7800, 21667),
            },
            ClientFigures {
                client_id: acme,
                client_name: "Acme".into(),
                figures: uninvoiced(6600, 16750),
            },
        ]
    );
}

#[tokio::test]
async fn chart_has_a_bucket_per_day() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme", "85").await;
    log(&f, acme, None, "2026-10-05", "1:00").await;
    log(&f, acme, None, "2026-10-05", "0:30").await;
    log(&f, acme, None, "2026-10-07", "2:00").await;

    let d = dashboard(&f.db, &f.clock, &preset(Preset::OneWeek, 0))
        .await
        .unwrap();

    let seconds: Vec<(String, i64)> = d
        .buckets
        .iter()
        .map(|b| (b.start.to_string(), b.seconds))
        .collect();
    assert_eq!(
        seconds,
        [
            ("2026-10-05", 5400),
            ("2026-10-06", 0),
            ("2026-10-07", 7200),
            ("2026-10-08", 0),
            ("2026-10-09", 0),
            ("2026-10-10", 0),
            ("2026-10-11", 0),
        ]
        .map(|(d, s)| (d.to_string(), s))
    );
}

#[tokio::test]
async fn chart_has_a_bucket_per_monday_week_for_long_ranges() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme", "85").await;
    log(&f, acme, None, "2026-08-02", "1:00").await; // Sunday, in the first partial week
    log(&f, acme, None, "2026-08-03", "2:00").await; // Monday
    log(&f, acme, None, "2026-10-07", "3:00").await;

    // Sat Aug 1 – Wed Oct 7: 68 days.
    let d = dashboard(&f.db, &f.clock, &custom("2026-08-01", "2026-10-07", 0))
        .await
        .unwrap();

    assert!(d.weekly);
    assert_eq!(d.buckets.len(), 11);
    assert_eq!(
        d.buckets[0],
        Bucket {
            start: day("2026-08-01"),
            seconds: 3600
        }
    );
    assert_eq!(
        d.buckets[1],
        Bucket {
            start: day("2026-08-03"),
            seconds: 7200
        }
    );
    assert_eq!(
        d.buckets[10],
        Bucket {
            start: day("2026-10-05"),
            seconds: 10800
        }
    );
}

#[tokio::test]
async fn six_weeks_still_charts_by_day() {
    let f = Fixture::new().await;
    let d = dashboard(&f.db, &f.clock, &custom("2026-08-27", "2026-10-07", 0))
        .await
        .unwrap();
    assert!(!d.weekly);
    assert_eq!(d.buckets.len(), 42);
}

#[tokio::test]
async fn running_timer_counts_live_as_unclaimed_on_its_start_day() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme", "60").await;
    log(&f, acme, None, "2026-09-01", "1:00").await; // outside the week, in all-time
    let start = TimerStart {
        client_id: acme,
        project_id: None,
        note: None,
    };
    start_timer(&f.db, &f.clock, start).await.unwrap();
    f.clock.set(f.clock.now_plus_minutes(90));

    let d = dashboard(&f.db, &f.clock, &preset(Preset::OneWeek, 0))
        .await
        .unwrap();

    assert_eq!(d.total, uninvoiced(5400, 9000));
    assert_eq!(d.clients[0].figures, uninvoiced(5400, 9000));
    assert_eq!(
        d.buckets[2],
        Bucket {
            start: day(WED),
            seconds: 5400
        }
    );
    assert_eq!(d.all_time.uninvoiced_cents, 6000 + 9000);
    assert_eq!(d.all_time.invoiced_unpaid_cents, 0);
    assert_eq!(d.all_time.overdue, 0);
}

#[tokio::test]
async fn empty_period_is_zeros_with_an_empty_chart() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme", "85").await;
    log(&f, acme, None, "2026-09-01", "1:00").await;

    let d = dashboard(&f.db, &f.clock, &preset(Preset::Month, 0))
        .await
        .unwrap();

    assert_eq!(d.total, uninvoiced(0, 0));
    assert!(d.clients.is_empty());
    assert_eq!(d.buckets.len(), 31);
    assert!(d.buckets.iter().all(|b| b.seconds == 0));
    assert_eq!(d.all_time.uninvoiced_cents, 8500);
}
