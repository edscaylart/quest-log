mod common;

use common::Fixture;
use quest_log_lib::core::clients::{
    create_client, get_client, preview_client_rate, update_client, Client, ClientEdit, NewClient,
    Repricing,
};
use quest_log_lib::core::projects::{
    create_project, delete_project, list_projects, preview_project_rate, set_project_complete,
    update_project, Project, ProjectInput,
};
use quest_log_lib::core::time_entries::{
    create_entry, last_used, list_entries, update_entry, EntryInput, LastUsed, Span, TimeEntry,
};
use quest_log_lib::core::timer::{
    start_timer, stop_timer, update_timer, Stopped, TimerEdit, TimerStart,
};
use quest_log_lib::core::CoreError;

async fn client(f: &Fixture, name: &str, rate: &str) -> Client {
    let input = NewClient {
        name: name.into(),
        rate: rate.into(),
    };
    create_client(&f.db, &f.clock, input).await.unwrap()
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

fn entry(client_id: i64, project_id: Option<i64>, duration: &str) -> EntryInput {
    EntryInput {
        client_id,
        project_id,
        date: "2026-10-06".into(),
        span: Span::Duration {
            duration: duration.into(),
        },
        note: None,
    }
}

async fn log(f: &Fixture, client_id: i64, project_id: Option<i64>, duration: &str) -> TimeEntry {
    create_entry(&f.db, &f.clock, entry(client_id, project_id, duration))
        .await
        .unwrap()
}

fn edit(c: &Client, rate: &str) -> ClientEdit {
    ClientEdit {
        name: c.name.clone(),
        rate: rate.into(),
        billing_name: String::new(),
        address: String::new(),
        email: String::new(),
        net_days: String::new(),
    }
}

fn quest(name: &str, rate: &str) -> ProjectInput {
    ProjectInput {
        name: name.into(),
        rate: rate.into(),
    }
}

async fn rates(f: &Fixture) -> Vec<i64> {
    let mut entries = list_entries(&f.db, None).await.unwrap();
    entries.sort_by_key(|e| e.id);
    entries.iter().map(|e| e.rate_cents).collect()
}

fn invalid_field(err: CoreError) -> &'static str {
    match err {
        CoreError::Invalid { field, .. } => field,
        other => panic!("expected invalid, got {other:?}"),
    }
}

#[tokio::test]
async fn entry_rate_is_its_quest_rate_if_set_else_its_client_rate() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme", "85").await;
    let site = project(&f, acme.id, "Website", "120").await;
    let support = project(&f, acme.id, "Support", "").await;
    let pro_bono = project(&f, acme.id, "Pro bono", "0").await;

    assert_eq!(site.rate_cents, Some(12000));
    assert_eq!(support.rate_cents, None);
    assert_eq!(pro_bono.rate_cents, Some(0));
    assert_eq!(
        [
            site.effective_rate_cents,
            support.effective_rate_cents,
            pro_bono.effective_rate_cents
        ],
        [12000, 8500, 0]
    );

    let rates: Vec<_> = [
        log(&f, acme.id, Some(site.id), "1").await,
        log(&f, acme.id, Some(support.id), "1").await,
        log(&f, acme.id, Some(pro_bono.id), "1").await,
        log(&f, acme.id, None, "1").await,
    ]
    .iter()
    .map(|e| (e.project_name.clone(), e.rate_cents))
    .collect();
    assert_eq!(
        rates,
        [
            (Some("Website".into()), 12000),
            (Some("Support".into()), 8500),
            (Some("Pro bono".into()), 0),
            (None, 8500),
        ]
    );
}

#[tokio::test]
async fn rate_changes_reprice_existing_time_live() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme", "85").await;
    let site = project(&f, acme.id, "Website", "").await;
    log(&f, acme.id, None, "1").await;
    log(&f, acme.id, Some(site.id), "1").await;

    update_client(&f.db, acme.id, edit(&acme, "100"))
        .await
        .unwrap();
    assert_eq!(rates(&f).await, [10000, 10000]);

    update_project(&f.db, site.id, quest("Website", "0"))
        .await
        .unwrap();
    assert_eq!(rates(&f).await, [10000, 0], "$0 Quest bills nothing");

    update_client(&f.db, acme.id, edit(&acme, "50"))
        .await
        .unwrap();
    assert_eq!(
        rates(&f).await,
        [5000, 0],
        "Quest rate overrides the client's"
    );

    update_project(&f.db, site.id, quest("Website", ""))
        .await
        .unwrap();
    assert_eq!(
        rates(&f).await,
        [5000, 5000],
        "clearing it falls back to the client's"
    );
}

