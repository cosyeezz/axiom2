// Read-only connection observations. Management remains exclusive to the local controller.
use std::{collections::BTreeMap, sync::{Mutex, atomic::{AtomicU64, Ordering}}, time::{Duration, Instant}};
use tauri::{AppHandle, Manager, Webview};

struct Probe { origin: String, state: Option<String>, deadline: Instant }
static NEXT: AtomicU64 = AtomicU64::new(1);
static PROBES: Mutex<BTreeMap<u64, Probe>> = Mutex::new(BTreeMap::new());

pub fn invalidate() {
    if let Ok(mut probes) = PROBES.lock() { probes.clear(); }
}

#[tauri::command]
pub async fn axiom_connection(webview: Webview) -> Result<String, String> {
    crate::axiom_views::authorize(&webview)?;
    observe(webview.app_handle()).await
}

pub async fn observe(app: &AppHandle) -> Result<String, String> {
    let Some(workbench) = app.get_webview("axiom-workbench") else { return Ok("checking".into()); };
    let url = workbench.url().map_err(|e| e.to_string())?;
    if url.scheme() != "http" || url.host_str() != Some("127.0.0.1") { return Ok("checking".into()); }
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
