// Runs in its own clean-env process so ExecutionProfiles never inherits user auth.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const [root, variant] = process.argv.slice(2);
assert.ok(root); assert.ok(variant === "guard" || variant === "baseline");
assert.equal(process.env.HOME, join(root, "home"));
assert.equal(process.env.PI_CODING_AGENT_DIR, join(root, "sdk"));
const app = fileURLToPath(new URL("../../", import.meta.url)), source = join(app, "src/server/agent-worker.ts");
const text = readFileSync(source, "utf8"), call = "    disableKiroCacheWarming(settingsManager, () => session?.model ?? model);\n";
assert.equal(text.split(call).length, 2, "counterfactual removes exactly the one host installation, never a broader change");
let entry = source;
if (variant === "baseline") {
  const mirror = join(root, "baseline"), server = join(mirror, "src/server");
  mkdirSync(server, { recursive: true });
  for (const item of readdirSync(join(app, "src/server"))) if (item !== "agent-worker.ts") {
    const target = join(app, "src/server", item);
    symlinkSync(target, join(server, item), statSync(target).isDirectory() ? "junction" : "file");
  }
  symlinkSync(join(app, "src/shared"), join(mirror, "src/shared"), "junction");
  // CI installs at the repository root, not app/; the external mirror loses
  // normal parent-directory resolution, so link the actual installed modules.
  const modules = [join(app, "node_modules"), join(app, "../node_modules")]
    .find(path => existsSync(join(path, "@earendil-works/pi-coding-agent")));
  assert.ok(modules, "fixture requires installed SDK dependencies");
  symlinkSync(modules, join(mirror, "node_modules"), "junction");
  symlinkSync(join(app, "package.json"), join(mirror, "package.json"));
  entry = join(server, "agent-worker.ts");
  writeFileSync(entry, text.replace(call, ""));
}
process.env.AXIOM_FIXTURE_WORKER_ENTRY = entry;
const pi = join(root, "pi"), cwd = join(root, "project");
for (const dir of [pi, cwd]) mkdirSync(dir, { recursive: true });
writeFileSync(join(pi, "settings.json"), JSON.stringify({ packages: [], defaultTools: [], cacheWarming: "idle",
  retry: { enabled: false }, compaction: { enabled: false } }));
const selection = { provider: "kiro", id: "cache-worker-fixture", thinking: "off" as const };
const modelsRaw = JSON.stringify({ providers: { kiro: { api: "kiro-chat", models: [{
  id: selection.id, baseUrl: "https://q.us-east-1.amazonaws.com", contextWindow: 2_000_000, maxTokens: 1024,
  cost: { input: 10, output: 2, cacheRead: 0.1, cacheWrite: 10 }, promptCache: { short: 11, long: 11 },
}] } } });
writeFileSync(join(pi, "models.json"), modelsRaw);
const { SessionManager } = await import("@earendil-works/pi-coding-agent");
const { ExecutionProfiles, fileRevision } = await import("../../src/server/execution-profile.js");
const { ExecutionPool } = await import("../../src/server/execution-pool.js");
const manager = SessionManager.create(cwd, root);
manager.appendMessage({ role: "user", content: "OWNED_FIXTURE_HISTORY", timestamp: 1 });
manager.appendMessage({ role: "assistant", api: "kiro-chat", provider: "kiro", model: selection.id,
  content: [{ type: "text", text: "OWNED_PRIOR_REPLY" }], stopReason: "stop", timestamp: 1,
  usage: { input: 100_000, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 100_001,
    cost: { input: 1, output: .000002, cacheRead: 0, cacheWrite: 0, total: 1.000002 } } });
const file = manager.getSessionFile()!, sessionId = manager.getSessionId();
assert.ok(file);
const profiles = new ExecutionProfiles(root), pool = new ExecutionPool({ targetReadyTotal: 0, idleTtlMs: 10_000 }, "managed");
const prepared = profiles.prepare({ entry: "agent", cwd, modelDir: pi, modelsRaw, selection, mode: "managed" });
assert.equal(prepared.reuse, "same-session");
const environment = { ...prepared, workerPath: fileURLToPath(new URL("./kiro-worker-warming.ts", import.meta.url)),
  execArgv: ["--import", import.meta.resolve("tsx"), "--import", new URL("../vite-assets.mjs", import.meta.url).href] };
