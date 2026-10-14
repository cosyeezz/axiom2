// Copied into an isolated Pake 3.16.2 template by scripts/build-desktop.mjs.
// No arbitrary executable, command, URL, PID or shell input crosses the webview boundary.
use serde_json::{json, Value};
use std::{env, fs, io::Read, path::PathBuf, process::{Command, Stdio}, sync::Mutex, time::{Duration, Instant}};
use tauri::{Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

static CONTROL: Mutex<()> = Mutex::new(());
static UPDATES: Mutex<()> = Mutex::new(());

fn data_root() -> Result<PathBuf, String> {
    if let Some(root) = env::var_os("AXIOM_DATA_DIR") {
        let root = PathBuf::from(root);
        return Ok(if root.is_absolute() { root } else { env::current_dir().map_err(|e| e.to_string())?.join(root) });
    }
    let home = env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).ok_or("找不到用户目录")?;
    let home = PathBuf::from(home);
    Ok(if cfg!(windows) {
        env::var_os("APPDATA").map(PathBuf::from).unwrap_or(home.join("AppData/Roaming")).join("Axiom2")
    } else if cfg!(target_os = "macos") { home.join("Library/Application Support/Axiom2") }
    else { env::var_os("XDG_DATA_HOME").map(PathBuf::from).unwrap_or(home.join(".local/share")).join("Axiom2") })
}

fn installation_paths(require_cli: bool) -> Result<(PathBuf, PathBuf), String> {
    let path = data_root()?.join("installation.json");
    let value: Value = serde_json::from_slice(&fs::read(path).map_err(|_| "尚未安装可管理的服务。请先运行本页的一行安装命令；安装后点击刷新。")?).map_err(|_| "服务安装记录损坏，请重新运行安装命令。")?;
    let node = PathBuf::from(value["node"].as_str().ok_or("缺少 Node.js 路径，请重新安装服务。")?);
    let cli = PathBuf::from(value["cli"].as_str().ok_or("缺少服务路径，请重新安装服务。")?);
    if !node.is_absolute() || !cli.is_absolute() || !node.is_file() || (require_cli && !cli.is_file()) {
        return Err("Node.js 或服务已被移动 / 卸载，请重新运行安装命令。".into());
    }
    Ok((node, cli))
}

fn run(action: &str) -> Result<Value, String> {
    let (node, cli) = match installation_paths(true) {
        Ok(value) => value,
        Err(message) if action == "status" => return Ok(json!({"state":"missing", "active":[], "message":message})),
        Err(message) => return Err(message),
    };
    let mut command = Command::new(node);
    command.arg(cli).arg(action).arg("--json").current_dir(data_root()?).env("AXIOM_DATA_DIR", data_root()?)
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(windows)] {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW: no console flash for status/start/stop.
    }
    let mut child = command.spawn().map_err(|e| format!("无法启动服务控制程序：{e}"))?;
    let stdout = child.stdout.take().ok_or("无法读取服务状态")?;
    let reader = std::thread::spawn(move || {
        let mut output = String::new();
        stdout.take(65536).read_to_string(&mut output).map(|_| output)
    });
    let deadline = Instant::now() + Duration::from_secs(55);
    loop {
        if child.try_wait().map_err(|e| e.to_string())?.is_some() { break; }
        if Instant::now() >= deadline {
            let _ = child.kill(); let _ = child.wait();
            return Err("服务操作超时，请刷新状态后查看服务日志。".into());
        }
        std::thread::sleep(Duration::from_millis(80));
    }
    let output = reader.join().map_err(|_| "服务状态读取失败")?.map_err(|e| e.to_string())?;
    let result: Value = serde_json::from_str(output.trim()).map_err(|_| "服务控制程序没有返回有效状态，请更新服务到支持桌面控制的版本。")?;
    if result["state"] == "error" { return Err(result["message"].as_str().unwrap_or("服务操作失败").into()); }
    Ok(result)
}

