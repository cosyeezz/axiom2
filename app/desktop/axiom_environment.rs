// Read-only desktop inventory. No commands, recovery routines or package managers run here.
use serde_json::{json, Value};
use std::{collections::HashSet, env, path::{Path, PathBuf}, time::{Duration, Instant}};
#[cfg(test)] use std::fs;
#[path = "axiom_environment_fs.rs"]
mod inventory_fs;

const MAX_ENTRIES: usize = 20_000;
const MAX_DEPTH: usize = 48;
const MAX_PATH_DIRS: usize = 128;
const MAX_ISSUES: usize = 8;

struct Budget { entries: usize, started: Instant }
impl Budget {
    fn available(&self) -> bool { self.entries < MAX_ENTRIES && self.started.elapsed() < Duration::from_secs(5) }
}
#[derive(Default)]
struct Size { bytes: u64, files: usize, links: usize, complete: bool, issues: Vec<String> }
impl Size {
    fn issue(&mut self, message: String) {
        self.complete = false;
        if self.issues.len() < MAX_ISSUES && !self.issues.contains(&message) { self.issues.push(message); }
    }
}

fn walk(entry: inventory_fs::Entry, depth: usize, size: &mut Size, budget: &mut Budget) {
    if !budget.available() { size.issue("达到扫描数量或时间上限，大小仅为已读取部分".into()); return; }
    budget.entries += 1;
    let metadata = entry.metadata;
    if metadata.link { size.links += 1; return; }
    if metadata.file { size.files += 1; size.bytes = size.bytes.saturating_add(metadata.bytes); return; }
    if !metadata.directory { size.issue("跳过特殊文件".into()); return; }
    if depth >= MAX_DEPTH { size.issue("目录层级过深，未继续读取".into()); return; }
    let children = match entry.children() {
        Ok(value) => value,
        Err(error) => { size.issue(format!("无法安全读取目录（{}）", error.kind())); return; }
    };
    for child in children {
        if !budget.available() { size.issue("达到扫描数量或时间上限，大小仅为已读取部分".into()); break; }
        match child {
            Ok(entry) => walk(entry, depth + 1, size, budget),
            Err(error) => { size.issue(format!("目录条目读取失败（{}）", error.kind())); break; }
        }
    }
}
fn location(path: &Path, purpose: &str, budget: &mut Budget) -> Value {
    let mut value = json!({ "path": path.to_string_lossy(), "purpose": purpose, "state": "unknown", "bytes": 0, "files": 0, "links": 0, "complete": false, "issues": [] });
    if !path.is_absolute() {
        value["issues"] = json!(["路径不是绝对路径，未扫描"]); return value;
    }
    if !budget.available() {
        value["issues"] = json!(["达到扫描数量或时间上限，未检查此位置"]); return value;
    }
    match inventory_fs::open(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => { value["state"] = json!("missing"); value["complete"] = json!(true); },
        Err(error) => { value["issues"] = json!([format!("无法安全读取；请检查目录权限或父目录链接（{}）", error.kind())]); },
        Ok(entry) if entry.metadata.link => {
            value["state"] = json!("link"); value["links"] = json!(1);
            value["issues"] = json!(["发现链接；未遍历目标，大小不含目标文件"]);
            // Link destinations may contain unrelated paths; keep inspection to the link itself.
        },
        Ok(entry) => {
            value["state"] = json!("present");
            let mut size = Size { complete: true, ..Size::default() };
            walk(entry, 0, &mut size, budget);
            value["bytes"] = json!(size.bytes); value["files"] = json!(size.files); value["links"] = json!(size.links);
            value["complete"] = json!(size.complete); value["issues"] = json!(size.issues);
        },
    }
    value
}
fn item(id: &str, label: &str, note: &str, paths: Vec<(PathBuf, &str)>, budget: &mut Budget) -> Value {
    let locations: Vec<Value> = paths.into_iter().map(|(path, purpose)| location(&path, purpose, budget)).collect();
    let state = if locations.iter().any(|value| value["state"] == "present" || value["state"] == "link") { "detected" }
        else if locations.iter().all(|value| value["state"] == "missing") { "missing" } else { "unknown" };
    json!({ "id": id, "label": label, "note": note, "state": state, "locations": locations })
}

