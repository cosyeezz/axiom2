// Exercise the actual release tarball in an isolated global npm prefix.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm, access, realpath } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { createUpdater } from "../app/desktop/updater.mjs";
import { tmpdir } from "node:os";
import { join, resolve, relative } from "node:path";
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
  // Exercise the updater with a real tarball and isolated npm installation. The
  // baseline uses the current runtime with an older version marker; native
  // Windows checks additionally upgrade the actual published v0.2.3 runtime.
  const installedPackage = JSON.parse(await readFile(join(installed, "package.json"), "utf8"));
  for (const strategy of ["hoisted", "nested"]) {
    await writeFile(join(installed, "package.json"), JSON.stringify({ ...installedPackage, version: "0.0.0" }));
    const beforeUpdate = control("start");
    const archive = await readFile(join(temporary, packed.filename));
    const archiveUrl = `https://github.com/cosyeezz/axiom2/releases/download/v${pkg.version}/axiom2.tgz`;
    const release = { tag_name: `v${pkg.version}`, draft: false, prerelease: false, assets: [{ name: "axiom2.tgz", size: archive.length,
      digest: `sha256:${createHash("sha256").update(archive).digest("hex")}`, browser_download_url: archiveUrl }] };
    const updater = createUpdater({ root: join(temporary, "data"), env: { ...serviceEnv, npm_config_install_strategy: strategy }, fetcher: async (url) => {
      if (url === "https://api.github.com/repos/cosyeezz/axiom2/releases/latest") return new Response(JSON.stringify(release));
      assert.equal(url, archiveUrl);
      return new Response(archive);
    } });
    await updater.check();
    const updated = await updater.runJob("service", pkg.version);
    assert.equal(updated.job.phase, "complete", updated.job.message);
    assert.equal(execFileSync(process.execPath, [cli, "--version"], { encoding: "utf8" }).trim(), pkg.version);
    const afterUpdate = control("status");
    assert.equal(afterUpdate.version, pkg.version);
    assert.notEqual(afterUpdate.pid, beforeUpdate.pid);
    assert.equal((await request(afterUpdate.url)).status, 200);
    const dependencyRoot = await realpath(join(installed, "node_modules"));
    for (const dependency of Object.keys(pkg.dependencies)) {
      const location = relative(dependencyRoot, await realpath(join(dependencyRoot, dependency)));
      assert.ok(!location.startsWith("..") && !/^[A-Za-z]:/.test(location), `Dependency escaped the installed program: ${dependency}`);
    }
    for (const shim of ["axiom2", "axiom2.cmd", "axiom2.ps1"]) {
      await assert.rejects(access(join(installed, "node_modules/.bin", shim)), { code: "ENOENT" });
    }
    for (const worker of ["agent-worker.js", "compression-worker.js"]) {
      execFileSync(process.execPath, ["--input-type=module", "-e", "await import(process.argv[1]);", pathToFileURL(join(installed, "app/dist/server", worker)).href], {
        cwd: temporary, env: serviceEnv, encoding: "utf8", timeout: 30_000,
      });
    }
    assert.equal(control("stop").state, "stopped");
    console.log(`PASS: staged update with npm default strategy ${strategy}; dependency paths, worker imports and self-shim isolation`);
  }
  console.log(`PASS: ${packed.filename}; ${paths.length} files; isolated install, HTTP/assets/Origin, foreground/background lifecycle, duplicate start, authenticated stop, unrelated-process protection and staged in-app backend update`);
} finally {
  if (cli && serviceEnv) { try { control("stop"); } catch {} }
  if (child && child.exitCode === null) {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    await Promise.race([exited, delay(5000).then(() => { if (child.exitCode === null) child.kill("SIGKILL"); })]);
  }
  await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