#[tokio::test]
async fn client_rate_preview_counts_only_time_following_the_client_rate() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme", "60").await;
    let site = project(&f, acme.id, "Website", "").await;
    let fixed = project(&f, acme.id, "Fixed", "200").await;
    log(&f, acme.id, None, "10").await;
    log(&f, acme.id, Some(site.id), "2:30").await;
    log(&f, acme.id, Some(fixed.id), "5").await;
    let bolt = client(&f, "Bolt", "60").await;
    log(&f, bolt.id, None, "3").await;

    let preview = preview_client_rate(&f.db, acme.id, "70").await.unwrap();

    // 12.5 hours: $750 → $875, as in the spec's example.
    assert_eq!(
        preview,
        Repricing {
            seconds: 45_000,
            old_cents: 75_000,
            new_cents: 87_500
        }
    );
    assert_eq!(
        get_client(&f.db, acme.id).await.unwrap().rate_cents,
        6000,
        "preview changes nothing"
    );
}

#[tokio::test]
async fn project_rate_preview_rounds_each_total_once_to_the_cent() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme", "85").await;
    let site = project(&f, acme.id, "Website", "").await;
    log(&f, acme.id, Some(site.id), "0:20").await;
    log(&f, acme.id, Some(site.id), "0:01:01").await;
    log(&f, acme.id, None, "1").await;

    // 1261 s at $85/hr = $29.774… → $29.77; at $33.34/hr = $11.678… → $11.68.
    assert_eq!(
        preview_project_rate(&f.db, site.id, "33.34").await.unwrap(),
        Repricing {
            seconds: 1261,
            old_cents: 2977,
            new_cents: 1168
        }
    );
    let err = preview_project_rate(&f.db, site.id, "-1")
        .await
        .unwrap_err();
    assert_eq!(invalid_field(err), "rate");
}

#[tokio::test]
async fn entries_reject_a_quest_of_another_client_or_a_complete_one() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme", "85").await;
    let bolt = client(&f, "Bolt", "85").await;
    let bolt_site = project(&f, bolt.id, "Bolt site", "").await;
    let done = project(&f, acme.id, "Done", "").await;
    let kept = log(&f, acme.id, Some(done.id), "1").await;
    set_project_complete(&f.db, done.id, true).await.unwrap();

    let err = create_entry(&f.db, &f.clock, entry(acme.id, Some(bolt_site.id), "1"))
        .await
        .unwrap_err();
    assert_eq!(invalid_field(err), "project");
    let err = create_entry(&f.db, &f.clock, entry(acme.id, Some(done.id), "1"))
        .await
        .unwrap_err();
    assert_eq!(invalid_field(err), "project");

    // An entry already on a now-complete Quest can still be edited in place.
    let edited = update_entry(&f.db, &f.clock, kept.id, entry(acme.id, Some(done.id), "2"))
        .await
        .unwrap();
    assert_eq!(edited.seconds, 7200);
    let err = update_entry(&f.db, &f.clock, kept.id, entry(bolt.id, Some(done.id), "2"))
        .await
        .unwrap_err();
    assert_eq!(
        invalid_field(err),
        "project",
        "moving client must drop the Quest"
    );
}

#[tokio::test]
async fn timer_carries_its_quest_into_the_entry_and_rejects_bad_ones() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme", "85").await;
    let bolt = client(&f, "Bolt", "85").await;
    let site = project(&f, acme.id, "Website", "").await;
    let other = project(&f, bolt.id, "Other", "").await;

    let start = |client_id, project_id| TimerStart {
        client_id,
        project_id,
        note: None,
    };
    let err = start_timer(&f.db, &f.clock, start(acme.id, Some(other.id)))
        .await
        .unwrap_err();
    assert_eq!(invalid_field(err), "project");

    start_timer(&f.db, &f.clock, start(acme.id, None))
        .await
        .unwrap();
    let err = update_timer(
        &f.db,
        &f.clock,
        TimerEdit {
            client_id: acme.id,
            project_id: Some(other.id),
            note: None,
            start: None,
        },
    )
    .await
    .unwrap_err();
    assert_eq!(invalid_field(err), "project");
    let running = update_timer(
        &f.db,
        &f.clock,
        TimerEdit {
            client_id: acme.id,
            project_id: Some(site.id),
            note: None,
            start: None,
        },
    )
    .await
    .unwrap();
    assert_eq!(running.project_name.as_deref(), Some("Website"));

    f.clock.set(f.clock.now_plus_minutes(30));
    let Stopped::Saved { entry } = stop_timer(&f.db, &f.clock).await.unwrap() else {
        panic!("expected saved");
    };
    assert_eq!(entry.project_id, Some(site.id));
}

