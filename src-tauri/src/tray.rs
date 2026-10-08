//! The menu-bar Timer: a thin driver over [`crate::core::timer`]. Actions
//! emit `timer-changed` (what a stop did, or null) so the window refreshes.

use std::time::Duration;

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{TrayIcon, TrayIconBuilder};
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::core::time_entries::{last_used, LastUsed};
use crate::core::timer::{self, Stopped, Timer, TimerStart};
use crate::core::{Clock, CoreError, Db, SystemClock};

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let tray = TrayIconBuilder::with_id("timer")
        .menu(&menu(app, &view(None, 0))?)
        .on_menu_event(|app, event| {
            let (app, id) = (app.clone(), event.id().0.clone());
            tauri::async_runtime::spawn(async move {
                if let Err(e) = act(&app, &id).await {
                    show(&app); // the error shows in the window, which may be hidden
                    let _ = app.emit("tray-error", e);
                }
            });
        })
        .build(app)?;

    let app = app.clone();
    std::thread::spawn(move || {
        let mut shown: Option<View> = None;
        loop {
            if let Ok(timer) =
                tauri::async_runtime::block_on(timer::get_timer(app.state::<Db>().inner()))
            {
                let next = view(timer.as_ref(), SystemClock.now().timestamp_millis());
                let _ = refresh(&app, &tray, shown.as_ref(), &next);
                shown = Some(next);
            }
            std::thread::sleep(Duration::from_secs(1));
        }
    });
    Ok(())
}

/// Touches only what changed, so an open menu isn't rebuilt every tick.
fn refresh(
    app: &AppHandle,
    tray: &TrayIcon,
    shown: Option<&View>,
    next: &View,
) -> tauri::Result<()> {
    if shown.map(|s| &s.title) != Some(&next.title) {
        match &next.title {
            Some(title) => {
                tray.set_icon(None)?;
                tray.set_title(Some(title))?;
            }
            None => {
                tray.set_title(None::<&str>)?;
                tray.set_icon_with_as_template(Some(icon()), true)?;
            }
        }
    }
    if shown.map(|s| (&s.client, s.still_working)) != Some((&next.client, next.still_working)) {
        tray.set_menu(Some(menu(app, next)?))?;
    }
    Ok(())
}

fn menu(app: &AppHandle, v: &View) -> tauri::Result<Menu<Wry>> {
    let m = Menu::new(app)?;
    match &v.client {
        Some(client) => {
            m.append(&MenuItem::new(app, client, false, None::<&str>)?)?;
            if v.still_working {
                m.append(&MenuItem::new(app, "Still working?", false, None::<&str>)?)?;
            }
            m.append(&MenuItem::with_id(app, "stop", "Stop", true, None::<&str>)?)?;
            m.append(&MenuItem::with_id(
                app,
                "discard",
                "Discard",
                true,
                None::<&str>,
            )?)?;
        }
        None => m.append(&MenuItem::with_id(
            app,
            "start",
            "▶ Start",
            true,
            None::<&str>,
        )?)?,
    }
    m.append(&PredefinedMenuItem::separator(app)?)?;
    m.append(&MenuItem::with_id(
        app,
        "open",
        "Open Quest Log",
        true,
        None::<&str>,
    )?)?;
    m.append(&MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?)?;
    Ok(m)
}

async fn act(app: &AppHandle, id: &str) -> Result<(), CoreError> {
    let db = app.state::<Db>();
    match id {
        "start" => match last_used(&db).await? {
            Some(LastUsed {
                client_id,
                project_id,
            }) => {
                let outcome = timer::start_timer(
                    &db,
                    &SystemClock,
                    TimerStart {
                        client_id,
                        project_id,
                        note: None,
                    },
                )
                .await?;
                emit_changed(app, outcome);
            }
            None => {
                show(app);
                let _ = app.emit("tray-start", ());
            }
        },
        "stop" => {
            let outcome = timer::stop_timer(&db, &SystemClock).await?;
            if let Stopped::NeedsEdit { .. } = outcome {
                show(app);
            }
            emit_changed(app, Some(outcome));
        }
        "discard" => {
            timer::discard_timer(&db).await?;
            emit_changed(app, None);
        }
        "open" => show(app),
        "quit" => app.exit(0),
        _ => {}
    }
    Ok(())
}

