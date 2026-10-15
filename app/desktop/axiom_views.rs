// One native window. Only the local controller may manage the service or switch views.
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, Rect, Webview, WebviewBuilder, WebviewUrl};
use tauri_plugin_opener::OpenerExt;

static WORKBENCH: AtomicBool = AtomicBool::new(false);
static REVISION: AtomicU64 = AtomicU64::new(0);
pub fn revision() -> u64 { REVISION.load(Ordering::Acquire) }
const BAR_HEIGHT: f64 = 48.0;

pub fn authorize(view: &Webview) -> Result<(), String> {
    let url = view.url().map_err(|e| e.to_string())?;
    let local = (url.scheme() == "tauri" && url.host_str() == Some("localhost")) ||
        (["http", "https"].contains(&url.scheme()) && url.host_str() == Some("tauri.localhost") && url.port().is_none());
    if view.label() != "pake" || view.window().label() != "pake" || !local {
        return Err("操作仅可从客户端内置页面调用。".into());
    }
    Ok(())
}

pub fn current() -> &'static str {
    if WORKBENCH.load(Ordering::Acquire) { "workbench" } else { "control" }
}

pub fn focus(app: &AppHandle) -> tauri::Result<()> {
    if let Some(view) = app.get_webview(if current() == "workbench" { "axiom-workbench" } else { "pake" }) { view.set_focus()?; }
    Ok(())
}

pub fn layout(app: &AppHandle) -> tauri::Result<()> {
    let Some(window) = app.get_window("pake") else { return Ok(()); };
    let size = window.inner_size()?;
    if size.width == 0 || size.height == 0 { return Ok(()); }
    let bar = ((BAR_HEIGHT * window.scale_factor()?).round() as u32).min(size.height.saturating_sub(1));
    let active = WORKBENCH.load(Ordering::Acquire);
    if let Some(control) = app.get_webview("pake") {
        control.set_auto_resize(false)?;
        control.set_bounds(Rect { position: PhysicalPosition::new(0, 0).into(),
            size: PhysicalSize::new(size.width, if active { bar } else { size.height }).into() })?;
    }
    if let Some(workbench) = app.get_webview("axiom-workbench") {
        workbench.set_bounds(Rect { position: PhysicalPosition::new(0, bar as i32).into(),
            size: PhysicalSize::new(size.width, size.height - bar).into() })?;
    }
    Ok(())
}

