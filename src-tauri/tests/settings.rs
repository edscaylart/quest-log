mod common;

use common::Fixture;
use quest_log_lib::core::settings::{get_settings, update_settings, Settings, SettingsEdit};
use quest_log_lib::core::CoreError;

fn edit() -> SettingsEdit {
    SettingsEdit {
        name: "Ed Souza".into(),
        business_name: "Souza Dev".into(),
        address: "1 Main St\nSpringfield".into(),
        email: "ed@example.com".into(),
        tax_id: "12-3456789".into(),
        payment_instructions: "Wire to account 123".into(),
        net_days: "15".into(),
        invoice_prefix: "SD-".into(),
        next_invoice_number: "42".into(),
    }
}

fn invalid_field(err: CoreError) -> &'static str {
    match err {
        CoreError::Invalid { field, .. } => field,
        other => panic!("expected invalid, got {other:?}"),
    }
}

#[tokio::test]
async fn a_fresh_database_has_the_defaults() {
    let f = Fixture::new().await;

    assert_eq!(
        get_settings(&f.db).await.unwrap(),
        Settings {
            name: String::new(),
            business_name: None,
            address: None,
            email: None,
            tax_id: None,
            payment_instructions: None,
            net_days: 30,
            invoice_prefix: "INV-".into(),
            next_invoice_number: 1,
        }
    );
}

#[tokio::test]
async fn every_field_is_saved_and_survives_a_restart() {
    let f = Fixture::new().await;

    let saved = update_settings(&f.db, edit()).await.unwrap();
    let f = f.restart().await;

    let expected = Settings {
        name: "Ed Souza".into(),
        business_name: Some("Souza Dev".into()),
        address: Some("1 Main St\nSpringfield".into()),
        email: Some("ed@example.com".into()),
        tax_id: Some("12-3456789".into()),
        payment_instructions: Some("Wire to account 123".into()),
        net_days: 15,
        invoice_prefix: "SD-".into(),
        next_invoice_number: 42,
    };
    assert_eq!(saved, expected);
    assert_eq!(get_settings(&f.db).await.unwrap(), expected);
}

#[tokio::test]
async fn text_is_trimmed_and_blank_optionals_clear() {
    let f = Fixture::new().await;
    update_settings(&f.db, edit()).await.unwrap();

    let saved = update_settings(
        &f.db,
        SettingsEdit {
            name: "  Ed  ".into(),
            business_name: " ".into(),
            address: "".into(),
            email: "".into(),
            tax_id: "  ".into(),
            payment_instructions: "".into(),
            invoice_prefix: "".into(),
            ..edit()
        },
    )
    .await
    .unwrap();

    assert_eq!(saved.name, "Ed");
    assert_eq!(saved.business_name, None);
    assert_eq!(saved.address, None);
    assert_eq!(saved.email, None);
    assert_eq!(saved.tax_id, None);
    assert_eq!(saved.payment_instructions, None);
    assert_eq!(saved.invoice_prefix, "");
}

#[tokio::test]
async fn name_is_required() {
    let f = Fixture::new().await;

    let err = update_settings(
        &f.db,
        SettingsEdit {
            name: "  ".into(),
            ..edit()
        },
    )
    .await
    .unwrap_err();

    assert_eq!(invalid_field(err), "name");
    assert_eq!(get_settings(&f.db).await.unwrap().name, "");
}

#[tokio::test]
async fn email_must_look_like_one() {
    let f = Fixture::new().await;

    let err = update_settings(
        &f.db,
        SettingsEdit {
            email: "nope".into(),
            ..edit()
        },
    )
    .await
    .unwrap_err();

    assert_eq!(invalid_field(err), "email");
}

#[tokio::test]
async fn net_days_and_next_number_must_be_positive_integers() {
    let f = Fixture::new().await;

    for bad in ["", "0", "-1", "1.5", "abc", "99999999999999999999"] {
        let err = update_settings(
            &f.db,
            SettingsEdit {
                net_days: bad.into(),
                ..edit()
            },
        )
        .await
        .unwrap_err();
        assert_eq!(invalid_field(err), "netDays", "net days {bad:?}");

        let err = update_settings(
            &f.db,
            SettingsEdit {
                next_invoice_number: bad.into(),
                ..edit()
            },
        )
        .await
        .unwrap_err();
        assert_eq!(invalid_field(err), "nextInvoiceNumber", "next number {bad:?}");
    }

    let saved = update_settings(
        &f.db,
        SettingsEdit {
            net_days: " 1 ".into(),
            next_invoice_number: "1".into(),
            ..edit()
        },
    )
    .await
    .unwrap();
    assert_eq!((saved.net_days, saved.next_invoice_number), (1, 1));
}
