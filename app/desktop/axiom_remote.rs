// Local controller only: Tailnet discovery and opening a validated remote workbench.
use serde_json::{json, Value};
use std::{net::IpAddr, path::PathBuf, time::Duration};
use tauri::{Manager, Webview};
use tauri_plugin_http::reqwest;

pub fn tailscale_path() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if cfg!(windows) {
        if let Some(dir) = std::env::var_os("ProgramFiles") { candidates.push(PathBuf::from(dir).join("Tailscale/tailscale.exe")); }
    } else {
        candidates.extend(["/usr/local/bin/tailscale", "/opt/homebrew/bin/tailscale", "/usr/bin/tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"].map(PathBuf::from));
    }
    if let Some(path) = std::env::var_os("PATH") { candidates.extend(std::env::split_paths(&path).map(|dir| dir.join(if cfg!(windows) { "tailscale.exe" } else { "tailscale" }))); }
    candidates.into_iter().find(|path| path.is_file())
}
pub fn tailnet_ip(address: &str) -> bool {
    match address.parse::<IpAddr>() {
        Ok(IpAddr::V4(ip)) => { let a = ip.octets(); a[0] == 100 && (64..=127).contains(&a[1]) }
        Ok(IpAddr::V6(ip)) => { let a = ip.segments(); a[0] == 0xfd7a && a[1] == 0x115c && a[2] == 0xa1e0 }
        _ => false,
    }
}
pub fn remote_target(address: &str, port: u16) -> Result<tauri::Url, String> {
    if port == 0 { return Err("端口应为 1–65535。".into()); }
    let text = address.trim();
    let input = if text.contains("://") { text.to_string() } else if text.parse::<IpAddr>().is_ok_and(|ip| ip.is_ipv6()) { format!("http://[{text}]") } else { format!("http://{text}") };
    let mut url = tauri::Url::parse(&input).map_err(|_| "请输入有效的 Tailscale IP 或完整地址。")?;
    if !["http", "https"].contains(&url.scheme()) || !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some() || url.path() != "/" {
        return Err("仅支持不含凭据、路径或查询参数的 Tailscale 服务地址。".into());
    }
    let host = url.host_str().unwrap_or("").trim_matches(['[', ']']);
    if !tailnet_ip(host) { return Err("请输入 Tailscale 分配的 IP（100.64.0.0/10 或 Tailscale IPv6）。".into()); }
    url.set_port(Some(port)).map_err(|_| "端口无效。")?;
    Ok(url)
}
pub fn valid_target(url: &tauri::Url) -> bool {
    ["http", "https"].contains(&url.scheme()) && url.username().is_empty() && url.password().is_none() &&
        (url.host_str() == Some("127.0.0.1") || tailnet_ip(url.host_str().unwrap_or("").trim_matches(['[', ']'])))
}
#[tauri::command]
pub async fn axiom_peers(webview: Webview) -> Result<Value, String> {
    crate::axiom_views::authorize(&webview)?;
    tauri::async_runtime::spawn_blocking(|| {
        let path = tailscale_path().ok_or("尚未安装 Tailscale，请先安装并登录。")?;
        let output = crate::axiom_setup::capture(std::process::Command::new(path).args(["status", "--json"]), 12)?;
        let status: Value = serde_json::from_str(&output).map_err(|_| "无法读取 Tailscale 状态。")?;
        if status["BackendState"] != "Running" { return Err("Tailscale 尚未连接，请打开 Tailscale 并登录。".into()); }
        let mut peers = Vec::new();
        if let Some(entries) = status["Peer"].as_object() {
            for peer in entries.values().filter(|p| p["Online"] == true) {
                if let Some(ips) = peer["TailscaleIPs"].as_array() {
                    if let Some(ip) = ips.iter().filter_map(Value::as_str).find(|ip| tailnet_ip(ip)) {
                        peers.push(json!({"name":peer["HostName"].as_str().unwrap_or(ip),"ip":ip}));
                    }
                }
            }
        }
        peers.sort_by_key(|p| p["name"].as_str().unwrap_or("").to_lowercase());
        Ok(json!({"peers":peers}))
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn axiom_remote(webview: Webview, address: String, port: u16) -> Result<Value, String> {
    crate::axiom_views::authorize(&webview)?;
    let target = remote_target(&address, port)?;
    connect(webview, target).await
}

#[tauri::command]
pub async fn axiom_local(webview: Webview, port: u16) -> Result<Value, String> {
    crate::axiom_views::authorize(&webview)?;
    if port == 0 { return Err("端口应为 1–65535。".into()); }
    let target = tauri::Url::parse(&format!("http://127.0.0.1:{port}/")).map_err(|e| e.to_string())?;
    connect(webview, target).await
}

async fn connect(webview: Webview, target: tauri::Url) -> Result<Value, String> {
    let request = crate::axiom_views::begin_open_request();
    let observed = request.revision;
    let request_deadline = std::time::Instant::now() + Duration::from_secs(55);
    let client = reqwest::Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none()).timeout(Duration::from_secs(8)).build().map_err(|e| e.to_string())?;
    let response = client.get(target.join("api/status").map_err(|e| e.to_string())?).send().await.map_err(|_| format!("无法连接 {}。请确认该设备上的 Axiom 服务已启动，地址和端口正确。", target))?;
    if !response.status().is_success() || response.content_length().unwrap_or(0) > 4096 { return Err("目标没有返回有效的 Axiom 服务状态。".into()); }
    let mut response = response;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? { if bytes.len() + chunk.len() > 4096 { return Err("服务状态响应过大。".into()); } bytes.extend_from_slice(&chunk); }
    let status: Value = serde_json::from_slice(&bytes).map_err(|_| "目标不是可用的 Axiom 服务。")?;
    if status["connected"] != true || status["stage"] != 1 { return Err("目标服务尚未就绪。".into()); }
    if observed != crate::axiom_views::revision() { return Err("连接选择已改变，请重试。".into()); }
    crate::axiom_views::open(webview.app_handle(), target.clone(), observed, false, request_deadline).await?;
    Ok(json!({"url":target.as_str(),"desktopView":"workbench"}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn remote_addresses_are_tailnet_only() {
        assert_eq!(remote_target("100.106.9.14", 4317).unwrap().as_str(), "http://100.106.9.14:4317/");
        assert_eq!(remote_target("http://100.106.9.14:9000", 4317).unwrap().port(), Some(4317));
        assert!(remote_target("fd7a:115c:a1e0::1", 4317).is_ok());
        for bad in ["127.0.0.1", "192.168.1.1", "example.com", "http://user@100.64.0.1", "http://100.64.0.1/api", "file:///tmp/x", "http://100.64.0.1/?x=1", "100.128.0.1"] { assert!(remote_target(bad, 4317).is_err(), "{bad}"); }
        assert!(remote_target("100.64.0.1", 0).is_err());
    }
}
