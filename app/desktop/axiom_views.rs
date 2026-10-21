// One native window. Only the local controller may manage the service or switch views.
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, Rect, Webview, WebviewBuilder, WebviewUrl};
use tauri_plugin_opener::OpenerExt;

static WORKBENCH: AtomicBool = AtomicBool::new(false);
static MANAGED: AtomicBool = AtomicBool::new(false);
static LOAD_FAILED: AtomicBool = AtomicBool::new(false);
static RENDERER_GENERATION: AtomicU64 = AtomicU64::new(0);
static PAGE_GENERATION: AtomicU64 = AtomicU64::new(0);
static READY_GENERATION: AtomicU64 = AtomicU64::new(0);
static REVISION: AtomicU64 = AtomicU64::new(0);
static OPENING: AtomicU64 = AtomicU64::new(0);
pub struct OpenRequest { pub revision: u64 }
impl Drop for OpenRequest {
    fn drop(&mut self) { OPENING.fetch_sub(1, Ordering::AcqRel); }
}
pub fn begin_open_request() -> OpenRequest {
    OPENING.fetch_add(1, Ordering::AcqRel);
    let revision = begin_request();
    OpenRequest { revision }
}
pub fn revision() -> u64 { REVISION.load(Ordering::Acquire) }
pub fn begin_request() -> u64 { REVISION.fetch_add(1, Ordering::AcqRel) + 1 }
const BAR_HEIGHT: f64 = 48.0;
static OPEN: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
// Execute mutations on the native event loop. No mutex required by a menu/close
// callback may be held while a background caller waits for a Tauri getter.
fn on_main(app: &AppHandle, operation: impl FnOnce(&AppHandle) -> Result<(), String> + Send + 'static) -> Result<(), String> {
    let (send, receive) = std::sync::mpsc::sync_channel(1);
    let main = app.clone();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
    // Wry executes this inline when already on its main thread.
    app.run_on_main_thread(move || { let result = if std::time::Instant::now() < deadline { operation(&main) } else { Err("视图操作已超时，请重新读取状态。".into()) }; let _ = send.send(result); }).map_err(|e| e.to_string())?;
    receive.recv_timeout(deadline.saturating_duration_since(std::time::Instant::now())).map_err(|_| "视图操作响应超时，结果尚未确认，请返回连接页。".to_string())?
}
fn check_request(observed: u64) -> Result<(), String> { if revision() == observed { Ok(()) } else { Err("连接选择已改变，请重试。".into()) } }

pub fn authorize(view: &Webview) -> Result<(), String> {
    let url = view.url().map_err(|e| e.to_string())?;
    let local = (url.scheme() == "tauri" && url.host_str() == Some("localhost")) ||
        (["http", "https"].contains(&url.scheme()) && url.host_str() == Some("tauri.localhost") && url.port().is_none());
    if view.label() != "pake" || view.window().label() != "pake" || !local {
        return Err("操作仅可从客户端内置页面调用。".into());
    }
    Ok(())
}

pub fn is_managed() -> bool { MANAGED.load(Ordering::Acquire) }

// A delayed management result must never claim a newer direct connection.
pub fn discard_managed(app: &AppHandle, observed: u64) -> Result<(), String> {
    on_main(app, move |app| {
        if OPENING.load(Ordering::Acquire) != 0 || !is_managed() || REVISION.compare_exchange(observed, observed + 1, Ordering::AcqRel, Ordering::Acquire).is_err() { return Ok(()); }
        controls_inner(app, true)
    })
}

pub fn current() -> &'static str {
    if WORKBENCH.load(Ordering::Acquire) { "workbench" } else { "control" }
}

pub fn focus(app: &AppHandle) -> tauri::Result<()> {
    if let Some(view) = app.get_webview(if current() == "workbench" { "axiom-workbench" } else { "pake" }) { view.set_focus()?; }
    Ok(())
}