fn run_updater(action: &str, version: Option<&str>) -> Result<Value, String> {
    let _guard = UPDATES.lock().map_err(|_| "更新控制器不可用")?;
    let (node, _) = installation_paths(false)?;
    let root = data_root()?;
    let cache = root.join("updates");
    fs::create_dir_all(&cache).map_err(|e| e.to_string())?;
    let helper = cache.join(concat!("desktop-updater-", env!("CARGO_PKG_VERSION"), ".mjs"));
    let source = include_str!("axiom_updater.mjs");
    if fs::read_to_string(&helper).ok().as_deref() != Some(source) {
        fs::write(&helper, source).map_err(|e| e.to_string())?;
    }
    let mut command = Command::new(node);
    command.arg(helper).arg(action);
    if let Some(version) = version { command.arg(version); }
    command.current_dir(&root).env("AXIOM_DATA_DIR", &root).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(windows)] {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command.spawn().map_err(|e| format!("无法启动更新控制程序：{e}"))?;
    let stdout = child.stdout.take().ok_or("无法读取更新状态")?;
    let reader = std::thread::spawn(move || {
        let mut output = String::new();
        stdout.take(65536).read_to_string(&mut output).map(|_| output)
    });
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        if child.try_wait().map_err(|e| e.to_string())?.is_some() { break; }
        if Instant::now() >= deadline {
            let _ = child.kill(); let _ = child.wait();
            return Err("检查更新超时，请稍后重试；已提交的更新任务会继续运行。".into());
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    let output = reader.join().map_err(|_| "更新状态读取失败")?.map_err(|e| e.to_string())?;
    let mut result: Value = serde_json::from_str(output.trim()).map_err(|_| "更新控制程序没有返回有效状态")?;
    if result["state"] == "error" { return Err(result["message"].as_str().unwrap_or("更新失败").into()); }
    result["clientVersion"] = json!(env!("CARGO_PKG_VERSION"));
    result["clientSupported"] = json!(cfg!(windows));
    Ok(result)
}

#[tauri::command]
pub async fn axiom_update(window: WebviewWindow, action: String, version: Option<String>) -> Result<Value, String> {
    let url = window.url().map_err(|e| e.to_string())?;
    let local = (url.scheme() == "tauri" && url.host_str() == Some("localhost")) ||
        (["http", "https"].contains(&url.scheme()) && url.host_str() == Some("tauri.localhost") && url.port().is_none());
    if window.label() != "pake" || !local { return Err("更新仅可从客户端内置页面调用。".into()); }
    if !["status", "check", "service", "client", "recover", "installer"].contains(&action.as_str()) { return Err("不支持的更新操作".into()); }
    if ["client", "installer"].contains(&action.as_str()) && !cfg!(windows) { return Err("本机平台尚未提供客户端安装包，请从发布页下载。".into()); }
    let install = action == "installer";
    let backend = ["service", "recover"].contains(&action.as_str());
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _control = if backend { Some(CONTROL.lock().map_err(|_| "服务控制器不可用")?) } else { None };
        run_updater(&action, version.as_deref())
    }).await.map_err(|e| e.to_string())??;
    if backend {
        if let Some(workbench) = window.app_handle().get_webview_window("axiom-workbench") { let _ = workbench.close(); }
    }
    if install {
        #[cfg(windows)] {
            let installer = result["installer"].as_str().ok_or("缺少已校验的安装包")?;
            let system = env::var_os("SystemRoot").map(PathBuf::from).ok_or("找不到 Windows 安装程序")?;
            Command::new(system.join("System32/msiexec.exe")).arg("/i").arg(installer)
                .spawn().map_err(|e| format!("无法打开安装向导：{e}"))?;
            window.app_handle().exit(0);
        }
    }
    Ok(result)
}

#[tauri::command]
pub async fn axiom_service(window: WebviewWindow, action: String) -> Result<Value, String> {
    let url = window.url().map_err(|e| e.to_string())?;
    let local = (url.scheme() == "tauri" && url.host_str() == Some("localhost")) ||
        (["http", "https"].contains(&url.scheme()) && url.host_str() == Some("tauri.localhost") && url.port().is_none());
    if window.label() != "pake" || !local { return Err("服务控制仅可从客户端内置页面调用。".into()); }
    if !["start", "stop", "status", "open"].contains(&action.as_str()) { return Err("不支持的服务操作".into()); }
    let open = action == "open";
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _guard = CONTROL.lock().map_err(|_| "服务控制器不可用")?;
        if ["start", "stop"].contains(&action.as_str()) {
            let update = run_updater("busy", None)?;
            if update["busy"] == true {
                return Err("后台更新正在进行，请等待完成后再操作服务。".into());
            }
        }
        run(if open { "status" } else { &action })
    }).await.map_err(|e| e.to_string())??;
    if result["state"] != "running" {
        if let Some(workbench) = window.app_handle().get_webview_window("axiom-workbench") { let _ = workbench.close(); }
        if open { return Err("服务尚未就绪，请先启动后台服务。".into()); }
    } else if open {
        let target = tauri::Url::parse(result["url"].as_str().ok_or("缺少工作台地址")?).map_err(|e| e.to_string())?;
        if target.scheme() != "http" || target.host_str() != Some("127.0.0.1") || !target.username().is_empty() || target.password().is_some() { return Err("工作台地址不合法".into()); }
        if let Some(workbench) = window.app_handle().get_webview_window("axiom-workbench") {
            if workbench.url().map_err(|e| e.to_string())?.origin() != target.origin() {
                // Navigation is pinned to the origin at creation. Rebuild when the
                // service moves, and wait until Tauri releases the old window label.
                workbench.destroy().map_err(|e| e.to_string())?;
                let deadline = Instant::now() + Duration::from_secs(5);
                while window.app_handle().get_webview_window("axiom-workbench").is_some() {
                    if Instant::now() >= deadline { return Err("旧工作台尚未关闭，请稍后重试。".into()); }
                    tokio::time::sleep(Duration::from_millis(25)).await;
                }
            }
        }
        if let Some(workbench) = window.app_handle().get_webview_window("axiom-workbench") {
            workbench.show().map_err(|e| e.to_string())?;
            workbench.set_focus().map_err(|e| e.to_string())?;
        } else {
            let origin = target.origin();
            let builder = WebviewWindowBuilder::new(window.app_handle(), "axiom-workbench", WebviewUrl::External(target))
                .title("Axiom2 · 工作台").inner_size(1440.0, 900.0).min_inner_size(360.0, 600.0)
                .on_navigation(move |url| url.origin() == origin);
            #[cfg(windows)]
            let builder = builder.additional_browser_args("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --disable-blink-features=AutomationControlled");
            builder.build().map_err(|e| e.to_string())?;
        }
    }
    Ok(result)
}
