// Read-only connection observations. Management remains exclusive to the local controller.
use std::{collections::BTreeMap, sync::{Mutex, atomic::{AtomicU64, Ordering}}, time::{Duration, Instant}};
use tauri::{AppHandle, Manager, Webview};

struct Probe { origin: String, state: Option<String>, deadline: Instant }
static NEXT: AtomicU64 = AtomicU64::new(1);
static PROBES: Mutex<BTreeMap<u64, Probe>> = Mutex::new(BTreeMap::new());

pub fn invalidate() {
    if let Ok(mut probes) = PROBES.lock() { probes.clear(); }
    if let Ok(mut probes) = UPDATE_PROBES.lock() { probes.clear(); }
}

#[tauri::command]
pub async fn axiom_connection(webview: Webview) -> Result<String, String> {
    crate::axiom_views::authorize(&webview)?;
    observe(webview.app_handle()).await
}

pub async fn observe(app: &AppHandle) -> Result<String, String> {
    let Some(workbench) = app.get_webview("axiom-workbench") else { return Ok("checking".into()); };
    let url = workbench.url().map_err(|e| e.to_string())?;
    if !crate::axiom_remote::valid_target(&url) { return Ok("checking".into()); }
    let id = NEXT.fetch_add(1, Ordering::Relaxed);
    let deadline = Instant::now() + Duration::from_millis(800);
    {
        let mut probes = PROBES.lock().map_err(|_| "连接状态不可用")?;
        probes.retain(|_, probe| probe.deadline > Instant::now());
        // Independent, bounded slots let status verification and the header coexist.
        if probes.len() >= 4 { return Ok("checking".into()); }
        probes.insert(id, Probe { origin: url.origin().ascii_serialization(), state: None, deadline });
    }
    // Only a fixed event and native-issued request number cross into the workbench.
    if let Err(error) = workbench.eval(&format!("window.dispatchEvent(new CustomEvent('axiom-connection-request', {{detail: {id}}}))")) {
        if let Ok(mut probes) = PROBES.lock() { probes.remove(&id); }
        return Err(error.to_string());
    }
    loop {
        {
            let mut probes = PROBES.lock().map_err(|_| "连接状态不可用")?;
            let Some(probe) = probes.get_mut(&id) else { return Ok("checking".into()); };
            if Instant::now() >= probe.deadline { probes.remove(&id); return Ok("checking".into()); }
            if let Some(state) = probe.state.take() { probes.remove(&id); return Ok(state); }
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

#[tauri::command]
pub fn axiom_connection_report(webview: Webview, probe: u64, state: String) -> Result<(), String> {
    if webview.label() != "axiom-workbench" || webview.window().label() != "pake" ||
        !["connected", "disconnected", "checking"].contains(&state.as_str()) {
        return Err("连接状态来源无效。".into());
    }
    let url = webview.url().map_err(|e| e.to_string())?;
    let mut probes = PROBES.lock().map_err(|_| "连接状态不可用")?;
    match probes.get_mut(&probe) {
        Some(current) if Instant::now() < current.deadline && current.origin == url.origin().ascii_serialization() && current.state.is_none() => {
            current.state = Some(state); Ok(())
        }
        _ => Err("连接状态请求已过期。".into()),
    }
}

// The control bar has no backend credentials. Relay only four fixed operations
// through the currently connected workbench, with origin-bound expiring slots.
struct UpdateProbe { origin: String, response: Option<Result<serde_json::Value, String>>, deadline: Instant }
static UPDATE_PROBES: Mutex<BTreeMap<u64, UpdateProbe>> = Mutex::new(BTreeMap::new());

#[tauri::command]
pub async fn axiom_backend_updates(webview: Webview, action: String, version: Option<String>) -> Result<serde_json::Value, String> {
    crate::axiom_views::authorize(&webview)?;
    if !["get", "check", "present", "dismiss"].contains(&action.as_str()) { return Err("版本通知操作无效。".into()); }
    if ["present", "dismiss"].contains(&action.as_str()) && !version.as_ref().is_some_and(|v| {
        let parts: Vec<_> = v.split('.').collect();
        parts.len() == 3 && parts.iter().all(|p| !p.is_empty() && p.len() <= 9 && (*p == "0" || !p.starts_with('0')) && p.bytes().all(|c| c.is_ascii_digit()))
    }) { return Err("版本通知目标无效。".into()); }
    let workbench = webview.app_handle().get_webview("axiom-workbench").ok_or("请先连接后台服务。")?;
    let url = workbench.url().map_err(|e| e.to_string())?;
    if !crate::axiom_remote::valid_target(&url) { return Err("后台连接地址无效。".into()); }
    let id = NEXT.fetch_add(1, Ordering::Relaxed);
    let deadline = Instant::now() + Duration::from_secs(if action == "check" { 20 } else { 2 });
    {
        let mut probes = UPDATE_PROBES.lock().map_err(|_| "版本通知不可用")?;
        probes.retain(|_, p| p.deadline > Instant::now());
        if probes.len() >= 4 { return Err("版本通知正在处理，请稍后重试。".into()); }
        probes.insert(id, UpdateProbe { origin: url.origin().ascii_serialization(), response: None, deadline });
    }
    let detail = serde_json::json!({"probe":id,"action":action,"version":version});
    if let Err(error) = workbench.eval(&format!("window.dispatchEvent(new CustomEvent('axiom-backend-updates-request', {{detail: {detail}}}))")) {
        if let Ok(mut probes) = UPDATE_PROBES.lock() { probes.remove(&id); }
        return Err(error.to_string());
    }
    loop {
        {
            let mut probes = UPDATE_PROBES.lock().map_err(|_| "版本通知不可用")?;
            let Some(probe) = probes.get_mut(&id) else { return Err("版本通知请求已失效。".into()); };
            if Instant::now() >= probe.deadline { probes.remove(&id); return Err("版本检查响应超时，请稍后重试。".into()); }
            if let Some(response) = probe.response.take() {
                probes.remove(&id);
                return response.and_then(|mut value| {
                    // The controller must not infer the backend's location from
                    // UI selection or trust an origin asserted by backend data.
                    let object = value.as_object_mut().ok_or("版本通知响应无效。")?;
                    object.insert("sourceOrigin".into(), serde_json::json!(url.origin().ascii_serialization()));
                    Ok(value)
                });
            }
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

#[tauri::command]
pub fn axiom_backend_updates_report(webview: Webview, probe: u64, data: Option<serde_json::Value>, error: Option<String>) -> Result<(), String> {
    if webview.label() != "axiom-workbench" || webview.window().label() != "pake" { return Err("版本通知来源无效。".into()); }
    let response = match (data, error) {
        (Some(value), None) if value.to_string().len() <= 8192 => Ok(value),
        (None, Some(message)) if message.len() <= 2048 => Err(message),
        _ => return Err("版本通知响应无效。".into()),
    };
    let url = webview.url().map_err(|e| e.to_string())?;
    let mut probes = UPDATE_PROBES.lock().map_err(|_| "版本通知不可用")?;
    match probes.get_mut(&probe) {
        Some(current) if Instant::now() < current.deadline && current.origin == url.origin().ascii_serialization() && current.response.is_none() => {
            current.response = Some(response); Ok(())
        }
        _ => Err("版本通知请求已过期。".into()),
    }
}