// Tauri 2.10 reports the first WKWebView's frame as inner_size until a second
// view is added. Read AppKit's content view instead, so the initial controller
// follows resizing and restored/maximized window sizes as well.
pub fn content_size(window: &tauri::Window) -> tauri::Result<PhysicalSize<u32>> {
    #[cfg(target_os = "macos")]
    {
        let (send, receive) = std::sync::mpsc::sync_channel(1);
        let main = window.clone();
        window.run_on_main_thread(move || {
            let result = (|| {
                let pointer = main.ns_window()?;
                let native = unsafe { pointer.cast::<objc2_app_kit::NSWindow>().as_ref() }
                    .ok_or(tauri::Error::InvalidWindowHandle)?;
                let content = native.contentView().ok_or(tauri::Error::InvalidWindowHandle)?;
                let size = content.bounds().size;
                Ok(tauri::LogicalSize::new(size.width, size.height).to_physical(native.backingScaleFactor()))
            })();
            let _ = send.send(result);
        })?;
        receive.recv_timeout(std::time::Duration::from_secs(5)).map_err(|_| tauri::Error::FailedToReceiveMessage)?
    }
    #[cfg(not(target_os = "macos"))]
    { window.inner_size() }
}

pub fn layout(app: &AppHandle) -> tauri::Result<()> {
    let Some(window) = app.get_window("pake") else { return Ok(()); };
    let size = content_size(&window)?;
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
    let observed = begin_request();
    on_main(app, move |app| { check_request(observed)?; controls_inner(app, discard) })
}
fn controls_inner(app: &AppHandle, discard: bool) -> Result<(), String> {
    if discard { crate::axiom_connection::invalidate(); MANAGED.store(false, Ordering::Release); }
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

fn check_open(observed: u64, deadline: std::time::Instant) -> Result<(), String> {
    check_request(observed)?;
    if std::time::Instant::now() >= deadline { Err("打开工作台超时，请重新连接。".into()) } else { Ok(()) }
}

pub async fn open(app: &AppHandle, target: tauri::Url, observed: u64, managed: bool, request_deadline: std::time::Instant) -> Result<(), String> {
    let expires = request_deadline.min(std::time::Instant::now() + std::time::Duration::from_secs(35));
    let _open = OPEN.lock().await;
    check_open(observed, expires)?;
    if !crate::axiom_remote::valid_target(&target) {
        return Err("工作台地址不合法".into());
    }
    let closing_target = target.clone();
    on_main(app, move |app| {
        check_open(observed, expires)?;
        if let Some(workbench) = app.get_webview("axiom-workbench") {
            if workbench.url().map_err(|e| e.to_string())?.origin() != closing_target.origin() { controls_inner(app, true)?; }
        }
        Ok(())
    })?;
    // A close is dispatched to the native event loop; wait before reusing the label.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while let Some(view) = app.get_webview("axiom-workbench") {
        check_open(observed, expires)?;
        if view.url().map_err(|e| e.to_string())?.origin() == target.origin() { break; }
        if std::time::Instant::now() >= deadline { return Err("旧工作台尚未关闭，请稍后重试。".into()); }
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
    }
    on_main(app, move |app| {
    check_open(observed, expires)?;
    if LOAD_FAILED.swap(false, Ordering::AcqRel) {
        if let Some(view) = app.get_webview("axiom-workbench") { READY_GENERATION.store(0, Ordering::Release); view.reload().map_err(|e| e.to_string())?; }
    }
    if app.get_webview("axiom-workbench").is_none() {
        let window = app.get_window("pake").ok_or("客户端窗口不可用")?;
        let size = content_size(&window).map_err(|e| e.to_string())?;
        let origin = target.origin();
        let external = app.clone();
        let page_generation = PAGE_GENERATION.fetch_add(1, Ordering::AcqRel) + 1;
        READY_GENERATION.store(0, Ordering::Release);
        let ready_script = format!(r#"(() => {{
            let observer, pending = false;
            const report = () => {{
                if (pending || !document.querySelector('.app') || !window.__TAURI_INTERNALS__) return;
                pending = true;
                window.__TAURI_INTERNALS__.invoke('axiom_page_ready', {{generation: {page_generation}}}).then(() => observer?.disconnect(), () => {{pending = false;}});
            }};
            const start = () => {{ observer = new MutationObserver(report); observer.observe(document.documentElement, {{childList: true, subtree: true}}); report(); }};
            if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {{once: true}}); else start();
        }})();"#);
        let builder = WebviewBuilder::new("axiom-workbench", WebviewUrl::External(target))
            .initialization_script(&ready_script)
            .focused(false)
            .background_color(tauri::webview::Color(16, 18, 20, 255))
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
        watch_renderer(&workbench);
    }
    Ok(())
    })?;
    // A rendered page is independent of the newer backend's connection reporting.
    // This also allows existing backends to open while their socket state is unknown.
    let ready_deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
    loop {
        check_open(observed, expires)?;
        let generation = PAGE_GENERATION.load(Ordering::Acquire);
        if generation != 0 && READY_GENERATION.load(Ordering::Acquire) == generation { break; }
        if std::time::Instant::now() >= ready_deadline {
            LOAD_FAILED.store(true, Ordering::Release);
            return Err("工作台未能就绪，连接页面已保留。请确认服务可用后重试。".into());
        }
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    }
    on_main(app, move |app| {
    if let Err(error) = check_open(observed, expires) { return Err(error); }
    MANAGED.store(managed, Ordering::Release);
    WORKBENCH.store(true, Ordering::Release);
    if let Err(error) = layout(app).map_err(|e| e.to_string()).and_then(|_| notify(app)) {
        let _ = controls_inner(app, false);
        return Err(error);
    }
    let workbench = app.get_webview("axiom-workbench").ok_or("工作台视图不可用")?;
    workbench.show().map_err(|e| e.to_string())?;
    workbench.set_focus().map_err(|e| e.to_string())?;
    Ok(())
    })
}

