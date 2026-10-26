// Compiled only by --test-instance; never included in distributed clients.
use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::{Manager, Webview};

static OBSERVATION: Mutex<Option<Value>> = Mutex::new(None);

pub fn loaded(view: &Webview) {
    if std::env::var_os("AXIOM_DESKTOP_PROBE_REPORT").is_none() || std::env::var("AXIOM_DESKTOP_PROBE_MODE").as_deref() == Ok("inspect") { return; }
    eprintln!("[Axiom native probe] loaded {}", view.label());
    if view.label() == "pake" {
        let mode = if std::env::var("AXIOM_DESKTOP_PROBE_MODE").as_deref() == Ok("reopen") { "reopen" } else { "full" };
        let port = match std::env::var("AXIOM_PORT").ok().and_then(|value| value.parse::<u16>().ok()).filter(|port| *port != 0 && *port != 4317) {
            Some(port) => port,
            None => { eprintln!("[Axiom native probe] expected an explicit isolated AXIOM_PORT"); return; }
        };
        let _ = view.eval(&format!("window.__axiomProbePort = {port};\nwindow.__axiomProbeMode = '{}';\n{}", mode, include_str!("axiom_controller_probe.js")));
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
    if action != "snapshot" { eprintln!("[Axiom native probe] action {}", action); }
    match action.as_str() {
        "snapshot" => {},
        "inspect-workbench" => {
            if let Some(workbench) = app.get_webview("axiom-workbench") {
                workbench.eval(r#"window.__TAURI_INTERNALS__.invoke('axiom_test_probe', {action: 'record', observation: {diagnostic: true, url: location.href, readyState: document.readyState, started: !!window.__axiomWorkbenchProbeStarted, sampleReady: !!window.__axiomProbeSample, appPresent: !!document.querySelector('.app'), sessionPresent: !!document.querySelector('[data-session-id="desktop-probe-session"]'), inputPresent: !!document.querySelector('textarea[data-od-id="message-input"]')}})"#).map_err(|e| e.to_string())?;
            }
        },
        "sample" => {
            let sample_id = observation.as_ref().and_then(|value| value.get("sampleId")).and_then(Value::as_str).filter(|id| !id.is_empty() && id.len() <= 128).ok_or("Missing sample request identity")?;
            let script = format!("window.__axiomProbeSample({})", serde_json::to_string(sample_id).map_err(|e| e.to_string())?);
            app.get_webview("axiom-workbench").ok_or("Workbench missing")?.eval(&script).map_err(|e| e.to_string())?;
        },
        "resize" => { window.set_size(tauri::LogicalSize::new(900.0, 650.0)).map_err(|e| e.to_string())?; },
        "resize-large" => { window.set_size(tauri::LogicalSize::new(1480.0, 900.0)).map_err(|e| e.to_string())?; },
        "maximize" => { window.maximize().map_err(|e| e.to_string())?; },
        "unmaximize" => { window.unmaximize().map_err(|e| e.to_string())?; },
        "fullscreen" => { window.set_fullscreen(true).map_err(|e| e.to_string())?; },
        "leave-fullscreen" => { window.set_fullscreen(false).map_err(|e| e.to_string())?; },
        "checkpoint" | "dock-hidden" | "finished" | "failed" | "progress" => {},
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
        views.push(json!({"label": child.label(), "url": child.url().map_err(|e| e.to_string())?.as_str(), "x": position.x, "y": position.y, "width": size.width, "height": size.height}));
    }
    let reported = window.inner_size().map_err(|e| e.to_string())?;
    let (origin, size) = crate::axiom_views::content_bounds(&window).map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    let native_geometry = {
    let (send, receive) = std::sync::mpsc::sync_channel(1);
    let native_window = window.clone();
    window.run_on_main_thread(move || {
        let geometry = (|| {
            let pointer = native_window.ns_window().ok()?;
            let native = unsafe { pointer.cast::<objc2_app_kit::NSWindow>().as_ref() }?;
            let content = native.contentView()?;
            let frame = content.bounds();
            let layout = native.contentLayoutRect();
            Some(json!({"contentWidth": frame.size.width, "contentHeight": frame.size.height,
                "layoutX": layout.origin.x, "layoutY": layout.origin.y,
                "layoutWidth": layout.size.width, "layoutHeight": layout.size.height}))
        })();
        let _ = send.send(geometry);
    }).map_err(|e| e.to_string())?;
    receive.recv_timeout(std::time::Duration::from_secs(5)).map_err(|e| e.to_string())?
    };
    #[cfg(not(target_os = "macos"))]
    let native_geometry = Option::<Value>::None;
    let snapshot = json!({"windows": app.windows().keys().collect::<Vec<_>>(), "views": views,
        "reportedWidth": reported.width, "reportedHeight": reported.height,
        "contentX": origin.x, "contentY": origin.y, "nativeGeometry": native_geometry,
        "maximized": window.is_maximized().map_err(|e| e.to_string())?, "fullscreen": window.is_fullscreen().map_err(|e| e.to_string())?,
        "width": size.width, "height": size.height, "scale": window.scale_factor().map_err(|e| e.to_string())?,
        "current": crate::axiom_views::current(), "visible": window.is_visible().map_err(|e| e.to_string())?, "observation": OBSERVATION.lock().map_err(|_| "Probe unavailable")?.clone(),
        "acknowledged": report.with_extension("ack").exists()});
    if ["checkpoint", "dock-hidden", "finished", "failed", "progress"].contains(&action.as_str()) {
        std::fs::write(&report, serde_json::to_vec_pretty(&json!({"phase": action, "snapshot": snapshot, "detail": observation})).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    }
    Ok(snapshot)
}
