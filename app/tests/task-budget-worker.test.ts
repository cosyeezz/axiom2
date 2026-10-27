import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  writeFileSync(manager.getSessionFile()!, JSON.stringify(manager.getHeader()) + "\n");
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
    task: { id: "budget-task", inputIds: [], budget: { workMs: 600_000, elapsedMs: 0, deadlineAt: Date.now() + 600_000 } },
  } }); };
  const barrier = async (runId: string) => {
    const key = randomUUID();
    send({ type: "recall", runId, key, ids: [] });
    await wait(() => events.some((event) => event.type === "recalled" && event.key === key), `IPC barrier failed: ${stderr}`);
  };
  const next = async (reply: () => void, label: string) => {
    const count = bodies.length;
    reply();
    await wait(() => bodies.length === count + 1, `${label}: ${stderr}`);
    return bodies.at(-1);
  };
  const prefix = (previous: any, current: any) => assert.deepEqual(current.messages.slice(0, previous.messages.length), previous.messages,
    "already-sent message prefix remains unchanged");
  try {
    const firstRun = randomUUID();
    start(firstRun);
    await wait(() => bodies.length === 1, `initial request missing: ${stderr}`);
    const initial = bodies[0];
    assert.equal(initial.messages[0].role, "system");
    assert.match(JSON.stringify(initial.messages[1]), /本次工作预算：600000ms/);
    assert.match(JSON.stringify(initial.messages[2]), /Investigate evidence\./);
    assert.match(JSON.stringify(initial.messages[0]), /Keep the final report within 2000 characters/);
    assert.doesNotMatch(JSON.stringify(initial.messages[0]), /\p{Script=Han}/u, "the actual subagent system payload is English");
    const deadlineAt = Date.now() + 10_000;
    const update = { type: "budget", runId: firstRun, workMs: 60_000, deadlineAt };
    send(update); send(update);
    await barrier(firstRun);
    assert.equal(bodies.length, 1, "warning must not interrupt an in-flight request");
    const updated = await next(() => releases.at(-1)!(), "budget update did not continue at the native Steering boundary");
    prefix(initial, updated);
    assert.match(JSON.stringify(updated.messages.at(-1)), /工作预算已更新/);
    const warnedRequest = await next(() => releases.at(-1)!(), "warning did not continue at the native Steering boundary");
    prefix(updated, warnedRequest);
    const warned = JSON.stringify(warnedRequest.messages);
    assert.equal(warned.match(/截至本条提醒生成时/g)?.length, 1, "repeated budget update must not duplicate the warning");
    assert.equal(warned.match(/工作预算已更新/g)?.length, 1, "duplicate revisions must not duplicate the update");
    assert.match(warned, /剩余约\d+秒/);
    assert.match(warned, /未完成／未验证项/);

    const refreshedDeadline = Date.now() + 600_000;
    const inputId = randomUUID();
    send({ type: "input", runId: firstRun, id: inputId, text: "Continue after budget extension.", mode: "steer",
      budget: { workMs: 600_000, elapsedMs: 0, deadlineAt: refreshedDeadline, revision: 1 } });
    await wait(() => events.some((event) => event.type === "input-accepted" && event.id === inputId), "follow-up was not accepted");
    const extended = await next(() => releases.at(-1)!(), "extended request missing");
    prefix(warnedRequest, extended);
    const append = extended.messages.find((message: any) => JSON.stringify(message.content).includes("Continue after budget extension."));
    assert.ok(JSON.stringify(append).includes(new Date(refreshedDeadline).toISOString()), "append alone must tell the model its refreshed deadline");
    assert.match(JSON.stringify(append), /以此为准/);
    releases.at(-1)!();
    await wait(() => events.some((event) => event.type === "idle" && event.runId === firstRun), "first run did not settle");

    const secondRun = randomUUID();
    const second = await next(() => start(secondRun), "reused worker did not start new run");
    prefix(extended, second);
    send(update); // Old-run IPC cannot arm a warning in the new execution.
    await barrier(secondRun);
    releases.at(-1)!();
    await wait(() => events.some((event) => event.type === "idle" && event.runId === secondRun), "second run did not settle");
    assert.equal(bodies.length, 5, "stale run must not trigger a warning continuation");
    assert.equal(events.filter((event) => event.type === "done" && event.status === "completed").length, 2, stderr);

    const thirdRun = randomUUID(), shell = process.platform === "win32" ? "powershell" : "bash";
    const third = await next(() => start(thirdRun), "third run missing");
    prefix(second, third);
    releases.at(-1)!({ name: shell, args: { command: process.platform === "win32" ? "Start-Sleep -Seconds 30" : "sleep 30" } });
    await wait(() => events.some((event) => event.runId === thirdRun && event.type === "tool" && event.status === "running"), "long tool did not start");
    send({ type: "budget", runId: thirdRun, workMs: 60_000, elapsedMs: 0, deadlineAt: Date.now() + 10_000, revision: 1 });
    await barrier(thirdRun); // Leave both the update and its immediate warning unconsumed.
    const summary = { type: "summarize", runId: thirdRun, workMs: 1000, elapsedMs: 0,
      deadlineAt: Date.now(), summaryDeadlineAt: Date.now() + 180000, revision: 2 };
    const reloadId = randomUUID();
    send({ type: "reload", runId: thirdRun, id: reloadId });
    await barrier(thirdRun); // Reload is queued while the tool owns the Session.
    const summarizing = await next(() => send(summary), "tool abort with queued reload did not enter summary");
    await wait(() => events.some(event => event.type === "reload-result" && event.id === reloadId), "queued reload lost its result during phase handoff");
    assert.equal(events.find(event => event.type === "reload-result" && event.id === reloadId).ok, true, stderr);
    assert.deepEqual(summarizing.tools ?? [], []);
    assert.match(JSON.stringify(summarizing.messages.at(-1)), /工作预算已到/);
    assert.match(JSON.stringify(summarizing.messages.at(-2)), /截至本条提醒生成时/);
    assert.match(JSON.stringify(summarizing.messages.at(-3)), /工作预算已更新/);
    prefix(third, summarizing);
    assert.ok(!events.some((event) => event.runId === thirdRun && event.type === "done"), "internal abort cannot settle the business run");
    const forbidden = join(cwd, "summary-must-not-execute.txt");
    const refused = await next(() => releases.at(-1)!({ name: shell, args: { command: process.platform === "win32"
      ? `Set-Content -LiteralPath '${forbidden}' -Value forbidden` : `echo forbidden > '${forbidden}'` } }), "invalid summary tool was not rejected");
    prefix(summarizing, refused);
    assert.equal(existsSync(forbidden), false, "summary cannot execute tools even when the model invents a call");
    assert.deepEqual(refused.tools ?? [], []);
    const appendId = randomUUID();
    const resumed = await next(() => send({ type: "input", runId: thirdRun, id: appendId, text: "NEW-WORK-AFTER-SUMMARY", mode: "steer",
      budget: { workMs: 600000, elapsedMs: 0, deadlineAt: Date.now() + 600000, summaryDeadlineAt: null, revision: 3 } }), "summary append did not resume work");
    prefix(refused, resumed);
    assert.ok(resumed.tools.some((tool: any) => tool.function.name === "read"));
    assert.match(JSON.stringify(resumed.messages), /NEW-WORK-AFTER-SUMMARY/);
    assert.match(JSON.stringify(resumed.messages), /工作预算已到/);
    assert.match(JSON.stringify(resumed.messages.at(-1)), /恢复工作/);
    assert.ok(events.some((event) => event.type === "input-accepted" && event.id === appendId));
    send(summary); // Same-run, older revision must not undo the append.
    await barrier(thirdRun);
    writeFileSync(join(cwd, "evidence.txt"), "verified restored tools");
    const evidence = await next(() => releases.at(-1)!({ name: "read", args: { path: join(cwd, "evidence.txt") } }), "restored read tool did not finish");
    prefix(resumed, evidence);
    assert.match(JSON.stringify(evidence.messages), /verified restored tools/);
    releases.at(-1)!();
    await wait(() => events.some((event) => event.type === "idle" && event.runId === thirdRun), "resumed work did not settle");
    assert.equal(events.filter((event) => event.runId === thirdRun && event.type === "done").length, 1);
    assert.equal(events.find((event) => event.runId === thirdRun && event.type === "done").status, "completed");
    const persisted = readFileSync(manager.getSessionFile()!, "utf8");
    assert.match(persisted, /截至本条提醒生成时/);
    assert.match(persisted, /工作预算已更新/);
    assert.match(persisted, /工作预算已到/);
  } finally {
    clearTimeout(watchdog);
    if (child.exitCode === null) child.kill();
    await exited;
    fixture.closeAllConnections();
    await new Promise<void>((resolve) => fixture.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});