// This list is evidence only. Names never establish ownership or deletion authority.
fn residuals(root: &Path, budget: &mut Budget) -> Value {
    let mut items = vec![];
    let mut issues = vec![];
    for (relative, purpose) in [("setup", "安装任务文件（归属及占用待核实）"), ("updates", "更新与恢复材料（保留）"), ("service/node_modules/@cosyeezz", "旧版本或更新暂存（保留）")] {
        let mut visited = 0;
        let parent = root.join(relative);
        let directory = match inventory_fs::open(&parent) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            value => value.and_then(|entry| entry.children()),
        };
        let children = match directory {
            Ok(value) => value,
            Err(_) => { issues.push(format!("{}：无法安全枚举，可能存在链接或权限限制", parent.display())); continue; }
        };
        for child in children {
            if visited >= 128 || !budget.available() { issues.push(format!("{}：达到逐项枚举上限，仍可能有未列出的文件", parent.display())); break; }
            visited += 1; budget.entries += 1;
            let entry = match child { Ok(value) => value, Err(_) => { issues.push(format!("{}：部分条目无法核实", parent.display())); break; } };
            let name = entry.name();
            if relative == "service/node_modules/@cosyeezz" && !name.to_string_lossy().starts_with(".axiom2-update-") && !name.to_string_lossy().starts_with(".axiom2-backup-") { continue; }
            let path = parent.join(name);
            let metadata = entry.metadata;
            let summary = |path: &Path, metadata: inventory_fs::Metadata, purpose: &str| json!({
                "path": path.to_string_lossy(), "purpose": purpose, "state": if metadata.link { "link" } else { "present" },
                "bytes": if metadata.file { metadata.bytes } else { 0 }, "files": if metadata.file { 1 } else { 0 },
                "links": if metadata.link { 1 } else { 0 }, "complete": metadata.file,
                "issues": if metadata.file { vec![] } else { vec!["仅列出此条目；目录大小及链接目标未统计"] },
                "automaticRemovalAllowed": false,
                "retention": "保留：未核实任务归属、恢复用途和进程占用，不可自动删除"
            });
            items.push(summary(&path, metadata, purpose));
            // The fixed setup archive deserves its own row, even inside a task directory.
            if relative == "setup" && metadata.directory && !metadata.link && budget.available() {
                budget.entries += 1;
                let archive = path.join("axiom2.tgz");
                match inventory_fs::open(&archive) {
                    Ok(value) => items.push(summary(&archive, value.metadata, "首次安装下载归档（缺少持久归属证明）")),
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {},
                    Err(_) => issues.push(format!("{}：未能核实安装归档", archive.display())),
                }
            }
        }
    }
    json!({ "items": items, "complete": issues.is_empty(), "issues": issues })
}

