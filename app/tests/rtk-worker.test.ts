// Exercises the production worker, SDK shell and host extension without contacting a model service.
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { ExecutionPool } from "../src/server/execution-pool.js";
import { ExecutionProfiles } from "../src/server/execution-profile.js";
import { atomicRtkJson, rtkConfigPath, rtkDirectory } from "../src/server/integrations/rtk-config.js";
import { rtkStats } from "../src/server/integrations/rtk-stats.js";

test("RTK production worker preserves original permissions, reauthorizes managed rewrites and sends one result to provider", { timeout: 180000, skip: process.platform === "win32" ? "POSIX fixture executable; platform-independent runtime separately tested" : false }, async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-rtk-worker-")), cwd = join(root, "project"), pi = join(root, "pi");
  const requests: any[] = []; let step = 0, blocked = false;
  const originalCommand = "find . -type f", frontCommand = "ls .";
  let selectedCommand = originalCommand;
  const server = createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk; requests.push(JSON.parse(raw));
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const delta = step++ === 0 ? { role: "assistant", tool_calls: [{ index: 0, id: randomUUID(), type: "function", function: { name: "bash", arguments: JSON.stringify({ command: blocked ? "find . -name blocked" : selectedCommand }) } }] } : { role: "assistant", content: "Done." };
    for (const choice of [{ delta, finish_reason: null }, { delta: {}, finish_reason: step === 1 ? "tool_calls" : "stop" }]) res.write(`data: ${JSON.stringify({ id: randomUUID(), object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, ...choice }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
  mkdirSync(join(pi, "extensions"), { recursive: true }); mkdirSync(cwd);
  for (let i = 0; i < 120; i++) writeFileSync(join(cwd, `a-very-long-测试-file-name-number-${i}.txt`), "test");
  const directory = `v1.0.1-${randomUUID()}`, binDir = join(rtkDirectory(root), "versions", directory); mkdirSync(binDir, { recursive: true });
  const executions = join(root, "filter-count.txt"), permissionInputs = join(root, "permission-inputs.txt"), modeFile = join(root, "rewrite-mode"), probes = join(root, "rewrite-probes");
  writeFileSync(modeFile, "off");
  writeFileSync(join(binDir, "rtk"), `#!${process.execPath}
const fs = require('node:fs'); const mode=fs.readFileSync(${JSON.stringify(modeFile)},'utf8');
if(process.argv[2]==='rewrite') { fs.appendFileSync(${JSON.stringify(probes)},'probe\\n'); if(mode==='off')process.exit(1); process.stdout.write(mode==='reject'?'rtk ls blocked':'rtk '+process.argv[3]); process.exit(3); }
if(process.argv[2]==='ls') { fs.appendFileSync(${JSON.stringify(executions)},'ls\\n'); if(mode==='failure'){process.stderr.write('diagnostic-7\\n');process.exit(7);} process.stdout.write('120 files in project\\n');process.exit(0); }
let input='';process.stdin.on('data',x=>input+=x);process.stdin.on('end',()=>{fs.appendFileSync(${JSON.stringify(executions)},'pipe\\n');process.stdout.write('120 files in project\\n');});`, { mode: 0o700 });
  atomicRtkJson(rtkConfigPath(root), { format: 1, revision: randomUUID(), enabled: true, subagents: true, level: "balanced", installation: { directory, version: "1.0.1" } });
  writeFileSync(join(pi, "extensions", "permissions.ts"), `import {appendFileSync} from 'node:fs'; export default pi => { pi.on('tool_call', e => { if(e.toolName==='bash'){appendFileSync(${JSON.stringify(permissionInputs)}, e.input.command+'\\n');if(e.input.command.includes('blocked')) return {block:true,reason:'permission-fixture'}; }}); };`);
  writeFileSync(join(pi, "settings.json"), JSON.stringify({ retry: { enabled: false }, compaction: { enabled: false } }));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const modelsFile = join(pi, "models.json");
  writeFileSync(modelsFile, JSON.stringify({ providers: { fixture: { api: "openai-completions", baseUrl: `http://127.0.0.1:${(server.address() as any).port}/v1`, models: [{ id: "fixture", contextWindow: 32000, maxTokens: 1000 }] } } }));
  writeFileSync(join(pi, "auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "loopback" } }));
  async function run(child: boolean) {
    step = 0; const first = requests.length;
    const manager = SessionManager.create(cwd, root); manager.appendMessage({ role: "user", content: "Bound session", timestamp: Date.now() });
    const selection = { provider: "fixture", id: "fixture", thinking: "off" as const };
    const profiles = new ExecutionProfiles(root), prepared = profiles.prepare({ entry: "agent", cwd, modelDir: pi, modelsRaw: readFileSync(modelsFile, "utf8"), selection, mode: "managed" });
    const worker = new URL("../src/server/agent-worker.ts", import.meta.url);
    const environment = { ...prepared, workerPath: fileURLToPath(worker), execArgv: ["--import", import.meta.resolve("tsx")] };
    const pool = new ExecutionPool({ targetReadyTotal: 0 }, "managed"); let timer: NodeJS.Timeout | undefined;
    const events: any[] = []; let stderr = "";
    try {
      const lease = await pool.acquire({ environment, kind: "agent", signal: new AbortController().signal, requestStartedAtMonoMs: performance.now() });
      const process = await lease.ensureReady(); process.stderr?.on("data", chunk => { stderr += chunk; });
      process.on("message", (event: any) => { events.push(event); if (event.type === "done") void pool.retire(lease.ref, "test_finished"); });
      timer = setTimeout(() => { void pool.retire(lease.ref, "timeout", true); }, 25000);
      process.send({ type: "start", lease: lease.ref, input: { executionGate: true, root, cwd, modelsFile: environment.modelsFile, file: manager.getSessionFile(), runId: randomUUID(), selection, prompt: "List files.", ...(child ? { task: { id: "rtk-child", inputIds: [] } } : {}) } });
      await lease.released;
      assert.equal(events.find(event => event.type === "done")?.status, "completed", stderr + JSON.stringify(events));
      return requests.slice(first);
    } finally { clearTimeout(timer); await pool.close(); environment.release(); }
  }
  try {
    let baseline: any;
    for (const child of [false, true]) {
      const bodies = await run(child); if (!child) baseline = bodies[0];
      const result = bodies.flatMap(body => body.messages).find(message => message.role === "tool");
      assert.ok(result && JSON.stringify(result.content).includes("RTK 已过滤工具文本"), JSON.stringify(result));
      assert.ok(JSON.stringify(result.content).includes("120 files in project"));
    }
    assert.equal(readFileSync(permissionInputs, "utf8"), originalCommand + "\n", "main permission extension sees original command; child does not load disk extensions");
    assert.equal(readFileSync(executions, "utf8").trim().split("\n").length, 2);
    const stats = rtkStats(root); assert.equal(stats.filtered, 2); assert.deepEqual(new Set(stats.recent.map(e => e.role)), new Set(["main", "subagent"]));
    selectedCommand = frontCommand;
    writeFileSync(modeFile, "on");
    for (const child of [false, true]) {
      const bodies = await run(child), result = bodies.flatMap(body => body.messages).find(message => message.role === "tool");
      assert.ok(JSON.stringify(result.content).includes("120 files in project"));
      assert.ok(!JSON.stringify(result.content).includes("RTK 已过滤工具文本"), "front path must not pipe or claim raw recovery");
      assert.equal(bodies.length, 2, "no extra provider request for rewrite");
      const calls = bodies[1].messages.flatMap((message: any) => message.tool_calls ?? []);
      assert.equal(JSON.parse(calls[0].function.arguments).command, frontCommand, "assistant history retains original command");
      if (!child) {
        assert.deepEqual(bodies[0].tools, baseline.tools, "tool schemas and prompt snippets do not change");
        assert.deepEqual(bodies[0].messages.filter((message: any) => message.role === "system"), baseline.messages.filter((message: any) => message.role === "system"), "no RTK prompt injection");
      }
    }
    const permissionLines = readFileSync(permissionInputs, "utf8").trim().split("\n");
    assert.equal(permissionLines[1], frontCommand); assert.ok(permissionLines[2].includes(join(binDir, "rtk")), "main permissions also see managed candidate");
    assert.equal(readFileSync(executions, "utf8").trim().split("\n").length, 4, "two postprocessors then two single front executions");
    assert.equal(rtkStats(root).rewritten, 2); assert.equal(rtkStats(root).filtered, 2);
    writeFileSync(modeFile, "failure");
    const failed = await run(false); assert.ok(JSON.stringify(failed).includes("diagnostic-7"));
    assert.ok(JSON.stringify(failed).includes("code 7"), "exit status remains a failure");
    assert.equal(readFileSync(executions, "utf8").trim().split("\n").length, 5, "failed business command is never rerun or piped");
    writeFileSync(modeFile, "reject");
    const rejected = await run(false); assert.ok(JSON.stringify(rejected).includes("permission-fixture"));
    assert.equal(readFileSync(executions, "utf8").trim().split("\n").length, 5, "rewritten permission rejection never executes original as fallback");
    const beforeProbes = readFileSync(probes, "utf8");
    blocked = true; const bodies = await run(false); assert.ok(JSON.stringify(bodies).includes("permission-fixture"));
    assert.equal(readFileSync(probes, "utf8"), beforeProbes, "original permission rejection must never invoke RTK rewrite");
    assert.equal(readFileSync(executions, "utf8").trim().split("\n").length, 5);
    blocked = false; writeFileSync(modeFile, "on");
    for (const [patch, expected] of [
      [{ shellCommandPrefix: "ls() { printf 'prefix-preserved\\n'; }" }, "prefix-preserved"],
      [{ shellPath: "/bin/sh" }, "a-very-long-测试-file-name-number-0.txt"],
    ] as const) {
      writeFileSync(join(pi, "settings.json"), JSON.stringify({ retry: { enabled: false }, compaction: { enabled: false }, ...patch }));
      const probesBefore = readFileSync(probes, "utf8"), bodies = await run(false);
      assert.ok(JSON.stringify(bodies).includes(expected), "custom shell/prefix retains original execution semantics");
      assert.equal(readFileSync(probes, "utf8"), probesBefore, "unverified shell/prefix must not even probe rewrite");
      assert.equal(readFileSync(executions, "utf8").trim().split("\n").length, 5);
    }
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(root, { recursive: true, force: true }); }
});
