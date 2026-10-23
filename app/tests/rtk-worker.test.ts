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

test("RTK production worker covers main and noExtensions children while permission hooks see the original command", { timeout: 90000, skip: process.platform === "win32" ? "POSIX fixture executable; platform-independent runtime separately tested" : false }, async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-rtk-worker-")), cwd = join(root, "project"), pi = join(root, "pi");
  const requests: any[] = []; let step = 0, blocked = false;
  const originalCommand = "find . -type f";
  const server = createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk; requests.push(JSON.parse(raw));
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const delta = step++ === 0 ? { role: "assistant", tool_calls: [{ index: 0, id: randomUUID(), type: "function", function: { name: "bash", arguments: JSON.stringify({ command: blocked ? "find . -name blocked" : originalCommand }) } }] } : { role: "assistant", content: "Done." };
    for (const choice of [{ delta, finish_reason: null }, { delta: {}, finish_reason: step === 1 ? "tool_calls" : "stop" }]) res.write(`data: ${JSON.stringify({ id: randomUUID(), object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, ...choice }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
  mkdirSync(join(pi, "extensions"), { recursive: true }); mkdirSync(cwd);
  for (let i = 0; i < 120; i++) writeFileSync(join(cwd, `a-very-long-测试-file-name-number-${i}.txt`), "test");
  const directory = `v1.0.1-${randomUUID()}`, binDir = join(rtkDirectory(root), "versions", directory); mkdirSync(binDir, { recursive: true });
  const executions = join(root, "filter-count.txt"), permissionInputs = join(root, "permission-inputs.txt");
  writeFileSync(join(binDir, "rtk"), `#!${process.execPath}\nconst fs = require('node:fs');let input='';process.stdin.on('data',x=>input+=x);process.stdin.on('end',()=>{fs.appendFileSync(${JSON.stringify(executions)},'1\\n');process.stdout.write('120 files in project\\n');});`, { mode: 0o700 });
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
    for (const child of [false, true]) {
      const bodies = await run(child), result = bodies.flatMap(body => body.messages).find(message => message.role === "tool");
      assert.ok(result && JSON.stringify(result.content).includes("RTK 已过滤工具文本"), JSON.stringify(result));
      assert.ok(JSON.stringify(result.content).includes("120 files in project"));
    }
    assert.equal(readFileSync(permissionInputs, "utf8"), originalCommand + "\n", "main permission extension sees original command; child does not load disk extensions");
    assert.equal(readFileSync(executions, "utf8").trim().split("\n").length, 2);
    const stats = rtkStats(root); assert.equal(stats.filtered, 2); assert.deepEqual(new Set(stats.recent.map(e => e.role)), new Set(["main", "subagent"]));
    blocked = true; const bodies = await run(false); assert.ok(JSON.stringify(bodies).includes("permission-fixture"));
    assert.equal(readFileSync(executions, "utf8").trim().split("\n").length, 2, "permission rejection must never invoke RTK");
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(root, { recursive: true, force: true }); }
});
