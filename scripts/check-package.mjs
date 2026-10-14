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
try {
  const [packed] = JSON.parse(npm(["pack", "--ignore-scripts", "--json", "--pack-destination", temporary]));
  const paths = packed.files.map((file) => file.path);
  for (const file of ["npm-shrinkwrap.json", "bin/axiom2.mjs", "app/dist/server/index.js", "app/dist/server/agent-worker.js", "app/dist/server/compression-worker.js", "app/dist/client/index.html"])
    assert.ok(paths.includes(file), `Missing runtime file: ${file}`);
  assert.ok(!paths.some((path) => /(?:^|\/)(?:auth\.json|models\.json|\.env|test-results|sessions|\.aoci)(?:\/|$)/.test(path)));
  const prefix = join(temporary, "prefix");
  npm(["install", "--global", "--prefix", prefix, "--no-audit", "--no-fund", join(temporary, packed.filename)]);
  const installed = join(prefix, ...(process.platform === "win32" ? [] : ["lib"]), "node_modules", "@cosyeezz", "axiom2");
  const cli = join(installed, "bin/axiom2.mjs");
  assert.equal(execFileSync(process.execPath, [cli, "--version"], { encoding: "utf8" }).trim(), pkg.version);
  assert.match(execFileSync(process.execPath, [cli, "--help"], { encoding: "utf8" }), /4317/);
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const pi = join(temporary, "pi");
  await mkdir(pi);
  let output = "";
  child = spawn(process.execPath, [cli], {
    cwd: temporary,
    env: { ...process.env, AXIOM_PORT: String(port), AXIOM_DATA_DIR: join(temporary, "data"), AXIOM_PI_DIR: pi, PI_CODING_AGENT_DIR: pi, NODE_PATH: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  let response;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null) throw Error(`Installed service exited: ${output}`);
    try { response = await fetch(`http://127.0.0.1:${port}/`); if (response.ok) break; } catch {}
    await delay(250);
  }
  assert.ok(response?.ok, `Installed service did not become ready: ${output}`);
  const html = await response.text();
  assert.match(html, /<div id="root"><\/div>/);
  const asset = html.match(/src="([^"]+\.js)"/)?.[1];
  assert.ok(asset, "Built page must reference a JS asset");
  assert.equal((await fetch(new URL(asset, `http://127.0.0.1:${port}`))).status, 200);
  assert.equal((await fetch(`http://127.0.0.1:${port}/`, { headers: { Origin: "https://example.com" } })).status, 403);
  console.log(`PASS: ${packed.filename}; ${paths.length} files; isolated global install, CLI, HTTP, JS assets and Origin protection`);
} finally {
  if (child && child.exitCode === null) {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    await exited;
  }
  await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
