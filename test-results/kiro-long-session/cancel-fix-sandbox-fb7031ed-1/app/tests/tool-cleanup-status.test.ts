import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, lstatSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const source = readFileSync(new URL("../desktop/tool-cleanup-status.mjs", import.meta.url), "utf8");
const execute = promisify(execFile);
const token = "a".repeat(64);
function tree(path: string): unknown {
  const s = lstatSync(path, { bigint: true });
  return [String(s.dev), String(s.ino), String(s.mode), String(s.mtimeNs), String(s.ctimeNs), s.isDirectory() ? readdirSync(path).sort().map(name => [name, tree(join(path, name))]) : s.isFile() ? readFileSync(path).toString("hex") : "special"];
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "axiom-cleanup-status-"));
  const db = new DatabaseSync(join(root, "service-startup.sqlite"));
  db.exec("CREATE TABLE startup(id INTEGER PRIMARY KEY, token TEXT, pid INTEGER)");
  db.prepare("INSERT INTO startup VALUES(1,?,2147483647)").run(token); db.close();
  chmodSync(join(root, "service-startup.sqlite"), 0o644);
  writeFileSync(join(root, `service-cancel-${token}`), "keep cancellation");
  mkdirSync(join(root, "updates"));
  writeFileSync(join(root, "updates/transaction.json"), "keep transaction");
  const inspect = async () => {
    const before = tree(root);
    const result = await execute(process.execPath, ["--input-type=module", "--eval", source], { env: { ...process.env, AXIOM_DATA_DIR: root, AXIOM_PORT: "0" }, timeout: 6000 });
    assert.deepEqual(tree(root), before, "read-only native status must not reclaim records or publish helpers");
    assert.equal(result.stderr, "");
    return JSON.parse(result.stdout);
  };
  return { root, inspect, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
for (const mode of ["missing", "malformed", "oversized", "dead"] as const) test(`native read-only status preserves stale startup/cancellation for ${mode} descriptor`, async () => {
  const f = fixture();
  try {
    if (mode !== "missing") writeFileSync(join(f.root, "service-control.json"), mode === "malformed" ? "{" : mode === "oversized" ? "x".repeat(16385) : JSON.stringify({ port: 1, token, pid: 2147483647 }));
    assert.equal((await f.inspect()).state, "unknown");
  } finally { f.cleanup(); }
});
test("native read-only status refuses a FIFO descriptor without waiting for a writer", { skip: process.platform === "win32" }, async () => {
  const f = fixture();
  try {
    const made = spawnSync("mkfifo", [join(f.root, "service-control.json")], { encoding: "utf8" });
    assert.equal(made.status, 0, made.stderr);
    // tree() only reads regular file contents; special files are metadata-only.
    assert.equal((await f.inspect()).state, "unknown");
  } finally { f.cleanup(); }
});
for (const mode of ["running", "starting", "stopping", "wrong token", "redirect", "oversized", "invalid JSON"] as const) test(`native read-only status authenticates ${mode} without local writes`, async () => {
  const f = fixture(); let requests = 0;
  const server = createServer((req, res) => {
    requests++;
    assert.equal(req.method, "GET"); assert.equal(req.url, "/status"); assert.equal(req.headers.authorization, `Bearer ${token}`);
    if (mode === "redirect") { res.writeHead(302, { Location: "/stop" }); res.end(); return; }
    res.end(mode === "oversized" ? "x".repeat(65537) : mode === "invalid JSON" ? "{" : JSON.stringify({ state: ["running", "starting", "stopping"].includes(mode) ? mode : "running", instance: mode === "wrong token" ? "b".repeat(64) : token, url: "http://127.0.0.1:4317/", active: [] }));
  });
  try {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); assert.ok(address && typeof address !== "string");
    writeFileSync(join(f.root, "service-control.json"), JSON.stringify({ port: address.port, token, pid: process.pid }));
    const result = await f.inspect();
    assert.equal(result.state, ["running", "starting", "stopping"].includes(mode) ? mode : "unknown");
    if (mode === "running") assert.equal(result.url, "http://127.0.0.1:4317/");
    assert.equal(requests, 1, "redirects must not trigger any follow-up request");
    assert.equal(JSON.stringify(result).includes(token), false);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); f.cleanup(); }
});
test("native cleanup routes with embedded read-only status before any helper publication", () => {
  const native = readFileSync(new URL("../desktop/axiom_service.rs", import.meta.url), "utf8");
  const cleanup = native.slice(native.indexOf("pub async fn axiom_cleanup("), native.indexOf("pub async fn axiom_environment("));
  assert.ok(cleanup.includes('run("cleanup-status")'));
  assert.ok(!cleanup.includes('run("status")'));
  const rejection = cleanup.indexOf('if offline && request["op"]');
  assert.ok(rejection > 0);
  assert.ok(rejection < cleanup.indexOf('axiom_bundled::publish'));
  assert.ok(rejection < cleanup.indexOf('crate::axiom_setup::ensure_idle()?'));
  assert.equal(cleanup.split('crate::axiom_setup::ensure_idle()?').length, 2);
  assert.ok(!cleanup.slice(0, rejection).includes('axiom_setup::'));
  assert.ok(native.includes('include_str!("tool-cleanup-status.mjs")'));
  const build = readFileSync(new URL("../../scripts/build-desktop.mjs", import.meta.url), "utf8");
  assert.ok(build.includes('"tool-cleanup-status.mjs"'));
});