pub(crate) fn scan(root: &Path, shared_pi: Option<PathBuf>, path_dirs: Vec<PathBuf>, executable: Option<PathBuf>) -> Value {
    let started = Instant::now();
    let mut budget = Budget { entries: 0, started };
    let residuals = residuals(root, &mut budget);
    let mut items = vec![];
    // Small configuration/registration files precede directory walks. Only their
    // size and existence are inspected; no credentials or configuration bodies leave the host.
    let definitions = [
        ("service", "后台服务与应用内 Pi", "应用内 Pi 随后台版本发布。发现文件不代表安装完整；全局或其他数据目录中的安装可能不在此处。", vec![(root.join("installation.json"), "安装登记"), (root.join("service"), "桌面托管程序与依赖")]),
        ("setup", "首次安装文件", "可能包含安装包、解压目录及未结束任务的归属记录；不能把整个目录视为可删除缓存。", vec![(root.join("setup"), "安装包、临时运行文件与任务记录")]),
        ("updates", "更新与恢复文件", "恢复备份和待核实任务可能仍在使用这些文件；清理前需要检查维护事务。", vec![(root.join("updates"), "更新下载与维护记录")]),
        ("opencli", "OpenCLI", "包含托管版本及旧版本；外部 npm 安装和浏览器扩展另行管理。", vec![(root.join("integrations/opencli.json"), "工具配置"), (root.join("integrations/opencli"), "程序与旧版本")]),
        ("rtk", "RTK", "程序、过滤设置、效果记录和保留原文需分别选择清理范围。", vec![(root.join("integrations/rtk/config.json"), "工具配置"), (root.join("integrations/rtk"), "程序、统计与原文")]),
        ("rea", "REA 与分析引擎", "主程序、各引擎和手动下载包是独立项目；关闭 Skill/MCP 接入不会删除包内代码。", vec![(root.join("integrations/rea/config.json"), "工具配置"), (root.join("integrations/rea/versions"), "主程序与旧版本"), (root.join("integrations/rea/engines"), "托管分析引擎"), (root.join("integrations/rea/downloads"), "手动安装下载包")]),
        ("model-proxy", "模型代理组件", "内核、导入组件、运行文件与订阅配置分开管理；运行目录存在不代表进程已经退出。", vec![(root.join("integrations/model-proxy/config.json"), "代理配置"), (root.join("integrations/model-proxy/versions"), "Xray、mihomo 与旧版本"), (root.join("integrations/model-proxy/importer"), "导入组件与下载包"), (root.join("integrations/model-proxy/runs"), "线路运行文件")]),
        ("resources", "独立安装的技能与 MCP", "包含独立包、专属缓存和安装记录；删除前需核对全部作用范围的引用。", vec![(root.join("resources"), "独立安装包与专属缓存")]),
        ("pi-resources", "应用 Pi 配置与资源", "可能包含模型认证、技能、资源包和用户设置；不是可整体清空的程序缓存。", vec![(root.join("pi"), "应用配置与资源")]),
    ];
    for (id, label, note, paths) in definitions { items.push(item(id, label, note, paths, &mut budget)); }
    if let Some(path) = shared_pi {
        if path != root.join("pi") { items.push(item("shared-pi", "共享 Pi 目录", "来自 AXIOM_PI_DIR；可能与终端 Pi 或其他应用共享。本次不读取配置正文。", vec![(path, "共享配置与资源")], &mut budget)); }
    }
    if let Some(path) = executable { items.push(item("client", "桌面客户端", "这里只检查当前可执行文件；客户端完整安装包和系统注册应由系统卸载器处理。", vec![(path, "当前桌面程序")], &mut budget)); }
    let commands = ["pi", "node", "npm", "tailscale", "opencli", "rtk", "java", "jadx", "ghidra", "wasm-decompile"];
    let mut seen = HashSet::new();
    let mut command_locations = vec![];
    let mut path_incomplete = path_dirs.len() > MAX_PATH_DIRS;
    for directory in path_dirs.into_iter().take(MAX_PATH_DIRS) {
        if !directory.is_absolute() { path_incomplete = true; continue; }
        if !seen.insert(directory.clone()) { continue; }
        for command in commands {
            #[cfg(windows)] let suffixes = [".exe", ".cmd", ".bat", ".ps1"];
            #[cfg(not(windows))] let suffixes = [""];
            for suffix in suffixes {
                if !budget.available() { path_incomplete = true; break; }
                budget.entries += 1;
                let path = directory.join(format!("{command}{suffix}"));
                match inventory_fs::open(&path) {
                    Ok(entry) if entry.metadata.file || entry.metadata.link => {
                        command_locations.push(json!({ "command": command, "path": path.to_string_lossy(), "link": entry.metadata.link }));
                    },
                    Ok(_) => {},
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {},
                    Err(_) => { path_incomplete = true; },
                }
            }
        }
    }
    json!({ "scope": "current", "automaticRemovalAllowed": false, "residuals": residuals, "root": root.to_string_lossy(), "items": items, "commands": command_locations, "pathIncomplete": path_incomplete,
        "entries": budget.entries, "elapsedMs": started.elapsed().as_millis(),
        "notes": ["本次仅检查已知目录和桌面进程的 PATH，不执行命令、不删除文件。", "目录大小为文件逻辑大小，不代表可回收磁盘空间；链接目标不计入，重复路径可能重复计数。", "扫描未核实进程占用、跨项目引用、公共包管理器缓存及全部外部安装，不能据此判断环境无冲突。", "桌面进程的 PATH 可能与终端不同；发现命令文件不代表可执行、版本兼容或安装归属已确认。"] })
}

pub(crate) fn validate_selected_root(value: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(value);
    if value.is_empty() || value.len() > 4096 || value.chars().any(char::is_control) || !path.is_absolute()
        || value.split(if cfg!(windows) { &['/', '\\'][..] } else { &['/'][..] }).any(|part| part == "." || part == "..") {
        return Err("请输入不含相对目录段的完整本地路径。".into());
    }
    Ok(path)
}