let requests = 0;
const children = new Set<import("node:child_process").ChildProcess>(), closed = new Set<import("node:child_process").ChildProcess>();
const warmCount = () => readFileSync(file, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line))
  .filter(entry => entry.type === "usage" && entry.kind === "cache_warm").length;
const wait = async (check: () => boolean, message: string) => {
  const until = Date.now() + 8_000;
  while (!check()) { assert.ok(Date.now() < until, message); await delay(10); }
};
const run = async () => {
  const lease = await pool.acquire({ environment, kind: "agent", signal: new AbortController().signal,
    affinity: { sessionId, fileRevision: fileRevision(file) }, requestStartedAtMonoMs: performance.now() });
  const child = await lease.ensureReady();
  if (!children.has(child)) {
    children.add(child); child.once("close", () => closed.add(child));
    child.on("message", (event: any) => { if (event.type === "fixture_request") requests = event.count; });
  }
  await new Promise<void>((resolve, reject) => {
    let done: any;
    const timer = setTimeout(() => { cleanup(); void pool.retire(lease.ref, "fixture_timeout", true); reject(Error("Real worker did not settle")); }, 15_000);
    const exit = () => { cleanup(); reject(Error("Real worker closed before retained idle")); };
    const cleanup = () => { clearTimeout(timer); child.off("message", receive); child.off("close", exit); };
    const receive = (event: any) => {
      if (event.lease?.leaseId !== lease.ref.leaseId) return;
      if (event.type === "done") {
        done = event;
        if (done.status !== "completed") { cleanup(); reject(Error("Real worker failed: " + String(done.error ?? done.reasonCode))); }
      }
      if (event.type === "idle") {
        if (done?.status !== "completed") { cleanup(); reject(Error("Idle must follow completed business outcome")); return; }
        void pool.release(lease.ref, { clean: true, keepSession: true, affinity: { sessionId, fileRevision: fileRevision(file) } })
          .then(() => { cleanup(); resolve(); }, error => { cleanup(); reject(error); });
      }
    };
    child.on("message", receive); child.once("close", exit);
    child.send({ type: "start", lease: lease.ref, input: { executionGate: true, root, cwd, file,
      modelsFile: environment.modelsFile, runId: randomUUID(), selection, prompt: "Reply with safe fixture text only; do not use tools." } },
      error => { if (error) { cleanup(); reject(error); } });
  });
  await lease.released;
  assert.equal(pool.stats().idle, 1); assert.equal(pool.hasAffinity(sessionId), true);
  return { instanceId: lease.ref.instanceId, source: lease.source };
};
try {
  const first = await run();
  assert.equal(requests, 1, "exactly one initial business HTTP");
  let reused = false;
  if (variant === "baseline") {
    await wait(() => requests >= 2 && warmCount() >= 1, "unguarded real worker must actually issue and record a warm request");
  } else {
    const quiet = Date.now(); await delay(1_450); assert.ok(Date.now() - quiet >= 1_300);
    assert.equal(requests, 1); assert.equal(warmCount(), 0);
    const second = await run();
    assert.equal(second.instanceId, first.instanceId); assert.equal(second.source, "affinity"); reused = true;
    await delay(1_450);
    assert.equal(requests, 2, "retained worker reuse still adds only its second business request");
    assert.equal(warmCount(), 0);
  }
  const result = { variant, requests, warms: warmCount(), reused,
    sourceSha: createHash("sha256").update(text).digest("hex"),
    entrySha: createHash("sha256").update(readFileSync(entry)).digest("hex") };
  await pool.close();
  assert.equal(pool.stats().total, 0); assert.equal(closed.size, children.size);
  console.log(JSON.stringify({ ...result, childrenClosed: true }));
} finally {
  await pool.close(); environment.release();
  assert.equal(profiles.size, 0);
}
