import { cp, mkdir, readFile, writeFile, rm, symlink } from "node:fs/promises";
import { spawn, execFileSync } from "node:child_process";
import { dirname, join, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { instrumentInstaller } from "./desktop-test-bridge.mjs";
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testInstance = process.argv.includes("--test-instance");
const toolchain = join(repo, "artifacts", "pake-toolchain");
const source = join(toolchain, "node_modules", "pake-cli");
const npm = (args) => {
  if (process.env.npm_execpath) return execFileSync(process.execPath, [process.env.npm_execpath, ...args], { cwd: repo, stdio: "inherit" });
  if (process.platform === "win32") return execFileSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", 'npm install --prefix artifacts/pake-toolchain --ignore-scripts --no-audit --no-fund --save-exact pake-cli@3.16.2'], { cwd: repo, stdio: "inherit" });
  return execFileSync("npm", args, { cwd: repo, stdio: "inherit" });
};
let pkg;
try { pkg = JSON.parse(await readFile(join(source, "package.json"), "utf8")); } catch {}
if (pkg?.version !== "3.16.2") npm(["install", "--prefix", toolchain, "--ignore-scripts", "--no-audit", "--no-fund", "--save-exact", "pake-cli@3.16.2"]);
const template = join(repo, "artifacts", "pake-template");
await mkdir(template, { recursive: true });
// Keep the isolated Cargo target cache, but refresh every source/config input.
for (const name of ["package.json", "package-lock.json", "pnpm-lock.yaml", "rust-toolchain.toml"]) {
  try { await cp(join(source, name), join(template, name)); } catch (error) { if (error.code !== "ENOENT") throw error; }
}
await cp(join(source, "src-tauri"), join(template, "src-tauri"), {
  recursive: true,
  filter: (path) => !["target", ".pake", "gen"].includes(relative(join(source, "src-tauri"), path).split(sep)[0]),
});
await mkdir(join(template, "dist"), { recursive: true });
await cp(join(source, "dist", "cli.js"), join(template, "dist", "cli.js"));
await rm(join(template, "node_modules"), { recursive: true, force: true });
await symlink(join(toolchain, "node_modules"), join(template, "node_modules"), process.platform === "win32" ? "junction" : "dir");
let bridge = await readFile(join(repo, "app/desktop/axiom_service.rs"), "utf8");
let views = await readFile(join(repo, "app/desktop/axiom_views.rs"), "utf8");
if (testInstance) {
  // Only the separate test application exposes CDP. Shipped builds contain no debugging hook.
  const windowPath = join(template, "src-tauri/src/app/window.rs");
  const windowSource = await readFile(windowPath, "utf8");
  const needle = 'window_builder = window_builder.additional_browser_args(&windows_browser_args);';
  if (!windowSource.includes(needle)) throw Error("Pake window builder changed");
  const args = 'format!("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --disable-blink-features=AutomationControlled --remote-debugging-port={}", std::env::var("AXIOM_DESKTOP_DEBUG_PORT").unwrap().parse::<u16>().unwrap())';
  await writeFile(windowPath, windowSource.replace(needle, `window_builder = window_builder.additional_browser_args(&${args});`));
  views = views.replace('additional_browser_args("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --disable-blink-features=AutomationControlled")', `additional_browser_args(&${args})`);
  bridge = instrumentInstaller(bridge);
}
await writeFile(join(template, "src-tauri/src/axiom_service.rs"), bridge);
await writeFile(join(template, "src-tauri/src/axiom_views.rs"), views);
await cp(join(repo, "app/desktop/axiom_connection.rs"), join(template, "src-tauri/src/axiom_connection.rs"));
for (const name of ["axiom_remote.rs", "axiom_setup.rs", "setup.ps1", "setup.sh", "setup-service.mjs"]) await cp(join(repo, "app/desktop", name), join(template, "src-tauri/src", name));
for (const [input, output] of [["test-probe.rs", "axiom_probe.rs"], ["test-controller-probe.js", "axiom_controller_probe.js"], ["test-workbench-probe.js", "axiom_workbench_probe.js"]]) {
  const destination = join(template, "src-tauri/src", output);
  if (testInstance) await cp(join(repo, "app/desktop", input), destination);
  else await rm(destination, { force: true });
}
let updater = await readFile(join(repo, "app/desktop/updater.mjs"), "utf8");
if (testInstance) {
  updater = updater.replace('"https://api.github.com/repos/cosyeezz/axiom2/releases/latest"', '(process.env.AXIOM_UPDATE_TEST_ORIGIN ? process.env.AXIOM_UPDATE_TEST_ORIGIN + "/latest" : "https://api.github.com/repos/cosyeezz/axiom2/releases/latest")')
    .replace('"https://github.com/cosyeezz/axiom2/releases/download/"', '(process.env.AXIOM_UPDATE_TEST_ORIGIN ? process.env.AXIOM_UPDATE_TEST_ORIGIN + "/download/" : "https://github.com/cosyeezz/axiom2/releases/download/")');
}
await writeFile(join(template, "src-tauri/src/axiom_updater.mjs"), updater);
const libPath = join(template, "src-tauri/src/lib.rs");
let lib = await readFile(libPath, "utf8");
const marker = ".invoke_handler(tauri::generate_handler![";
if (!lib.includes(marker)) throw Error("Pake template changed: invoke handler not found");
lib = "mod axiom_service;\nmod axiom_views;\nmod axiom_connection;\nmod axiom_remote;\nmod axiom_setup;\n" + lib.replace(marker, marker + "\n            axiom_setup::axiom_setup, axiom_remote::axiom_peers, axiom_remote::axiom_remote, axiom_remote::axiom_local, axiom_service::axiom_service, axiom_service::axiom_update, axiom_views::axiom_controls, axiom_views::axiom_page_ready, axiom_connection::axiom_connection, axiom_connection::axiom_connection_report,");
if (testInstance) {
  const loadedMarker = "let label = webview.label();";
  if (!lib.includes(loadedMarker)) throw Error("Pake template changed: page-load hook not found");
  lib = "mod axiom_probe;\n" + lib.replace(marker, marker + "\n            axiom_probe::axiom_test_probe,")
    .replace(loadedMarker, "axiom_probe::loaded(webview);\n            " + loadedMarker);
}
const pageLoadMarker = '.on_page_load(move |webview, payload| {';
if (!lib.includes(pageLoadMarker)) throw Error("Pake template changed: page load callback not found");
lib = lib.replace(pageLoadMarker, pageLoadMarker + '\n            axiom_views::watch_control(webview);\n            if webview.label() == "axiom-workbench" { axiom_connection::invalidate(); }');
const closeMarker = '.on_window_event(move |_window, _event| {';
if (!lib.includes(closeMarker)) throw Error("Pake template changed: window event handler not found");
lib = lib.replace(closeMarker, closeMarker + `
            // The controller owns the desktop lifetime, never the detached service.
            if _window.label() == "pake" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = _event {
                    api.prevent_close();
                    let app = _window.app_handle().clone();
                    tauri::async_runtime::spawn_blocking(move || {
                        if axiom_setup::is_running() {
                            let _ = axiom_views::controls(&app, false);
                        } else { app.exit(0); }
                    });
                    return;
                }
            }
            if _window.label() == "pake" && matches!(_event, tauri::WindowEvent::Resized(_) | tauri::WindowEvent::ScaleFactorChanged { .. }) {
                let _ = axiom_views::layout(_window.app_handle());
            }
`);
// Adding a child makes get_webview_window return None. Native lifetime handlers
// must address the parent Window directly on both platforms.
for (const handle of ["app", "_app"]) {
  const needle = `if let Some(window) = ${handle}.get_webview_window("pake") {`;
  const start = lib.indexOf(needle);
  if (start < 0) throw Error(`Pake template changed: ${handle} reveal handler not found`);
  const end = lib.indexOf("let _ = window.set_focus();", start);
  if (end < 0) throw Error("Pake template changed: reveal focus not found");
  const original = lib.slice(start, end).replace('get_webview_window("pake")', 'get_window("pake")').replace("reapply_window_icon(&window);", "");
  const reveal = handle === "_app" ? original.replace("let _ = window.show();", "let _ = window.unminimize();\n                        let _ = window.show();") : original;
  lib = lib.slice(0, start) + reveal
    + `let _ = window.set_focus();\n                    let _ = axiom_views::focus(${handle});` + lib.slice(end + "let _ = window.set_focus();".length);
}
await writeFile(libPath, lib);
const menuPath = join(template, "src-tauri/src/app/menu.rs");
const menu = await readFile(menuPath, "utf8");
const menuMarker = "pub fn handle_menu_click(app_handle: &AppHandle, id: &str) {";
if (!menu.includes(menuMarker)) throw Error("Pake template changed: macOS menu handler not found");
await writeFile(menuPath, menu.replace(menuMarker, menuMarker + "\n    if crate::axiom_views::menu_action(app_handle, id) { return; }"));
const invokePath = join(template, "src-tauri/src/app/invoke.rs");
const invokeSource = await readFile(invokePath, "utf8");
const zoomMarker = "pub fn set_zoom(window: WebviewWindow, percent: f64)";
if (!invokeSource.includes(zoomMarker)) throw Error("Pake template changed: zoom command not found");
await writeFile(invokePath, invokeSource.replace(zoomMarker, "pub fn set_zoom(window: tauri::Webview, percent: f64)"));
const configPath = join(template, "src-tauri/tauri.conf.json");
const config = JSON.parse(await readFile(configPath, "utf8"));
const version = JSON.parse(await readFile(join(repo, "package.json"), "utf8")).version;
config.version = version;
config.app.security.csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost; object-src 'none'; frame-src 'none'; base-uri 'self'";
await writeFile(configPath, JSON.stringify(config, null, 2));
// Pake's Rust package version is also used by Windows executable metadata.
const cargoPath = join(template, "src-tauri/Cargo.toml");
let cargo = await readFile(cargoPath, "utf8");
cargo = cargo.replace(/rust-version = "[^"]+"/, 'rust-version = "1.89.0"');
const featureMarker = 'tauri = { version = "2.10.2", features = [';
if (!cargo.includes(featureMarker)) throw Error("Pake template changed: Tauri features not found");
cargo = cargo.replace(featureMarker, featureMarker + '\n  "unstable",');
await writeFile(cargoPath, cargo.replace(/^version = "[^"]+"/m, `version = "${version}"`));
const extra = process.argv.slice(2).filter((arg) => arg !== "--test-instance");
if (testInstance) {
  const identifier = process.env.AXIOM_DESKTOP_TEST_IDENTIFIER || "local.axiom2.desktop.test";
  if (!/^local\.axiom2\.desktop\.test(?:\.[a-z0-9]+)*$/.test(identifier)) throw Error("Invalid isolated test identifier");
  extra.push("--identifier", identifier, "--name", "Axiom2-ServiceTest");
}
const child = spawn(process.execPath, [join(template, "dist/cli.js"), "--config", "desktop/pake.json", ...extra, "--app-version", version], {
  cwd: join(repo, "app"), env: process.env, stdio: "inherit",
});
child.once("error", (error) => { console.error(error); process.exitCode = 1; });
child.once("exit", (code) => { process.exitCode = code ?? 1; });