pub(crate) fn selected(root: &Path) -> Value {
    let started = Instant::now();
    let mut budget = Budget { entries: 0, started };
    let selected = item("selected", "用户指定目录", "安装来源未核实；禁止自动删除。这里只统计文件元数据，不识别安装版本或归属。", vec![(root.to_path_buf(), "指定位置的文件统计")], &mut budget);
    json!({ "scope": "selected", "origin": "unknown", "automaticRemovalAllowed": false,
        "root": root.to_string_lossy(), "items": [selected], "commands": [], "pathIncomplete": false,
        "entries": budget.entries, "elapsedMs": started.elapsed().as_millis(),
        "notes": ["仅扫描所填位置，不包含当前应用、共享 Pi 或 PATH；不读取文件正文，不执行程序，不删除文件。", "链接目标不展开，大小为已读取文件的逻辑大小；缺失或扫描完成均不能证明环境已干净。"] })
}

pub(crate) fn current(root: &Path) -> Value {
    scan(root, env::var_os("AXIOM_PI_DIR").map(PathBuf::from), env::var_os("PATH").map(|value| env::split_paths(&value).take(MAX_PATH_DIRS + 1).collect()).unwrap_or_default(), env::current_exe().ok())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};
    fn fixture() -> PathBuf {
        static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let id = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let path = env::temp_dir().join(format!("axiom-environment-test-{}-{}-{id}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir(&path).unwrap();
        // macOS temp roots are normally symlinked; fixtures deliberately use their real path.
        fs::canonicalize(path).unwrap()
    }
    #[test]
    fn inventory_is_read_only_and_does_not_expose_configuration() {
        let root = fixture();
        fs::create_dir_all(root.join("pi")).unwrap();
        fs::write(root.join("pi/auth.json"), "secret-never-export").unwrap();
        let before = fs::read(root.join("pi/auth.json")).unwrap();
        let result = scan(&root, None, vec![], None);
        assert!(!result.to_string().contains("secret-never-export"));
        assert_eq!(fs::read(root.join("pi/auth.json")).unwrap(), before);
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        let pi = result["items"].as_array().unwrap().iter().find(|item| item["id"] == "pi-resources").unwrap();
        assert_eq!(pi["state"], "detected"); assert_eq!(pi["locations"][0]["bytes"], before.len());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn selected_scan_is_unknown_and_isolated_from_current_installation() {
        let root = fixture();
        fs::write(root.join("auth.json"), "selected-secret").unwrap();
        let result = selected(&root);
        assert_eq!(result["scope"], "selected"); assert_eq!(result["origin"], "unknown");
        assert_eq!(result["automaticRemovalAllowed"], false);
        assert_eq!(result["items"].as_array().unwrap().len(), 1);
        assert_eq!(result["commands"].as_array().unwrap().len(), 0);
        assert_eq!(result["items"][0]["locations"][0]["files"], 1);
        assert!(!result.to_string().contains("selected-secret"));
        assert_eq!(fs::read_to_string(root.join("auth.json")).unwrap(), "selected-secret");
        assert_eq!(selected(&root.join("missing"))["items"][0]["state"], "missing");
        assert!(!root.join("missing").exists());
        for value in ["", "relative", "/tmp/../private", "/tmp/./private", "/tmp/\nprivate"] { assert!(validate_selected_root(value).is_err()); }
        assert!(validate_selected_root(root.to_str().unwrap()).is_ok());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn residual_rows_do_not_infer_removal_authority() {
        let root = fixture();
        fs::create_dir_all(root.join("setup/task-a")).unwrap();
        fs::write(root.join("setup/task-a/axiom2.tgz"), "archive").unwrap();
        fs::create_dir_all(root.join("updates")).unwrap();
        fs::write(root.join("updates/previous-version.json"), "private-recovery-record").unwrap();
        fs::create_dir_all(root.join("service/node_modules/@cosyeezz/.axiom2-backup-fixture")).unwrap();
        fs::create_dir_all(root.join("service/node_modules/@cosyeezz/.axiom2-update-fixture")).unwrap();
        fs::create_dir_all(root.join("service/node_modules/@cosyeezz/axiom2")).unwrap();
        let result = scan(&root, None, vec![], None);
        let rows = result["residuals"]["items"].as_array().unwrap();
        assert_eq!(rows.len(), 5);
        assert!(rows.iter().all(|row| row["automaticRemovalAllowed"] == false));
        assert!(rows.iter().any(|row| row["path"].as_str().unwrap().ends_with("axiom2.tgz") && row["bytes"] == 7));
        assert!(!result.to_string().contains("private-recovery-record"));
        assert_eq!(fs::read_to_string(root.join("updates/previous-version.json")).unwrap(), "private-recovery-record");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn residual_listing_is_bounded() {
        let root = fixture(); fs::create_dir(root.join("setup")).unwrap();
        for index in 0..140 { fs::write(root.join("setup").join(index.to_string()), "fixture").unwrap(); }
        fs::create_dir_all(root.join("service/node_modules/@cosyeezz/.axiom2-backup-fixture")).unwrap();
        let result = scan(&root, None, vec![], None);
        assert_eq!(result["residuals"]["complete"], false);
        let rows = result["residuals"]["items"].as_array().unwrap();
        assert_eq!(rows.len(), 129);
        assert!(rows.iter().any(|row| row["path"].as_str().unwrap().ends_with(".axiom2-backup-fixture")), "setup cannot consume the backup listing quota");
        fs::remove_dir_all(root).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn selected_and_residual_links_do_not_export_target_metadata() {
        use std::os::unix::fs::symlink;
        let root = fixture(); let external = fixture();
        fs::write(external.join("axiom2.tgz"), "external-secret").unwrap();
        fs::create_dir(root.join("setup")).unwrap();
        symlink(&external, root.join("setup/task-link")).unwrap();
        let result = scan(&root, None, vec![], None);
        assert_eq!(result["residuals"]["items"].as_array().unwrap().len(), 1);
        assert_eq!(result["residuals"]["items"][0]["state"], "link");
        assert_eq!(result["residuals"]["items"][0]["bytes"], 0);
        assert_eq!(selected(&root.join("setup/task-link"))["items"][0]["locations"][0]["state"], "link");
        assert_eq!(selected(&root.join("setup/task-link/axiom2.tgz"))["items"][0]["state"], "unknown");
        fs::remove_dir_all(root).unwrap(); fs::remove_dir_all(external).unwrap();
    }
    #[test]
    fn missing_root_is_not_created() {
        let root = fixture(); let missing = root.join("absent");
        let result = scan(&missing, None, vec![], None);
        assert!(result["items"].as_array().unwrap().iter().all(|item| item["state"] == "missing"));
        assert!(!missing.exists()); fs::remove_dir_all(root).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn links_and_linked_ancestors_are_not_traversed() {
        use std::os::unix::fs::symlink;
        let root = fixture(); let external = fixture();
        fs::write(external.join("private"), b"private").unwrap();
        symlink(&external, root.join("pi")).unwrap();
        symlink(&external, root.join("integrations")).unwrap();
        let result = scan(&root, None, vec![], None);
        let items = result["items"].as_array().unwrap();
        let pi = items.iter().find(|item| item["id"] == "pi-resources").unwrap();
        assert_eq!(pi["locations"][0]["state"], "link"); assert_eq!(pi["locations"][0]["bytes"], 0);
        let rea = items.iter().find(|item| item["id"] == "rea").unwrap(); assert_eq!(rea["state"], "unknown");
        assert_eq!(fs::read(external.join("private")).unwrap(), b"private");
        fs::remove_dir_all(root).unwrap(); fs::remove_dir_all(external).unwrap();
    }
    #[test]
    fn bounded_walk_and_path_candidates_report_incomplete_results() {
        let root = fixture(); fs::write(root.join("pi"), "not-an-executable").unwrap();
        let result = scan(&root.join("data"), None, vec![root.clone(), PathBuf::from("relative")], None);
        assert_eq!(result["commands"].as_array().unwrap().len(), 1); assert_eq!(result["pathIncomplete"], true);
        let mut size = Size { complete: true, ..Size::default() };
        let mut budget = Budget { entries: MAX_ENTRIES, started: Instant::now() };
        walk(inventory_fs::open(&root).unwrap(), 0, &mut size, &mut budget);
        assert!(!size.complete); assert!(!size.issues.is_empty());
        fs::remove_dir_all(root).unwrap();
    }
}