#[tauri::command]
pub fn axiom_page_ready(webview: Webview, generation: u64) -> Result<(), String> {
    if webview.label() != "axiom-workbench" || webview.window().label() != "pake" || generation == 0 || generation != PAGE_GENERATION.load(Ordering::Acquire) {
        return Err("页面就绪回执已失效。".into());
    }
    let url = webview.url().map_err(|e| e.to_string())?;
    if !crate::axiom_remote::valid_target(&url) { return Err("页面来源无效。".into()); }
    READY_GENERATION.store(generation, Ordering::Release);
    Ok(())
}

pub fn watch_control(view: &Webview) {
    static WATCHING: AtomicBool = AtomicBool::new(false);
    if view.label() == "pake" && !WATCHING.swap(true, Ordering::AcqRel) {
        watch_renderer(view);
        let _ = layout(view.app_handle());
    }
}
fn watch_renderer(view: &Webview) {
    #[cfg(windows)] {
        use webview2_com::{ProcessFailedEventHandler, Microsoft::Web::WebView2::Win32::COREWEBVIEW2_PROCESS_FAILED_KIND};
        let app = view.app_handle().clone();
        let label = view.label().to_string();
        let generation = if label == "axiom-workbench" { RENDERER_GENERATION.fetch_add(1, Ordering::AcqRel) + 1 } else { 0 };
        let _ = view.with_webview(move |native| {
            let Ok(core) = (unsafe { native.controller().CoreWebView2() }) else { return; };
            let mut reloaded = false;
            let handler = ProcessFailedEventHandler::create(Box::new(move |_, args| {
                let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND::default();
                let read = args.as_ref().map(|args| unsafe { args.ProcessFailedKind(&mut kind) }.is_ok()).unwrap_or(false);
                let recover = !reloaded && read && [0, 1, 2].contains(&kind.0); if recover { reloaded = true; }
                let app = app.clone(); let label = label.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    use std::io::Write;
                    if let Ok(root) = crate::axiom_service::data_root() {
                        let dir = root.join("logs"); let _ = std::fs::create_dir_all(&dir);
                        let file = dir.join("desktop-events.log");
                        if std::fs::metadata(&file).is_ok_and(|m| m.len() > 1_000_000) { let _ = std::fs::rename(&file, dir.join("desktop-events.previous.log")); }
                        if let Ok(mut log) = std::fs::OpenOptions::new().append(true).create(true).open(file) { let _ = writeln!(log, "{:?} ProcessFailed view={} kind={} valid={}", std::time::SystemTime::now(), label, kind.0, read); }
                    }
                    if !read || ![0, 1, 2].contains(&kind.0) { return; }
                    if label == "axiom-workbench" {
                        let _ = on_main(&app, move |app| {
                            if generation != RENDERER_GENERATION.load(Ordering::Acquire) { return Ok(()); }
                            begin_request(); LOAD_FAILED.store(true, Ordering::Release);
                            controls_inner(app, false)?;
                            if let Some(control) = app.get_webview("pake") { let _ = control.eval("window.dispatchEvent(new CustomEvent('axiom-desktop-error',{detail:'工作台渲染进程异常，已返回连接页。请重新连接。'}))"); }
                            Ok(())
                        });
                    } else if recover { if let Some(control) = app.get_webview("pake") { let _ = control.reload(); } }
                });
                Ok(())
            }));
            let mut token = 0i64;
            // COM retains the handler until this WebView is closed.
            let _ = unsafe { core.add_ProcessFailed(&handler, &mut token) };
        });
    }
    #[cfg(not(windows))] let _ = view;
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