#[tokio::test]
async fn last_used_keeps_the_quest_unless_it_is_complete() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme", "85").await;
    let site = project(&f, acme.id, "Website", "").await;
    log(&f, acme.id, Some(site.id), "1").await;

    let used = |project_id| {
        Some(LastUsed {
            client_id: acme.id,
            project_id,
        })
    };
    assert_eq!(last_used(&f.db).await.unwrap(), used(Some(site.id)));
    set_project_complete(&f.db, site.id, true).await.unwrap();
    assert_eq!(last_used(&f.db).await.unwrap(), used(None));
}

#[tokio::test]
async fn quests_list_active_first_and_reopen() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme", "85").await;
    let alpha = project(&f, acme.id, "Alpha", "").await;
    project(&f, acme.id, "Beta", "").await;
    let other = client(&f, "Bolt", "85").await;
    project(&f, other.id, "Elsewhere", "").await;

    let done = set_project_complete(&f.db, alpha.id, true).await.unwrap();
    assert!(done.complete);
    let names = |list: Vec<Project>| {
        list.into_iter()
            .map(|p| (p.name, p.complete))
            .collect::<Vec<_>>()
    };
    assert_eq!(
        names(list_projects(&f.db, acme.id).await.unwrap()),
        [("Beta".into(), false), ("Alpha".into(), true)]
    );

    set_project_complete(&f.db, alpha.id, false).await.unwrap();
    assert_eq!(
        names(list_projects(&f.db, acme.id).await.unwrap()),
        [("Alpha".into(), false), ("Beta".into(), false)]
    );
}

#[tokio::test]
async fn quest_name_is_required_and_rate_must_be_valid() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme", "85").await;
    let err = create_project(&f.db, &f.clock, acme.id, quest("  ", ""))
        .await
        .unwrap_err();
    assert_eq!(invalid_field(err), "name");
    let err = create_project(&f.db, &f.clock, acme.id, quest("Site", "-5"))
        .await
        .unwrap_err();
    assert_eq!(invalid_field(err), "rate");
    let err = create_project(&f.db, &f.clock, 999, quest("Site", ""))
        .await
        .unwrap_err();
    assert!(matches!(err, CoreError::NotFound { .. }), "{err:?}");
}

#[tokio::test]
async fn only_a_quest_without_time_can_be_deleted() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme", "85").await;
    let empty = project(&f, acme.id, "Empty", "").await;
    let used = project(&f, acme.id, "Used", "").await;
    log(&f, acme.id, Some(used.id), "1").await;

    delete_project(&f.db, empty.id).await.unwrap();
    let err = delete_project(&f.db, used.id).await.unwrap_err();
    assert_eq!(invalid_field(err), "project");
    assert_eq!(list_projects(&f.db, acme.id).await.unwrap().len(), 1);
}

#[tokio::test]
async fn client_billing_details_are_saved_trimmed_and_blank_is_none() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme", "85").await;

    let saved = update_client(
        &f.db,
        acme.id,
        ClientEdit {
            name: " Acme ".into(),
            rate: "90".into(),
            billing_name: " Acme Corp LLC ".into(),
            address: "1 Main St\nSpringfield".into(),
            email: " ap@acme.test ".into(),
            net_days: " 15 ".into(),
        },
    )
    .await
    .unwrap();
    assert_eq!(saved.name, "Acme");
    assert_eq!(saved.rate_cents, 9000);
    assert_eq!(saved.billing_name.as_deref(), Some("Acme Corp LLC"));
    assert_eq!(saved.address.as_deref(), Some("1 Main St\nSpringfield"));
    assert_eq!(saved.email.as_deref(), Some("ap@acme.test"));
    assert_eq!(saved.net_days, Some(15));

    let cleared = update_client(&f.db, acme.id, edit(&saved, "90"))
        .await
        .unwrap();
    assert_eq!(
        (cleared.billing_name, cleared.email, cleared.net_days),
        (None, None, None)
    );
}

#[tokio::test]
async fn client_edit_rejects_bad_fields() {
    let f = Fixture::new().await;
    let acme = client(&f, "Acme", "85").await;
    for (change, field) in [
        (
            Box::new(|e: &mut ClientEdit| e.name = " ".into()) as Box<dyn Fn(&mut ClientEdit)>,
            "name",
        ),
        (Box::new(|e: &mut ClientEdit| e.rate = "x".into()), "rate"),
        (
            Box::new(|e: &mut ClientEdit| e.email = "nope".into()),
            "email",
        ),
        (
            Box::new(|e: &mut ClientEdit| e.net_days = "-1".into()),
            "netDays",
        ),
        (
            Box::new(|e: &mut ClientEdit| e.net_days = "1.5".into()),
            "netDays",
        ),
    ] {
        let mut input = edit(&acme, "85");
        change(&mut input);
        let err = update_client(&f.db, acme.id, input).await.unwrap_err();
        assert_eq!(invalid_field(err), field);
    }
}
