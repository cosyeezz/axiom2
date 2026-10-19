import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";

const wait = async (check: () => boolean, label: string) => {
  const deadline = Date.now() + 20_000;
  while (!check()) {
    if (Date.now() > deadline) throw Error(label);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

test("real worker warns, summarizes without tools, and refreshes/resumes appended work in the same run", { timeout: 60_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-budget-worker-")), cwd = join(root, "project"), pi = join(root, "pi");
  mkdirSync(cwd); mkdirSync(pi);
  const bodies: any[] = [], releases: ((tool?: { name: string; args: unknown }) => void)[] = [], events: any[] = [];
  const fixture = createServer(async (req, res) => {
    let raw = "";
    for await (const part of req) raw += part;
    bodies.push(JSON.parse(raw));
    res.writeHead(200, { "Content-Type": "text/event-stream" }); res.flushHeaders();
    releases.push((tool) => {
      const chunk = (delta: unknown, finish_reason: string | null = null) => res.write(`data: ${JSON.stringify({
        id: randomUUID(), object: "chat.completion.chunk", created: 1, model: "fixture",
        choices: [{ index: 0, delta, finish_reason }],
      })}\n\n`);
      if (tool) {
        chunk({ role: "assistant", tool_calls: [{ index: 0, id: randomUUID(), type: "function",
          function: { name: tool.name, arguments: JSON.stringify(tool.args) } }] });
        chunk({}, "tool_calls");
      } else { chunk({ role: "assistant", content: "已有证据与未验证项。" }); chunk({}, "stop"); }
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  const modelsFile = join(pi, "models.json");
  writeFileSync(modelsFile, JSON.stringify({ providers: { fixture: {
    api: "openai-completions", baseUrl: `http://127.0.0.1:${(fixture.address() as any).port}/v1`,
    models: [{ id: "fixture", contextWindow: 32000, maxTokens: 1000 }],
  } } }));
  writeFileSync(join(pi, "auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "loopback-only" } }));
  writeFileSync(join(pi, "settings.json"), JSON.stringify({ retry: { enabled: false }, compaction: { enabled: false } }));
  const manager = SessionManager.create(cwd, root);
  manager.appendMessage({ role: "user", content: "Bound task", timestamp: Date.now() });
  manager.appendCustomEntry("axiom-test", {});
  const worker = process.env.AXIOM_TEST_COMPILED
    ? new URL("../dist/server/agent-worker.js", import.meta.url) : new URL("../src/server/agent-worker.ts", import.meta.url);
  const instanceId = randomUUID();
  let lease = { instanceId, generation: 1, leaseId: randomUUID() };
  const child = fork(worker, [], { cwd, env: { ...process.env, AXIOM_PI_DIR: pi,
    AXIOM_EXECUTION_INSTANCE: instanceId, AXIOM_EXECUTION_GENERATION: "1", AXIOM_EXECUTION_PROFILE: "fixture" },
    execArgv: worker.pathname.endsWith(".ts") ? ["--import", import.meta.resolve("tsx")] : [], stdio: ["ignore", "ignore", "pipe", "ipc"] });
  let stderr = "";
  child.stderr?.on("data", (data) => { stderr += data; });
  child.on("message", (event) => events.push(event));
  const exited = once(child, "exit");
  const watchdog = setTimeout(() => child.kill(), 55_000);
  const send = (value: object) => child.send({ ...value, lease });
  const start = (runId: string) => {
    lease = { ...lease, leaseId: randomUUID() };
    return send({ type: "start", input: {
    root, cwd, modelsFile, file: manager.getSessionFile(), runId,
    selection: { provider: "fixture", id: "fixture", thinking: "off" }, prompt: "Investigate evidence.",
    task: { id: "budget-task", role: "", inputIds: [], budget: { workMs: 600_000, elapsedMs: 0, deadlineAt: Date.now() + 600_000 } },
  } }); };
  const barrier = async (runId: string) => {
    const key = randomUUID();
    send({ type: "recall", runId, key, ids: [] });
    await wait(() => events.some((event) => event.type === "recalled" && event.key === key), `IPC barrier failed: ${stderr}`);
  };
  try {
    const firstRun = randomUUID();
    start(firstRun);
    await wait(() => bodies.length === 1, `initial request missing: ${stderr}`);
    assert.match(JSON.stringify(bodies[0].messages), /本次执行预算：600000ms/);
    assert.match(JSON.stringify(bodies[0].messages), /最多提前 60 秒/);
    const deadlineAt = Date.now() + 10_000;
    const update = { type: "budget", runId: firstRun, workMs: 60_000, deadlineAt };
    send(update); send(update);
    await barrier(firstRun);
    assert.equal(bodies.length, 1, "warning must not interrupt an in-flight request");
    releases[0]();
    await wait(() => bodies.length === 2, "warning did not continue at the native Steering boundary");
    const warned = JSON.stringify(bodies[1].messages);
    assert.equal(warned.match(/子任务预算即将用尽/g)?.length, 1, "repeated budget update must not duplicate the warning");
    assert.match(warned, /剩余约 \d+ 秒/);
    assert.match(warned, /未完成／未验证项/);

    const refreshedDeadline = Date.now() + 600_000;
    const inputId = randomUUID();
    send({ type: "input", runId: firstRun, id: inputId, text: "Continue after budget extension.", mode: "steer",
      budget: { workMs: 600_000, elapsedMs: 0, deadlineAt: refreshedDeadline, revision: 1 } });
    await wait(() => events.some((event) => event.type === "input-accepted" && event.id === inputId), "follow-up was not accepted");
    releases[1]();
    await wait(() => bodies.length === 3, "extended request missing");
    assert.doesNotMatch(JSON.stringify(bodies[2].messages), /子任务预算即将用尽/, "obsolete warning must leave the request context after extension");
    const append = bodies[2].messages.find((message: any) => JSON.stringify(message.content).includes("Continue after budget extension."));
    assert.ok(JSON.stringify(append).includes(new Date(refreshedDeadline).toISOString()), "append alone must tell the model its refreshed deadline");
    assert.match(JSON.stringify(append), /覆盖此前截止时间/);
    releases[2]();
    await wait(() => events.some((event) => event.type === "idle" && event.runId === firstRun), "first run did not settle");

    const secondRun = randomUUID();
    start(secondRun);
    await wait(() => bodies.length === 4, "reused worker did not start new run");
    assert.doesNotMatch(JSON.stringify(bodies[3].messages), /子任务预算即将用尽/, "historical warning must not carry into a new execution");
    send(update); // Old-run IPC cannot arm a warning in the new execution.
    await barrier(secondRun);
    releases[3]();
    await wait(() => events.some((event) => event.type === "idle" && event.runId === secondRun), "second run did not settle");
    assert.equal(bodies.length, 4, "stale run must not trigger a warning continuation");
    assert.equal(events.filter((event) => event.type === "done" && event.status === "completed").length, 2, stderr);

    const thirdRun = randomUUID(), shell = process.platform === "win32" ? "powershell" : "bash";
    start(thirdRun);
    await wait(() => bodies.length === 5, "third run missing");
    releases[4]({ name: shell, args: { command: process.platform === "win32" ? "Start-Sleep -Seconds 30" : "sleep 30" } });
    await wait(() => events.some((event) => event.runId === thirdRun && event.type === "tool" && event.status === "running"), "long tool did not start");
    const summary = { type: "summarize", runId: thirdRun, workMs: 1000, elapsedMs: 0,
      deadlineAt: Date.now(), summaryDeadlineAt: Date.now() + 180000, revision: 1 };
    send(summary);
    await wait(() => bodies.length === 6, `tool abort did not enter summary: ${stderr}`);
    assert.deepEqual(bodies[5].tools ?? [], []);
    assert.match(JSON.stringify(bodies[5].messages.at(-1)), /工作预算已到/);
    assert.ok(!events.some((event) => event.runId === thirdRun && event.type === "done"), "internal abort cannot settle the business run");
    const forbidden = join(cwd, "summary-must-not-execute.txt");
    releases[5]({ name: shell, args: { command: process.platform === "win32"
      ? `Set-Content -LiteralPath '${forbidden}' -Value forbidden` : `echo forbidden > '${forbidden}'` } });
    await wait(() => bodies.length === 7, "invalid summary tool was not rejected");
    assert.equal(existsSync(forbidden), false, "summary cannot execute tools even when the model invents a call");
    assert.deepEqual(bodies[6].tools ?? [], []);
    const appendId = randomUUID();
    send({ type: "input", runId: thirdRun, id: appendId, text: "NEW-WORK-AFTER-SUMMARY", mode: "steer",
      budget: { workMs: 600000, elapsedMs: 0, deadlineAt: Date.now() + 600000, summaryDeadlineAt: null, revision: 2 } });
    await wait(() => bodies.length === 8, `summary append did not resume work: ${stderr}`);
    assert.ok(bodies[7].tools.some((tool: any) => tool.function.name === "read"));
    assert.match(JSON.stringify(bodies[7].messages), /NEW-WORK-AFTER-SUMMARY/);
    assert.doesNotMatch(JSON.stringify(bodies[7].messages), /现在只基于已有上下文生成最终总结/);
    assert.ok(events.some((event) => event.type === "input-accepted" && event.id === appendId));
    send(summary); // Same-run, older revision must not undo the append.
    await barrier(thirdRun);
    writeFileSync(join(cwd, "evidence.txt"), "verified restored tools");
    releases[7]({ name: "read", args: { path: join(cwd, "evidence.txt") } });
    await wait(() => bodies.length === 9, "restored read tool did not finish");
    assert.match(JSON.stringify(bodies[8].messages), /verified restored tools/);
    releases[8]();
    await wait(() => events.some((event) => event.type === "idle" && event.runId === thirdRun), "resumed work did not settle");
    assert.equal(events.filter((event) => event.runId === thirdRun && event.type === "done").length, 1);
    assert.equal(events.find((event) => event.runId === thirdRun && event.type === "done").status, "completed");
  } finally {
    clearTimeout(watchdog);
    if (child.exitCode === null) child.kill();
    await exited;
    fixture.closeAllConnections();
    await new Promise<void>((resolve) => fixture.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});
