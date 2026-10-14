// Exercise the actual release tarball in an isolated global npm prefix.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

const root = resolve(import.meta.dirname, "..");
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const app = JSON.parse(await readFile(join(root, "app/package.json"), "utf8"));
assert.deepEqual(pkg.dependencies, app.dependencies, "Root and app runtime dependencies must match");
assert.deepEqual(pkg.devDependencies, app.devDependencies, "Root and app build dependencies must match");
assert.equal(pkg.version, app.version);
assert.ok(process.env.npm_execpath, "Run through npm run check:package");
const temporary = await mkdtemp(join(tmpdir(), "axiom2-package-"));
const npm = (args) => execFileSync(process.execPath, [process.env.npm_execpath, ...args], {
  cwd: root, encoding: "utf8", timeout: 240_000, maxBuffer: 10_000_000,
});
let child;
let cli;
let serviceEnv;
const control = (action) => JSON.parse(execFileSync(process.execPath, [cli, action, "--json"], {
  encoding: "utf8", env: serviceEnv, cwd: temporary, timeout: 50_000,
}));
const request = (url, options = {}) => fetch(url, { ...options, signal: AbortSignal.timeout(3000) });
try {
  const [packed] = JSON.parse(npm(["pack", "--ignore-scripts", "--json", "--pack-destination", temporary]));
  const paths = packed.files.map((file) => file.path);
  for (const file of ["npm-shrinkwrap.json", "bin/axiom2.mjs", "bin/service.mjs", "app/dist/server/index.js", "app/dist/server/agent-worker.js", "app/dist/server/compression-worker.js", "app/dist/client/index.html"])
    assert.ok(paths.includes(file), `Missing runtime file: ${file}`);
  assert.ok(!paths.some((path) => /(?:^|\/)(?:auth\.json|models\.json|\.env|test-results|sessions|\.aoci)(?:\/|$)/.test(path)));
  const prefix = join(temporary, "prefix");
  npm(["install", "--global", "--prefix", prefix, "--no-audit", "--no-fund", join(temporary, packed.filename)]);
  const installed = join(prefix, ...(process.platform === "win32" ? [] : ["lib"]), "node_modules", "@cosyeezz", "axiom2");
  cli = join(installed, "bin/axiom2.mjs");
  assert.equal(execFileSync(process.execPath, [cli, "--version"], { encoding: "utf8" }).trim(), pkg.version);
  assert.match(execFileSync(process.execPath, [cli, "--help"], { encoding: "utf8" }), /4317/);
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const pi = join(temporary, "pi");
  await mkdir(pi);
  let output = "";
  serviceEnv = { ...process.env, AXIOM_PORT: String(port), AXIOM_DATA_DIR: "data", AXIOM_PI_DIR: pi, PI_CODING_AGENT_DIR: pi, NODE_PATH: "" };
  assert.equal(control("status").state, "stopped");
  child = spawn(process.execPath, [cli], {
    cwd: temporary,
    env: serviceEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  let response;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null) throw Error(`Installed service exited: ${output}`);
    try { response = await request(`http://127.0.0.1:${port}/`); if (response.ok) break; } catch {}
    await delay(250);
  }
  assert.ok(response?.ok, `Installed service did not become ready: ${output}`);
  const html = await response.text();
  assert.match(html, /<div id="root"><\/div>/);
  const asset = html.match(/src="([^"]+\.js)"/)?.[1];
  assert.ok(asset, "Built page must reference a JS asset");
  assert.equal((await request(new URL(asset, `http://127.0.0.1:${port}`))).status, 200);
  assert.equal((await request(`http://127.0.0.1:${port}/`, { headers: { Origin: "https://example.com" } })).status, 403);
  // The control descriptor appears only after both service and control listener are ready.
  for (let attempt = 0; attempt < 40 && control("status").state !== "running"; attempt++) await delay(100);
  const foreground = control("status");
  assert.equal(foreground.state, "running");
  assert.equal(foreground.background, false);
  assert.deepEqual(foreground.active, []);
  const meta = JSON.parse(await readFile(join(temporary, "data/service-control.json"), "utf8"));
  const endpoint = `http://127.0.0.1:${meta.port}`;
  assert.equal((await request(endpoint + "/stop", { method: "POST" })).status, 403);
  assert.equal((await request(endpoint + "/stop", { method: "POST", headers: { Authorization: `Bearer ${meta.token}`, Origin: "http://127.0.0.1:4317" } })).status, 403);
  assert.equal(control("status").state, "running", "Unauthorized stop must not stop service");
  assert.equal(control("start").pid, foreground.pid, "Start must reuse a managed foreground service");
  assert.equal(control("stop").state, "stopped");
  await delay(150);
  assert.equal(control("stop").state, "stopped", "Stop is idempotent");
  const background = control("start");
  assert.equal(background.state, "running");
  assert.equal(background.background, true);
  assert.notEqual(background.pid, foreground.pid);
  assert.equal(control("start").pid, background.pid, "Repeated start must not spawn a second service");
  assert.equal((await request(`http://127.0.0.1:${port}/`)).status, 200);
  assert.equal(control("stop").state, "stopped");
  // An unrelated listener is detected but can never be terminated by the manager.
  const unrelated = createServer((socket) => socket.end());
  await new Promise((resolve) => unrelated.listen(port, "127.0.0.1", resolve));
  try {
    assert.equal(control("status").state, "unmanaged");
    assert.throws(() => control("stop"));
    assert.throws(() => control("start"));
    assert.equal(unrelated.listening, true);
  } finally { await new Promise((resolve) => unrelated.close(resolve)); }
  console.log(`PASS: ${packed.filename}; ${paths.length} files; isolated install, HTTP/assets/Origin, foreground/background lifecycle, duplicate start, authenticated stop and unrelated-process protection`);
} finally {
  if (cli && serviceEnv) { try { control("stop"); } catch {} }
  if (child && child.exitCode === null) {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    await Promise.race([exited, delay(5000).then(() => { if (child.exitCode === null) child.kill("SIGKILL"); })]);
  }
  await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
