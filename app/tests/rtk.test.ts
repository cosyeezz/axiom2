import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { randomUUID, createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { RtkService } from "../src/server/integrations/rtk.js";
import { atomicRtkJson, readRtkConfig, rtkConfigPath, rtkDirectory, rtkExecutable } from "../src/server/integrations/rtk-config.js";
import { downloadRtk, latestRtk, verifyRtkArchive } from "../src/server/integrations/rtk-install.js";
import { filterRtkResult, rtkFilter } from "../src/server/integrations/rtk-runtime.js";
import { cleanRtkOriginals, recordRtkEvent, rtkStats, saveRtkOriginal } from "../src/server/integrations/rtk-stats.js";
import { runRtk } from "../src/server/integrations/rtk-process.js";
import { Store } from "../src/server/storage.js";
import { rtkFixture } from "./rtk-fixture.js";
import type { RtkState } from "../src/shared/rtk.js";
const call = (s: RtkService, op: string, params = {}) => s.command({ requestId: randomUUID(), op, params });
async function settle(s: RtkService) {
  const end = Date.now() + 5000;
  while (s.snapshot().job?.running) { assert.ok(Date.now() < end, "RTK job timeout"); await new Promise<void>(r => setImmediate(r)); }
  return s.snapshot();
}
async function installed(f: ReturnType<typeof rtkFixture>) {
  const service = new RtkService(f.root, () => {}, f);
  await call(service, "rtk.check"); await settle(service);
  await call(service, "rtk.install", { version: "1.0.1" }); assert.equal((await settle(service)).job?.error, undefined);
  return service;
}
const paths = Array.from({ length: 100 }, (_, i) => `src/components/很长的目录名/example-long-file-${i}.ts`).join("\n");
function event(command = "rg --files", text = paths): ToolResultEvent {
  return { type: "tool_result", toolName: "bash", toolCallId: "call-fixture", input: { command }, content: [{ type: "text", text }], isError: false, details: undefined, structuredContent: { output: text, exit_code: 0, truncated: false, wall_time_seconds: 0.1 } };
}

test("RTK install: latest without check, idempotent receipt, CAS, forced-clean retry and cancellation", async () => {
  const f = rtkFixture(), store = new Store(join(f.root, "store")); const s = new RtkService(f.root, () => {}, f);
  try {
    await assert.rejects(call(s, "rtk.save", { enabled: true, level: "balanced", subagents: true, revision: "" }), { code: "NOT_INSTALLED" });
    f.hold();
    const c = { requestId: "once", op: "rtk.install", params: { version: "1.0.1" } };
    const first = await store.external(c, () => s.command(c)) as RtkState;
    assert.ok(first.job?.running); assert.deepEqual(await store.external(c, () => s.command(c)), JSON.parse(JSON.stringify(first)));
    await assert.rejects(call(s, "rtk.check"), { code: "BUSY" });
    await assert.rejects(call(s, "rtk.save", { enabled: false, level: "balanced", subagents: true, revision: "" }), { code: "BUSY" });
    await assert.rejects(call(s, "rtk.cancel", { jobId: "stale" }), { code: "NOT_RUNNING" });
    f.release(); const state = await settle(s); assert.equal(state.version, "1.0.1"); assert.equal(state.settings.enabled, false);
    assert.ok(existsSync(state.executable!));
    await call(s, "rtk.save", { enabled: true, level: "aggressive", subagents: false, revision: state.revision });
    await assert.rejects(call(s, "rtk.save", { enabled: false, level: "balanced", subagents: true, revision: state.revision }), { code: "CONFIGURATION_CONFLICT" });
    const config = readFileSync(rtkConfigPath(f.root), "utf8");
    f.setVersion("1.0.2"); await call(s, "rtk.check"); await settle(s); f.corrupt();
    await call(s, "rtk.install"); const failed = await settle(s);
    assert.match(failed.job!.error!, /SHA-256/); assert.equal(failed.version, undefined, "component standard: a failed retry leaves a clean slate");
    assert.equal(existsSync(state.executable!), false); assert.notEqual(readFileSync(rtkConfigPath(f.root), "utf8"), config);
    f.hold(); const running = await call(s, "rtk.install") as RtkState;
    await call(s, "rtk.cancel", { jobId: running.job!.id }); await settle(s);
    assert.match(s.snapshot().job!.message, /取消/);
    assert.equal(readdirSync(join(rtkDirectory(f.root), "versions")).length, 0);
  } finally { await s.close(); store.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test("RTK restart, malformed config, scope and clear validation", async () => {
  const f = rtkFixture(); let s = new RtkService(f.root, () => {}, f);
  try {
    await s.close(); atomicRtkJson(join(rtkDirectory(f.root), "job.json"), { id: "old", kind: "install", running: true, message: "working" });
    s = new RtkService(f.root, () => {}, f); assert.equal(s.snapshot().job, undefined, "component standard: no restored history");
    await assert.rejects(s.command({ requestId: "scope", op: "rtk.stats", sessionId: "bad" }), { code: "INVALID_SCOPE" });
    await assert.rejects(call(s, "rtk.clearStats"), { code: "CONFIRM_REQUIRED" });
    await assert.rejects(call(s, "rtk.stats", { days: 100 }), { code: "INVALID_PARAMS" });
    writeFileSync(rtkConfigPath(f.root), "broken"); await call(s, "rtk.refresh"); assert.match(s.snapshot().error!, /配置/);
    await assert.rejects(call(s, "rtk.save", { enabled: false, subagents: true, level: "balanced", revision: "" }));
    assert.equal(readFileSync(rtkConfigPath(f.root), "utf8"), "broken");
  } finally { await s.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test("RTK archive checksum and metadata reject wrong, duplicate, missing and external assets", async () => {
  const data = Buffer.from("archive"), hash = createHash("sha256").update(data).digest("hex");
  verifyRtkArchive(data, `${hash}  rtk.tar.gz\n`, "rtk.tar.gz");
  for (const sums of ["", `${hash}  other\n`, `${hash}  rtk.tar.gz\n${hash}  rtk.tar.gz\n`, `${"0".repeat(64)}  rtk.tar.gz`]) assert.throws(() => verifyRtkArchive(data, sums, "rtk.tar.gz"));
  await assert.rejects(latestRtk(new AbortController().signal, async () => Buffer.from('{"tag_name":"v1.0.1","assets":[]}')));
  await assert.rejects(downloadRtk("https://evil.example/x", new AbortController().signal, 1024), /官方/);
});

test("RTK downloads negotiate JSON metadata and binary assets, including redirects", async t => {
  const requests: { url: string; accept: string | undefined }[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    requests.push({ url, accept: (init.headers as Record<string, string>).Accept });
    return url.includes("github.com/rtk-ai") ? new Response(null, { status: 302, headers: { location: "https://release-assets.githubusercontent.com/fixture" } }) : new Response("ok");
  });
  const signal = new AbortController().signal;
  await downloadRtk("https://api.github.com/repos/rtk-ai/rtk/releases/latest", signal, 1024);
  await downloadRtk("https://github.com/rtk-ai/rtk/releases/download/v1.0.1/fixture", signal, 1024);
  assert.deepEqual(requests.map(r => r.accept), ["application/vnd.github+json", "application/octet-stream", "application/octet-stream"]);
});

test("RTK filtering measures Unicode and recall overhead, preserves structured exit data, supports hot settings and both roles", async () => {
  const f = rtkFixture(), s = await installed(f);
  try {
    await call(s, "rtk.save", { enabled: true, subagents: true, level: "balanced", revision: s.snapshot().revision });
    const original = event(), before = structuredClone(original);
    for (const role of ["main", "subagent"] as const) {
      const result = await filterRtkResult(f.root, role, original, undefined, f.run); assert.ok(result);
      assert.deepEqual(original, before); assert.deepEqual(result.structuredContent, original.structuredContent);
      const returned = result.content![0]; assert.equal(returned.type, "text"); if (returned.type !== "text") throw Error();
      const path = /：([^\n]+\.txt)\]/.exec(returned.text)![1]; assert.equal(readFileSync(path, "utf8"), paths);
      if (process.platform !== "win32") assert.equal(statSync(path).mode & 0o777, 0o600);
      const recent = rtkStats(f.root).recent[0]; assert.equal(recent.inputBytes, Buffer.byteLength(paths)); assert.equal(recent.outputBytes, Buffer.byteLength(returned.text));
    }
    const stats = rtkStats(f.root); assert.equal(stats.filtered, 2); assert.ok(stats.outputBytes < stats.inputBytes);
    assert.ok(!JSON.stringify(stats).includes("很长的目录名")); assert.ok(!JSON.stringify(stats).includes("rg --files"));
    await call(s, "rtk.save", { enabled: true, subagents: false, level: "conservative", revision: s.snapshot().revision });
    assert.equal(await filterRtkResult(f.root, "subagent", original, undefined, f.run), undefined);
    assert.equal(await filterRtkResult(f.root, "main", original, undefined, f.run), undefined);
    assert.equal(rtkStats(f.root).count, 3); assert.equal(rtkStats(f.root).recent[0].reason, "unsupported");
    await call(s, "rtk.save", { enabled: false, subagents: true, level: "balanced", revision: s.snapshot().revision });
    assert.equal(await filterRtkResult(f.root, "main", original, undefined, f.run), undefined); assert.equal(rtkStats(f.root).count, 3);
  } finally { await s.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test("RTK bypasses errors, truncation, images, nested and unsupported output; failure never reruns command", async () => {
  const f = rtkFixture(), s = await installed(f);
  try {
    await call(s, "rtk.save", { enabled: true, subagents: true, level: "balanced", revision: s.snapshot().revision });
    let executions = 0;
    const fail = async () => { executions++; throw Error("PRIVATE stderr"); };
    const cases: [ToolResultEvent, string][] = [
      [{ ...event(), isError: true }, "error"], [{ ...event(), parentToolCallId: "parent" }, "nested"],
      [{ ...event(), details: { truncation: {} } } as ToolResultEvent, "truncated"],
      [{ ...event(), structuredContent: undefined }, "contract"], [event("cat private.txt"), "unsupported"], [event("rg --files", "short"), "small"],
      [{ ...event(), content: [{ type: "image", data: "", mimeType: "image/png" }] }, "contract"],
    ];
    for (const [value, reason] of cases) { assert.equal(await filterRtkResult(f.root, "main", value, undefined, fail), undefined); assert.equal(rtkStats(f.root).recent[0].reason, reason); }
    assert.equal(executions, 0);
    assert.equal(await filterRtkResult(f.root, "main", event(), undefined, fail), undefined); assert.equal(executions, 1); assert.equal(rtkStats(f.root).recent[0].reason, "failed");
    assert.equal(await filterRtkResult(f.root, "main", event(), undefined, async () => Buffer.from(paths)), undefined); assert.equal(rtkStats(f.root).recent[0].reason, "unchanged");
    const abort = new AbortController(); abort.abort(); assert.equal(await filterRtkResult(f.root, "main", event(), abort.signal, fail), undefined); assert.equal(executions, 1);
    assert.ok(!JSON.stringify(rtkStats(f.root)).includes("PRIVATE"));
    rmSync(rtkExecutable(f.root, readRtkConfig(f.root))!); assert.equal(await filterRtkResult(f.root, "main", event(), undefined, fail), undefined); assert.equal(rtkStats(f.root).recent[0].reason, "missing");
  } finally { await s.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test("RTK policies reject compound, JSON mismatches, search context and unsupported TAP output", () => {
  for (const cmd of ["cat x | rg --files", "echo x; rg --files", "rtk find .", "rg --files > out", "find . -exec echo secret {} +"]) assert.equal(rtkFilter(cmd, paths, "aggressive"), undefined);
  for (const cmd of ["fd -x cat", "fd -X cat", "fd --exec=cat", "fd -xcat", "fd --format={}", "find . -execdir cat {} +", "find . -ok cat {} +", "find . -okdir cat {} +", "find . -fprintf out format", "rg --files --null", "fd --unknown"]) assert.equal(rtkFilter(cmd, paths, "balanced"), undefined, cmd);
  for (const cmd of ["find . -type f", "fd --type f --extension ts", "rg --files -g '*.ts'", "fd --extension=ts"]) assert.equal(rtkFilter(cmd, paths, "balanced", "linux"), "find", cmd);
  const diff = "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n+new\n";
  for (const option of ["--word-diff", "--word-diff=plain", "--word-diff-regex=.", "--color-words", "--binary", "--output-indicator-new=X", "--stat", "--raw"]) assert.equal(rtkFilter(`git diff ${option}`, diff, "aggressive"), undefined, option);
  assert.equal(rtkFilter("git diff --cached -U3 -- src", diff, "aggressive"), "git-diff");
  assert.equal(rtkFilter("git diff", "diff --git a/a b/a\nGIT binary patch\nliteral 1", "aggressive"), undefined);
  assert.equal(rtkFilter("cd app && rg --files", paths, "balanced"), "find");
  assert.equal(rtkFilter('find "secret" log.txt', paths, "balanced", "win32"), undefined);
  assert.equal(rtkFilter("find . -type f", paths, "balanced", "linux"), "find");
  assert.equal(rtkFilter("rg --files", paths, "balanced", "win32"), "find");
  assert.equal(rtkFilter("rg --files", paths, "conservative"), undefined);
  assert.equal(rtkFilter("go test -json", "plain go output", "balanced"), undefined);
  assert.equal(rtkFilter("git status", "On branch main", "aggressive"), undefined);
  assert.equal(rtkFilter("rg -n foo", "a.ts:1:foo\ncontext", "aggressive"), undefined);
  assert.equal(rtkFilter("rg -n foo", "a.ts:1:foo\na.ts:2:foo", "aggressive"), "grep");
  assert.equal(rtkFilter("npx tsx --test", "TAP version 13\n# pass 10\n# fail 0", "aggressive"), undefined);
  assert.equal(rtkFilter("pytest -v", "===== 10 passed in 0.1s =====", "conservative"), "pytest");
});

test("RTK literal quoted regexes are eligible without accepting shell operators or expansions", () => {
  const matches = "a.ts:1:foo\na.ts:2:bar";
  for (const command of [String.raw`rg -n 'foo|bar' src`, String.raw`rg -n 'foo$' src`, String.raw`rg -n '\bfoo\s+bar' src`, 'rg -n "foo|bar" src', "rg -n '$(foo);`bar`' src", "cd 'my app' && rg -n 'foo|bar' src"]) {
    assert.equal(rtkFilter(command, matches, "aggressive"), "grep", command);
  }
  assert.equal(rtkFilter("rg --files --glob='*.ts'", paths, "balanced"), "find");
  assert.equal(rtkFilter('rg --files "my directory"', paths, "balanced"), "find");
  for (const command of ['rg -n foo | cat', 'rg -n foo; echo x', 'rg -n foo > out', 'rg -n foo &', 'rg -n foo && cat x', 'rg -n "$(echo foo)"', 'rg -n "$PATTERN"', 'rg -n `echo foo`', "rg -n 'foo", 'rg -n foo\nbar', 'rg -n "foo\u0000bar"', 'rg -n foo # comment', String.raw`rg -n "\bfoo"`, "rg -n 'foo|bar'; cat x", 'cd app && rg -n foo && cat x']) {
    assert.equal(rtkFilter(command, matches, "aggressive"), undefined, command);
  }
});

test("RTK command modes distinguish options from operands and do not unwrap arbitrary scripts", async () => {
  const f = rtkFixture(), s = await installed(f);
  try {
    await call(s, "rtk.save", { enabled: true, subagents: true, level: "aggressive", revision: s.snapshot().revision });
    let runs = 0;
    for (const command of ["rg -- --files sample.txt", "rg -g --files pattern sample.txt", "rg --glob=--files pattern sample.txt", "python3 -m fd", "python -m find", "pnpm run fd", "pnpm exec fd", "npx fd", "yarn fd", "bun run fd", "uv run fd"]) {
      assert.equal(rtkFilter(command, paths, "aggressive"), undefined, command);
      assert.equal(await filterRtkResult(f.root, "main", event(command), undefined, async () => { runs++; return Buffer.from("120 files"); }), undefined, command);
    }
    assert.equal(runs, 0);
    assert.equal(rtkStats(f.root).filtered, 0);
    assert.equal(existsSync(join(rtkDirectory(f.root), "originals")), false);
    assert.equal(rtkFilter("rg --files -- --files", paths, "balanced"), "find");
    for (const command of ["python -m pytest", "python3 -m pytest -v", "uv run pytest", "uv run python -m pytest"]) assert.equal(rtkFilter(command, "===== 10 passed in 0.1s =====", "conservative"), "pytest", command);
    for (const command of ["npx vitest run", "npx --no-install vitest run", "pnpm exec vitest run", "yarn exec vitest run", "bun x vitest run"]) assert.equal(rtkFilter(command, "Test Files  3 passed (3)", "conservative"), "vitest", command);
    assert.equal(rtkFilter("pnpm run vitest", "Test Files 3 passed", "conservative"), undefined);
  } finally { await s.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test("RTK original retention, deduplication, expiry and independent clearing", async () => {
  const f = rtkFixture(), s = new RtkService(f.root, () => {}, f);
  try {
    const id = randomUUID(), path = saveRtkOriginal(f.root, id, "private source");
    const e = { id, at: Date.now(), role: "main" as const, level: "balanced" as const, filter: "find", reason: "filtered" as const, inputBytes: 2000, outputBytes: 100, durationMs: 1, version: "1.0.1" };
    recordRtkEvent(f.root, e); recordRtkEvent(f.root, e); assert.equal(rtkStats(f.root).count, 1);
    await call(s, "rtk.clearStats", { confirm: true }); assert.equal(rtkStats(f.root).count, 0); assert.ok(existsSync(path));
    utimesSync(path, 0, 0); cleanRtkOriginals(f.root); assert.equal(existsSync(path), false);
    const fresh = saveRtkOriginal(f.root, randomUUID(), "private source"); recordRtkEvent(f.root, e);
    await call(s, "rtk.clearOriginals", { confirm: true }); assert.equal(existsSync(fresh), false); assert.equal(rtkStats(f.root).count, 1);
  } finally { await s.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test("RTK in-flight setting changes discard results without originals or records, including runner failure", async () => {
  const f = rtkFixture(), s = await installed(f);
  try {
    for (const change of [{ enabled: false }, { subagents: false }, { level: "conservative" }, { enabled: false, fail: true }]) {
      await call(s, "rtk.save", { enabled: true, subagents: true, level: "balanced", revision: s.snapshot().revision });
      let release!: () => void;
      const waiting = new Promise<void>(resolve => { release = resolve; });
      const task = filterRtkResult(f.root, "subagent", event(), undefined, async () => { await waiting; if (change.fail) throw Error("failed"); return Buffer.from("100 files\n"); });
      const { fail, ...settings } = change;
      await call(s, "rtk.save", { ...s.snapshot().settings, ...settings, revision: s.snapshot().revision });
      release(); assert.equal(await task, undefined);
      assert.equal(rtkStats(f.root).count, 0);
      assert.equal(existsSync(join(rtkDirectory(f.root), "originals")), false);
    }
  } finally { await s.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test("RTK disabled service physically expires stats on startup and reads without new events", async () => {
  const f = rtkFixture(); let s = new RtkService(f.root, () => {}, f);
  const e = { id: randomUUID(), at: Date.now(), role: "main" as const, level: "balanced" as const, filter: "find", reason: "filtered" as const, inputBytes: 2000, outputBytes: 100, durationMs: 1, version: "1.0.1" };
  const db = new DatabaseSync(join(rtkDirectory(f.root), "effects.sqlite"));
  try {
    recordRtkEvent(f.root, e);
    db.prepare("UPDATE effects SET at=?").run(Date.now() - 31 * 86_400_000);
    await s.close(); s = new RtkService(f.root, () => {}, f);
    assert.equal(db.prepare("SELECT count(*) AS n FROM effects").get()!.n, 0);
    recordRtkEvent(f.root, { ...e, id: randomUUID() });
    db.prepare("UPDATE effects SET at=?").run(Date.now() - 31 * 86_400_000);
    assert.equal(rtkStats(f.root, 30).count, 0);
    assert.equal(db.prepare("SELECT count(*) AS n FROM effects").get()!.n, 0);
  } finally { db.close(); await s.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test("RTK maintenance keeps active, previous and recent installs while pruning old managed versions", async () => {
  const f = rtkFixture(), s = await installed(f);
  let restarted: RtkService | undefined;
  try {
    const versions = join(rtkDirectory(f.root), "versions"), active = readRtkConfig(f.root).installation!.directory;
    const make = (age: number) => { const path = join(versions, `v1.0.0-${randomUUID()}`); mkdirSync(path); writeFileSync(join(path, "rtk"), "old"); const at = new Date(Date.now() - age * 86_400_000); utimesSync(path, at, at); return path; };
    const old = make(4), previous = make(2);
    utimesSync(join(versions, active), 0, 0);
    mkdirSync(join(versions, "user-data"));
    await s.close(); restarted = new RtkService(f.root, () => {}, f);
    assert.ok(existsSync(join(versions, active))); assert.ok(existsSync(previous)); assert.ok(!existsSync(old)); assert.ok(existsSync(join(versions, "user-data")));
    const recent1 = make(0), recent2 = make(0);
    await restarted.close(); restarted = new RtkService(f.root, () => {}, f);
    assert.ok(existsSync(recent1)); assert.ok(existsSync(recent2)); assert.ok(!existsSync(previous));
    assert.ok(existsSync(join(versions, active)));
  } finally { await s.close(); await restarted?.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test("RTK subprocess bounds output, timeout, cancellation, UTF-8 chunks and hides stderr", async () => {
  const f = rtkFixture();
  try {
    const result = await runRtk(process.execPath, ["-e", "process.stdin.pipe(process.stdout)"], { root: f.root, input: "中文🙂\n" }); assert.equal(result.toString(), "中文🙂\n");
    await assert.rejects(runRtk(process.execPath, ["-e", "setInterval(()=>{},1000)"], { root: f.root, timeout: 30 }), /超时/);
    await assert.rejects(runRtk(process.execPath, ["-e", "process.stdout.write('x'.repeat(100000))"], { root: f.root, limit: 100 }), /超限/);
    await assert.rejects(runRtk(process.execPath, ["-e", "console.error('PRIVATE');process.exit(7)"], { root: f.root }), error => !String(error).includes("PRIVATE"));
    const abort = new AbortController(); const task = runRtk(process.execPath, ["-e", "setInterval(()=>{},1000)"], { root: f.root, signal: abort.signal }); abort.abort(); await assert.rejects(task);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
