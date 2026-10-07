mod common;

use common::Fixture;
use quest_log_lib::core::clients::{create_client, list_clients, NewClient};
use quest_log_lib::core::CoreError;

fn new_client(name: &str, rate: &str) -> NewClient {
    NewClient {
        name: name.into(),
        rate: rate.into(),
    }
}

#[tokio::test]
async fn created_clients_are_listed_by_name() {
    let f = Fixture::new().await;

    let acme = create_client(&f.db, &f.clock, new_client("Acme", "85"))
        .await
        .unwrap();
    create_client(&f.db, &f.clock, new_client("Bolt Co", "120.50"))
        .await
        .unwrap();

    assert_eq!(acme.name, "Acme");
    assert_eq!(acme.rate_cents, 8500);

    let clients = list_clients(&f.db).await.unwrap();
    let summary: Vec<_> = clients
        .iter()
        .map(|c| (c.name.as_str(), c.rate_cents))
        .collect();
    assert_eq!(summary, [("Acme", 8500), ("Bolt Co", 12050)]);
}

#[tokio::test]
async fn clients_survive_a_restart() {
    let f = Fixture::new().await;
    create_client(&f.db, &f.clock, new_client("Acme", "85"))
        .await
        .unwrap();

    let f = f.restart().await;

    assert_eq!(list_clients(&f.db).await.unwrap().len(), 1);
}

#[tokio::test]
async fn name_is_trimmed_and_required() {
    let f = Fixture::new().await;

    let err = create_client(&f.db, &f.clock, new_client("   ", "85"))
        .await
        .unwrap_err();
    assert!(
        matches!(err, CoreError::Invalid { field: "name", .. }),
        "{err:?}"
    );

    let c = create_client(&f.db, &f.clock, new_client("  Acme ", "85"))
        .await
        .unwrap();
    assert_eq!(c.name, "Acme");
}

#[tokio::test]
async fn rate_accepts_dollars_and_cents_from_zero() {
    let f = Fixture::new().await;
    for (input, cents) in [
        ("0", 0),
        ("0.00", 0),
        ("$85", 8500),
        ("85.5", 8550),
        (" 1,250.99 ", 125099),
    ] {
        let c = create_client(&f.db, &f.clock, new_client("Acme", input))
            .await
            .unwrap();
        assert_eq!(c.rate_cents, cents, "input {input:?}");
    }
}

#[tokio::test]
async fn rate_rejects_missing_negative_and_malformed_input() {
    let f = Fixture::new().await;
    for input in ["", "  ", "-1", "abc", "1.234", "1.2.3", ".", "$"] {
        let err = create_client(&f.db, &f.clock, new_client("Acme", input))
            .await
            .unwrap_err();
        assert!(
            matches!(err, CoreError::Invalid { field: "rate", .. }),
            "input {input:?}: {err:?}"
        );
    }
    assert!(list_clients(&f.db).await.unwrap().is_empty());
}

#[tokio::test]
async fn errors_serialize_with_kind_field_and_message_for_the_ui() {
    let f = Fixture::new().await;
    let err = create_client(&f.db, &f.clock, new_client("Acme", ""))
        .await
        .unwrap_err();

    assert_eq!(
        serde_json::to_value(err).unwrap(),
        serde_json::json!({ "kind": "invalid", "field": "rate", "message": "Rate is required" })
    );
}
