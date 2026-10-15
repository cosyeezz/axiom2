// Compiled only by --test-instance; never included in distributed clients.
use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::{Manager, Webview};

static OBSERVATION: Mutex<Option<Value>> = Mutex::new(None);

pub fn loaded(view: &Webview) {
    if std::env::var_os("AXIOM_DESKTOP_PROBE_REPORT").is_none() || std::env::var("AXIOM_DESKTOP_PROBE_MODE").as_deref() == Ok("inspect") { return; }
    if view.label() == "pake" {
        let mode = if std::env::var("AXIOM_DESKTOP_PROBE_MODE").as_deref() == Ok("reopen") { "reopen" } else { "full" };
        let _ = view.eval(&format!("window.__axiomProbeMode = '{}';\n{}", mode, include_str!("axiom_controller_probe.js")));
    } else if view.label() == "axiom-workbench" {
        let _ = view.eval(include_str!("axiom_workbench_probe.js"));
    }
}

#[tauri::command]
pub async fn axiom_test_probe(view: Webview, action: String, observation: Option<Value>) -> Result<Value, String> {
    let report = std::env::var_os("AXIOM_DESKTOP_PROBE_REPORT").ok_or("Native probe is disabled")?;
    let report = std::path::PathBuf::from(report);
    if !report.is_absolute() { return Err("Probe report must be absolute".into()); }
    if action == "record" {
        if view.label() != "axiom-workbench" || view.window().label() != "pake" { return Err("Unexpected probe source".into()); }
        *OBSERVATION.lock().map_err(|_| "Probe unavailable")? = observation;
        return Ok(Value::Null);
    }
    crate::axiom_views::authorize(&view)?;
    let app = view.app_handle();
    let window = app.get_window("pake").ok_or("Window missing")?;
    match action.as_str() {
        "snapshot" => {},
        "sample" => { app.get_webview("axiom-workbench").ok_or("Workbench missing")?.eval("window.__axiomProbeSample()").map_err(|e| e.to_string())?; },
        "resize" => { window.set_size(tauri::LogicalSize::new(900.0, 650.0)).map_err(|e| e.to_string())?; },
        "checkpoint" | "dock-hidden" | "finished" | "failed" => {},
        "hide" => { window.hide().map_err(|e| e.to_string())?; },
        #[cfg(target_os = "macos")]
        "menu-home" => {
            let top = window.is_always_on_top().map_err(|e| e.to_string())?;
            crate::app::menu::handle_menu_click(app, "always_on_top");
            // AppKit applies window levels asynchronously even after Tauri dispatches them.
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
            while window.is_always_on_top().map_err(|e| e.to_string())? == top {
                if std::time::Instant::now() >= deadline { return Err("Native topmost menu did not target the parent window".into()); }
                tokio::time::sleep(std::time::Duration::from_millis(25)).await;
            }
            crate::app::menu::handle_menu_click(app, "always_on_top");
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
            while window.is_always_on_top().map_err(|e| e.to_string())? != top {
                if std::time::Instant::now() >= deadline { return Err("Native topmost menu did not restore the window level".into()); }
                tokio::time::sleep(std::time::Duration::from_millis(25)).await;
            }
            crate::app::menu::handle_menu_click(app, "go_home");
        },
        "close" => { window.close().map_err(|e| e.to_string())?; return Ok(Value::Null); },
        _ => return Err("Unknown probe action".into()),
    }
    let mut views = Vec::new();
    for child in window.webviews() {
        let size = child.size().map_err(|e| e.to_string())?;
        let position = child.position().map_err(|e| e.to_string())?;
        views.push(json!({"label": child.label(), "x": position.x, "y": position.y, "width": size.width, "height": size.height}));
    }
    let size = window.inner_size().map_err(|e| e.to_string())?;
    let snapshot = json!({"windows": app.windows().keys().collect::<Vec<_>>(), "views": views,
        "width": size.width, "height": size.height, "scale": window.scale_factor().map_err(|e| e.to_string())?,
        "current": crate::axiom_views::current(), "visible": window.is_visible().map_err(|e| e.to_string())?, "observation": OBSERVATION.lock().map_err(|_| "Probe unavailable")?.clone(),
        "acknowledged": report.with_extension("ack").exists()});
    if ["checkpoint", "dock-hidden", "finished", "failed"].contains(&action.as_str()) {
        std::fs::write(&report, serde_json::to_vec_pretty(&json!({"phase": action, "snapshot": snapshot, "detail": observation})).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    }
    Ok(snapshot)
}
