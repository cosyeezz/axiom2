// Connect an already-running development service without restarting its agents.
// A newer backend with its own Tailnet listener automatically takes over.
import { RemoteAccess } from "../app/dist/server/remote-access.js";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const target = new URL(process.argv[2] || "http://127.0.0.1:4317");
if (target.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) || target.username || target.password || target.pathname !== "/" || target.search || target.hash) throw Error("Expected a loopback development service origin");
const root = fileURLToPath(new URL("../artifacts/development-tailnet/", import.meta.url));
await mkdir(root, { recursive: true });
const statePath = join(root, "process.json");
try {
  const existing = JSON.parse(await readFile(statePath, "utf8"));
  let alive = false;
  if (Number.isInteger(existing.pid) && existing.pid > 0) { try { process.kill(existing.pid, 0); alive = true; } catch {} }
  if (alive) { console.log("Development Tailnet bridge is already running"); process.exit(0); }
} catch {}
const gateway = new RemoteAccess(target.origin);
await gateway.initialize();
if (gateway.status().error) { await gateway.close(); throw Error(gateway.status().error); }
await writeFile(statePath, JSON.stringify({ pid: process.pid, target: target.origin, urls: gateway.status().urls }));
console.log(JSON.stringify({ pid: process.pid, target: target.origin, ...gateway.status() }));
let closing = false, checking = false;
async function close() {
  if (closing) return; closing = true; clearInterval(monitor); await gateway.close();
  const state = JSON.parse(await readFile(statePath, "utf8").catch(() => "{}"));
  if (state.pid === process.pid) await rm(statePath, { force: true });
}
const monitor = setInterval(async () => {
  if (checking || closing) return; checking = true;
  try {
    const response = await fetch(new URL("/api/remote", target), { signal: AbortSignal.timeout(2000) });
    if (response.ok) {
      const value = await response.json();
      if (Array.isArray(value.urls) && typeof value.error === "string") { console.log("Development backend now manages Tailnet; releasing bridge listeners"); await close(); }
    }
  } catch {} finally { checking = false; }
}, 5000);
process.on("SIGINT", () => void close()); process.on("SIGTERM", () => void close());