fn notify(app: &AppHandle) -> Result<(), String> {
    if let Some(control) = app.get_webview("pake") {
        let script = format!("window.dispatchEvent(new CustomEvent('axiom-desktop-view', {{detail: '{}'}}))", current());
        control.eval(&script).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn controls(app: &AppHandle, discard: bool) -> Result<(), String> {
    if discard { REVISION.fetch_add(1, Ordering::AcqRel); crate::axiom_connection::invalidate(); }
    let was_active = WORKBENCH.swap(false, Ordering::AcqRel);
    if let Some(workbench) = app.get_webview("axiom-workbench") {
        workbench.hide().map_err(|e| e.to_string())?;
        if discard { workbench.close().map_err(|e| e.to_string())?; }
    }
    layout(app).map_err(|e| e.to_string())?;
    if was_active {
        notify(app)?;
        if let Some(control) = app.get_webview("pake") { control.set_focus().map_err(|e| e.to_string())?; }
    }
    Ok(())
}

pub async fn open(app: &AppHandle, target: tauri::Url) -> Result<(), String> {
    REVISION.fetch_add(1, Ordering::AcqRel);
    if target.scheme() != "http" || target.host_str() != Some("127.0.0.1") || !target.username().is_empty() || target.password().is_some() {
        return Err("工作台地址不合法".into());
    }
    if let Some(workbench) = app.get_webview("axiom-workbench") {
        if workbench.url().map_err(|e| e.to_string())?.origin() != target.origin() { controls(app, true)?; }
    }
    // A close is dispatched to the native event loop; wait before reusing the label.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while let Some(view) = app.get_webview("axiom-workbench") {
        if view.url().map_err(|e| e.to_string())?.origin() == target.origin() { break; }
        if std::time::Instant::now() >= deadline { return Err("旧工作台尚未关闭，请稍后重试。".into()); }
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
    }
    if app.get_webview("axiom-workbench").is_none() {
        let window = app.get_window("pake").ok_or("客户端窗口不可用")?;
        let size = window.inner_size().map_err(|e| e.to_string())?;
        let origin = target.origin();
        let external = app.clone();
        let builder = WebviewBuilder::new("axiom-workbench", WebviewUrl::External(target))
            .focused(false)
            .on_navigation(move |url| url.origin() == origin)
            .on_new_window(move |url, _| {
                if ["https", "http"].contains(&url.scheme()) && url.username().is_empty() && url.password().is_none() {
                    let _ = external.opener().open_url(url.as_str(), None::<&str>);
                }
                tauri::webview::NewWindowResponse::Deny
            });
        #[cfg(windows)]
        let builder = builder.additional_browser_args("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --disable-blink-features=AutomationControlled");
        // Start outside the visible content area to avoid flashing over the control page.
        let workbench = window.add_child(builder, PhysicalPosition::new(0, size.height as i32), size).map_err(|e| e.to_string())?;
        workbench.set_auto_resize(false).map_err(|e| e.to_string())?;
        workbench.hide().map_err(|e| e.to_string())?;
    }
    WORKBENCH.store(true, Ordering::Release);
    if let Err(error) = layout(app).map_err(|e| e.to_string()).and_then(|_| notify(app)) {
        let _ = controls(app, false);
        return Err(error);
    }
    let workbench = app.get_webview("axiom-workbench").ok_or("工作台视图不可用")?;
    workbench.show().map_err(|e| e.to_string())?;
    workbench.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn axiom_controls(webview: Webview) -> Result<(), String> {
    authorize(&webview)?;
    controls(webview.app_handle(), false)
}

// Pake's WebviewWindow lookup no longer applies after attaching a child webview.
// Keep macOS native menu actions bound to the currently presented view.
#[cfg(target_os = "macos")]
pub fn menu_action(app: &AppHandle, id: &str) -> bool {
    if id == "new_window" { return true; }
    if id == "go_home" { let _ = controls(app, false); return true; }
    let Some(view) = app.get_webview(if current() == "workbench" { "axiom-workbench" } else { "pake" }) else { return false; };
    match id {
        "reload" => { let _ = view.reload(); }
        "always_on_top" => {
            let window = view.window();
            let _ = window.set_always_on_top(!window.is_always_on_top().unwrap_or(false));
        }
        "clear_cache_restart" => { if view.clear_all_browsing_data().is_ok() { app.restart(); } }
        "paste_and_match_style" => { let _ = view.eval("window.triggerPasteAsPlainText?.()"); }
        "find" | "find_next" | "find_previous" => {
            let _ = view.eval(match id { "find" => "window.pakeFind?.open()", "find_next" => "window.pakeFind?.next()", _ => "window.pakeFind?.previous()" });
        }
        "toggle_devtools" => {
            #[cfg(debug_assertions)]
            if view.is_devtools_open() { view.close_devtools(); } else { view.open_devtools(); }
        }
        "go_back" => { let _ = view.eval("history.back()"); }
        "go_forward" => { let _ = view.eval("history.forward()"); }
        "zoom_in" | "zoom_out" | "zoom_reset" => {
            if current() == "control" {
                let _ = view.eval(match id { "zoom_in" => "zoomIn()", "zoom_out" => "zoomOut()", _ => "setZoom('100%')" });
                return true;
            }
            // Use native zoom: do not scale a bitmap or the whole window.
            static ZOOM: std::sync::Mutex<f64> = std::sync::Mutex::new(1.0);
            if let Ok(mut zoom) = ZOOM.lock() {
                *zoom = match id { "zoom_in" => (*zoom + 0.1).min(2.0), "zoom_out" => (*zoom - 0.1).max(0.5), _ => 1.0 };
                let _ = view.set_zoom(*zoom);
            }
        }
        "copy_url" => {
            use std::io::Write;
            if let Ok(url) = view.url() {
                if let Ok(mut child) = std::process::Command::new("pbcopy").stdin(std::process::Stdio::piped()).spawn() {
                    if let Some(mut stdin) = child.stdin.take() { let _ = stdin.write_all(url.as_str().as_bytes()); }
                    let _ = child.wait();
                }
            }
        }
        _ => return false,
    }
    true
}
