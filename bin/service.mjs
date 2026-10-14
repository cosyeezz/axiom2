import { createServer } from "node:http";
import { createConnection } from "node:net";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile, rename, rm, open, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

export const root = resolve(process.env.AXIOM_DATA_DIR || (process.platform === "win32"
  ? join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "Axiom2")
  : process.platform === "darwin" ? join(homedir(), "Library", "Application Support", "Axiom2")
  : join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "Axiom2")));
const descriptor = join(root, "service-control.json");
const cli = fileURLToPath(new URL("./axiom2.mjs", import.meta.url));
const port = Number(process.env.AXIOM_PORT ?? 4317);
const log = join(root, "service.log");
const stopped = () => ({ state: "stopped", active: [], log });

async function atomicJson(path, value) {
  const temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}
export async function registerInstallation() {
  await mkdir(root, { recursive: true, mode: 0o700 });
  await atomicJson(join(root, "installation.json"), { node: process.execPath, cli });
}
async function metadata() {
  try {
    const value = JSON.parse(await readFile(descriptor, "utf8"));
    if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535 || !/^[a-f0-9]{64}$/.test(value.token)) return null;
    return value;
  } catch { return null; }
}
async function request(meta, action) {
  const response = await fetch(`http://127.0.0.1:${meta.port}/${action}`, {
    method: action === "stop" ? "POST" : "GET",
    headers: { Authorization: `Bearer ${meta.token}` },
    signal: AbortSignal.timeout(2000),
  });
  if (!response.ok) throw Error("后台服务控制通道不可用");
  const result = await response.json();
  if (result.instance !== meta.token || !["running", "stopping"].includes(result.state)) throw Error("后台服务身份不匹配");
  // The instance secret is only used between local processes, never returned to the UI.
  delete result.instance;
  return result;
}
async function occupied() {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error("AXIOM_PORT 无效");
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const done = (value) => { socket.destroy(); resolve(value); };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.setTimeout(1000, () => done(false));
  });
}
export async function status() {
  const meta = await metadata();
  if (meta) {
    try { return await request(meta, "status"); } catch { /* A dead process can leave a descriptor. Never kill a PID from it. */ }
  }
  return await occupied()
    ? { state: "unmanaged", active: [], log, message: `端口 ${port} 已被占用，但不是可管理的 Axiom2 服务。若运行着旧版服务，请先在原终端退出，再启动后台服务。` }
    : stopped();
}
export async function start() {
  const current = await status();
  if (current.state === "running") return current;
  if (current.state !== "stopped") throw Error(current.message || "服务正在退出，请稍后再启动");
  await registerInstallation();
  try { if ((await stat(log)).size > 5 * 1024 * 1024) await rename(log, log + ".previous"); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const output = await open(log, "a", 0o600);
  let launchError;
  try {
    const child = spawn(process.execPath, [cli, "--daemon"], {
      cwd: root, env: { ...process.env, AXIOM_DATA_DIR: root,
        ...(process.env.AXIOM_PI_DIR ? { AXIOM_PI_DIR: resolve(process.env.AXIOM_PI_DIR) } : {}),
        ...(process.env.PI_CODING_AGENT_DIR ? { PI_CODING_AGENT_DIR: resolve(process.env.PI_CODING_AGENT_DIR) } : {}),
      }, detached: true, windowsHide: true,
      stdio: ["ignore", output.fd, output.fd],
    });
    child.on("error", (error) => { launchError = error; });
    child.unref();
  } finally { await output.close(); }
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    if (launchError) throw launchError;
    const meta = await metadata();
    if (meta) {
      try { const result = await request(meta, "status"); if (result.state === "running") return result; } catch {}
    }
    await delay(300);
  }
  throw Error(`后台服务未能在限定时间内就绪，请查看日志：${log}`);
}
export async function stop() {
  const meta = await metadata();
  const current = await status();
  if (current.state === "stopped") return current;
  if (!meta || current.state === "unmanaged") throw Error(current.message || "没有可管理的后台服务");
  await request(meta, "stop");
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    // Only wait for this exact instance. A concurrently started replacement is never stopped.
    try { await request(meta, "status"); } catch {
      const latest = await metadata();
      if (latest?.token !== meta.token) return await status();
      const current = await status();
      if (current.state === "stopped") return current;
      // A transient control connection failure is not proof that shutdown finished.
    }
    await delay(200);
  }
  throw Error(`服务仍在退出，尚未确认停止。请稍后刷新状态；日志：${log}`);
}

export async function serve(background = false) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error("AXIOM_PORT 无效");
  const { getAgentDir } = await import("@earendil-works/pi-coding-agent");
  process.env.AXIOM_PI_DIR ||= getAgentDir();
  const { startServer } = await import("../app/dist/server/index.js");
  const app = await startServer({ root, port });
  const token = randomBytes(32).toString("hex");
  let closing = false;
  const active = () => app.store.db.prepare(`SELECT s.title FROM sessions s WHERE
    EXISTS(SELECT 1 FROM runs r WHERE r.sessionId=s.id AND r.status IN ('starting','running','stopping'))
    OR EXISTS(SELECT 1 FROM tasks t WHERE t.parentSessionId=s.id AND t.status IN ('queued','starting','running','wrapping','stopping','summarizing'))
    OR EXISTS(SELECT 1 FROM compressions c WHERE c.sessionId=s.id AND json_extract(c.body,'$.state')='running') LIMIT 20`).all().map((row) => String(row.title || "未命名会话").slice(0, 160));
  const snapshot = () => ({ state: closing ? "stopping" : "running", instance: token, pid: process.pid,
    url: app.accessUrl, background, active: closing ? [] : active(), log });
  let controlPort = 0;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    try {
      await app.close();
      if ((await metadata())?.token === token) await rm(descriptor, { force: true });
      control.closeAllConnections();
      await new Promise((resolve) => control.close(resolve));
      process.exit(0);
    } catch (error) { console.error(error); process.exit(1); }
  };
  const control = createServer((req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.headers.host !== `127.0.0.1:${controlPort}` || req.headers.origin || req.headers["sec-fetch-site"] === "cross-site" ||
        req.headers.authorization !== `Bearer ${token}`) { res.writeHead(403); res.end(); return; }
    if (!((req.url === "/status" && req.method === "GET") || (req.url === "/stop" && req.method === "POST"))) {
      res.writeHead(405); res.end(); return;
    }
    try {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(snapshot()));
      if (req.url === "/stop") void shutdown();
    } catch { res.writeHead(500); res.end(); }
  });
  control.requestTimeout = 5000;
  control.headersTimeout = 5000;
  try {
    await new Promise((resolve, reject) => { control.once("error", reject); control.listen(0, "127.0.0.1", resolve); });
    controlPort = control.address().port;
    await registerInstallation();
    await atomicJson(descriptor, { port: controlPort, token });
  } catch (error) { control.close(); await app.close(); throw error; }
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { void shutdown(); });
  console.log(`Axiom2 已启动：${app.accessUrl}\n数据目录：${root}\n${background ? "后台服务运行中，可在客户端关闭，或运行 axiom2 stop。" : "保留此终端，Ctrl+C 退出服务；也可在客户端关闭服务。"}`);
}
