import { cp, mkdir, readFile, writeFile, rm, symlink } from "node:fs/promises";
import { spawn, execFileSync } from "node:child_process";
import { dirname, join, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
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
if (testInstance) {
  // Only the separate test application exposes CDP. Shipped builds contain no debugging hook.
  const windowPath = join(template, "src-tauri/src/app/window.rs");
  const windowSource = await readFile(windowPath, "utf8");
  const needle = 'window_builder = window_builder.additional_browser_args(&windows_browser_args);';
  if (!windowSource.includes(needle)) throw Error("Pake window builder changed");
  const args = 'format!("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --disable-blink-features=AutomationControlled --remote-debugging-port={}", std::env::var("AXIOM_DESKTOP_DEBUG_PORT").unwrap().parse::<u16>().unwrap())';
  await writeFile(windowPath, windowSource.replace(needle, `window_builder = window_builder.additional_browser_args(&${args});`));
  bridge = bridge.replace('additional_browser_args("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --disable-blink-features=AutomationControlled")', `additional_browser_args(&${args})`);
}
await writeFile(join(template, "src-tauri/src/axiom_service.rs"), bridge);
const libPath = join(template, "src-tauri/src/lib.rs");
let lib = await readFile(libPath, "utf8");
const marker = ".invoke_handler(tauri::generate_handler![";
if (!lib.includes(marker)) throw Error("Pake template changed: invoke handler not found");
lib = "mod axiom_service;\n" + lib.replace(marker, marker + "\n            axiom_service::axiom_service,");
await writeFile(libPath, lib);
const configPath = join(template, "src-tauri/tauri.conf.json");
const config = JSON.parse(await readFile(configPath, "utf8"));
const version = JSON.parse(await readFile(join(repo, "package.json"), "utf8")).version;
config.version = version;
config.app.security.csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost; object-src 'none'; frame-src 'none'; base-uri 'self'";
await writeFile(configPath, JSON.stringify(config, null, 2));
// Pake's Rust package version is also used by Windows executable metadata.
const cargoPath = join(template, "src-tauri/Cargo.toml");
const cargo = await readFile(cargoPath, "utf8");
await writeFile(cargoPath, cargo.replace(/^version = "[^"]+"/m, `version = "${version}"`));
const extra = process.argv.slice(2).filter((arg) => arg !== "--test-instance");
if (testInstance) extra.push("--identifier", "local.axiom2.desktop.test", "--name", "Axiom2-ServiceTest");
const child = spawn(process.execPath, [join(template, "dist/cli.js"), "--config", "desktop/pake.json", ...extra], {
  cwd: join(repo, "app"), env: process.env, stdio: "inherit",
});
child.once("error", (error) => { console.error(error); process.exitCode = 1; });
child.once("exit", (code) => { process.exitCode = code ?? 1; });