fn emit_changed(app: &AppHandle, outcome: Option<Stopped>) {
    let _ = app.emit("timer-changed", outcome);
}

/// Hiding keeps the page alive, so showing lands on the last screen.
pub fn show(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// An 8×8 pixel hourglass, scaled ×4 with a 2px margin: the 36px a @2x menu bar wants.
fn icon() -> Image<'static> {
    const ART: [&str; 8] = [
        "########", ".#....#.", "..#..#..", "...##...", "...##...", "..####..", ".######.",
        "########",
    ];
    const SCALE: usize = 4;
    const SIZE: usize = 8 * SCALE + 4;
    let mut rgba = vec![0u8; SIZE * SIZE * 4];
    for y in 0..SIZE - 4 {
        for x in 0..SIZE - 4 {
            if ART[y / SCALE].as_bytes()[x / SCALE] == b'#' {
                let i = ((y + 2) * SIZE + x + 2) * 4;
                rgba[i + 3] = 255; // black; template mode tints it
            }
        }
    }
    Image::new_owned(rgba, SIZE as u32, SIZE as u32)
}

/// "Still working?" shows after this long, as in the window.
const STILL_WORKING_MS: i64 = 12 * 3600 * 1000;

/// What the tray shows for a Timer at an instant.
#[derive(Debug, PartialEq)]
struct View {
    /// `H:MM` while running; `None` shows the idle icon.
    title: Option<String>,
    /// The running Timer's client, and project if any.
    client: Option<String>,
    still_working: bool,
}

fn view(timer: Option<&Timer>, now_ms: i64) -> View {
    let Some(t) = timer else {
        return View {
            title: None,
            client: None,
            still_working: false,
        };
    };
    let elapsed = (now_ms - t.started_at).max(0);
    let minutes = elapsed / 60_000;
    View {
        title: Some(format!("{}:{:02}", minutes / 60, minutes % 60)),
        client: Some(match &t.project_name {
            Some(project) => format!("{} · {project}", t.client_name),
            None => t.client_name.clone(),
        }),
        still_working: elapsed >= STILL_WORKING_MS,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn timer(started_at: i64) -> Timer {
        Timer {
            client_id: 1,
            client_name: "Acme".into(),
            project_id: None,
            project_name: None,
            started_at,
            note: None,
        }
    }

    #[test]
    fn idle_shows_the_icon() {
        assert_eq!(
            view(None, 0),
            View {
                title: None,
                client: None,
                still_working: false
            }
        );
    }

    #[test]
    fn running_shows_whole_minutes_as_h_mm() {
        let t = timer(1_000);
        let at = |secs: i64| view(Some(&t), 1_000 + secs * 1000).title.unwrap();
        assert_eq!(at(0), "0:00");
        assert_eq!(at(59), "0:00");
        assert_eq!(at(60), "0:01");
        assert_eq!(at(3600 + 5 * 60 + 59), "1:05");
        assert_eq!(at(25 * 3600), "25:00");
        assert_eq!(
            view(Some(&t), 0).title.unwrap(),
            "0:00",
            "clock behind start"
        );
        assert_eq!(view(Some(&t), 0).client.as_deref(), Some("Acme"));
    }

    #[test]
    fn running_shows_the_project_beside_the_client() {
        let mut t = timer(0);
        t.project_name = Some("Website".into());
        assert_eq!(view(Some(&t), 0).client.as_deref(), Some("Acme · Website"));
    }

    #[test]
    fn still_working_after_12_hours() {
        let t = timer(0);
        assert!(!view(Some(&t), STILL_WORKING_MS - 1).still_working);
        assert!(view(Some(&t), STILL_WORKING_MS).still_working);
    }
}
