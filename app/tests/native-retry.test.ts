// Real pi workers against loopback only; never uses personal model credentials.
import assert from "node:assert/strict";
import { test } from "node:test";
import { replyToFixtureTitle } from "./model-request-fixture.js";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "./temporary.js";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { startServer } from "../src/server/index.js";
import { openTranscript } from "../src/server/transcript.js";
import type { Scope, Session, Workspace } from "../src/shared/protocol.js";
import type { SessionEnvironment } from "../src/shared/agent.js";
import { sessionRetryDelaysMs } from "../src/shared/retry-policy.js";

const until = async (check: () => boolean, message: string, ms = 25000) => {
  const end = Date.now() + ms;
  while (!check()) { if (Date.now() > end) throw Error(message); await new Promise((resolve) => setTimeout(resolve, 20)); }
};

test("native retries, cancellation, persisted recovery, single tool effects and guarded continuation", { timeout: 240000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-native-retry-")), project = join(root, "project");
  const previous = process.env.AXIOM_PI_DIR;
  process.env.AXIOM_PI_DIR = join(root, "pi");
  mkdirSync(project); mkdirSync(join(root, "pi"));
  let mode = "retry", count = 0;
  const requests: any[] = [];
  const fixture = createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    if (replyToFixtureTitle(body, res)) return;
    requests.push(body); count++;
    const failure = mode === "exhaust" || mode === "stop" || (mode === "tool-exhaust" && count > 1) || (["retry", "rate", "steer", "retry-tool"].includes(mode) && count === 1) || (mode === "tool" && count === 2);
    if (failure || mode === "auth") {
      res.writeHead(mode === "auth" ? 401 : mode === "rate" ? 429 : 503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: mode === "auth" ? "invalid api key; api_key=sk-fixture-secret" : mode === "rate" ? "429 rate limit exceeded" : "503 temporarily unavailable; api_key=sk-fixture-secret", type: mode === "auth" ? "authentication_error" : "server_error" } })); return;
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const chunk = (delta: unknown, finish_reason: string | null = null) => res.write(`data: ${JSON.stringify({ id: randomUUID(), object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    if (["tool", "tool-exhaust"].includes(mode) && count === 1 || mode === "retry-tool" && count === 2) {
      chunk({ role: "assistant", tool_calls: [{ index: 0, id: "write-once", type: "function", function: { name: "write", arguments: JSON.stringify({ path: "once.txt", content: "one execution" }) } }] });
      chunk({}, "tool_calls");
    } else { chunk({ role: "assistant", content: "fixture result" }); chunk({}, mode === "length" ? "length" : "stop"); }
    res.write(`data: ${JSON.stringify({ id: "usage", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [], usage: { prompt_tokens: 100, completion_tokens: 1000, total_tokens: 1100 } })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  writeFileSync(join(root, "pi", "models.json"), JSON.stringify({ providers: { "retry-fixture": { api: "openai-completions", baseUrl: `http://127.0.0.1:${(fixture.address() as any).port}/v1`, models: [{ id: "fixture", name: "Fixture", contextWindow: 32000, maxTokens: 1000 }] } } }));
  writeFileSync(join(root, "pi", "auth.json"), JSON.stringify({ "retry-fixture": { type: "api_key", key: "local-fixture" } }));
  writeFileSync(join(root, "pi", "settings.json"), JSON.stringify({ retry: { enabled: true, maxRetries: 2, baseDelayMs: 1200, provider: { maxRetries: 0 } }, compaction: { enabled: false }, cacheWarming: "off" }));
  let app: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    app = await startServer({ root, port: 0 });
    const service = app;
    const w = app.store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: project, authorized: true } }) as Workspace;
    const selection = { provider: "retry-fixture", id: "fixture", thinking: "off" };
    const call = (scope: Scope, op: string, params = {}, requestId = randomUUID()) => service.tasks.command({ requestId, op, params, ...scope });
    const create = async () => {
      const s = service.store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: w.id }) as Session;
      const scope = { workspaceId: w.id, sessionId: s.id };
      await call(scope, "agent.model", { selection }); return scope;
    };
    const info = (scope: Scope) => service.agents.info(scope);
    const entries = (scope: Scope) => openTranscript(String(service.store.db.prepare("SELECT file FROM agent_sessions WHERE sessionId=?").get(scope.sessionId)!.file), project).getEntries();
    const run = async (scope: Scope, next: string) => { mode = next; count = 0; requests.length = 0; return call(scope, "prompt", { text: `${next} fixture request` }) as Promise<{ runId: string }>; };
    const done = (scope: Scope) => until(() => !service.agents.active(scope), "worker did not settle");

    const retry = await create();
    const started = await run(retry, "retry");
    await until(() => info(retry).run?.retry?.state === "waiting", "missing waiting state");
    assert.equal(info(retry).run?.id, started.runId);
    assert.equal(info(retry).run?.status, "running");
    assert.equal(info(retry).run?.phase, "retry_wait");
    assert.equal(info(retry).environment?.retry?.maxRetries, 2);
    assert.doesNotMatch(info(retry).run!.retry!.message!, /sk-fixture-secret/);
    assert.equal(service.store.session(w.id, retry.sessionId).resultVersion, 0, "retry attempts aren't final results");
    await done(retry);
    assert.equal(info(retry).run?.status, "completed");
    assert.equal(info(retry).run?.retry?.state, "succeeded");
    assert.equal(count, 2);
    assert.deepEqual(requests[0].messages, requests[1].messages, "native retry retains the request prefix");
    assert.equal(entries(retry).filter((e) => e.type === "context_edit").length, 1);
    assert.equal(service.agents.messages(retry).filter((m) => m?.status === "failed").length, 0, "context edit reconciles the displayed projection");
    await service.agents.releaseIdle(retry);
    assert.equal(service.agents.messages(retry).filter((m) => m?.role === "user").length, 1);

    const rate = await create(); const rateRun = await run(rate, "rate"); await done(rate);
    assert.equal(count, 2); assert.equal(info(rate).run?.id, rateRun.runId);
    assert.equal(info(rate).run?.status, "completed");

    const steering = await create(); const steeringRun = await run(steering, "steer");
    await until(() => info(steering).run?.retry?.state === "waiting", "missing steering waiting state");
    const queued = await call(steering, "prompt", { text: "additional requirement during retry" }) as { runId: string };
    assert.equal(queued.runId, steeringRun.runId);
    await done(steering);
    assert.equal(info(steering).run?.status, "completed");
    assert.equal(info(steering).run?.id, steeringRun.runId);
    assert.equal(service.agents.messages(steering).filter((m) => m?.text === "additional requirement during retry").length, 1);
    assert.ok(requests.some((request) => JSON.stringify(request.messages).includes("additional requirement during retry")));

    const retryTool = await create(); await run(retryTool, "retry-tool"); await done(retryTool);
    assert.equal(info(retryTool).run?.status, "completed");
    assert.equal(count, 3, "successful retry with toolUse must continue to the final assistant");
    assert.equal(entries(retryTool).filter((e) => e.type === "message" && e.message.role === "toolResult").length, 1);

    const exhausted = await create(); await run(exhausted, "exhaust"); await done(exhausted);
    assert.equal(count, 3); assert.equal(info(exhausted).run?.status, "failed");
    assert.equal(info(exhausted).run?.retry?.state, "exhausted");
    assert.match(info(exhausted).run!.error!, /503/);
    assert.doesNotMatch(info(exhausted).run!.error!, /sk-fixture-secret/);

    const auth = await create(); await run(auth, "auth"); await done(auth);
    assert.equal(count, 1); assert.equal(info(auth).run?.status, "failed");
    assert.match(info(auth).run!.error!, /invalid api key/); assert.doesNotMatch(info(auth).run!.error!, /sk-fixture-secret/);

    const length = await create(); const truncated = await run(length, "length"); await done(length);
    assert.equal(info(length).run?.reasonCode, "OUTPUT_TRUNCATED");
    assert.equal(info(length).run?.status, "failed");
    assert.equal(service.agents.messages(length).findLast((m) => m?.role === "assistant")?.status, "failed");
    assert.equal(service.agents.hasIdle(length), false);
    const originalLengthRequest = requests[0].messages;
    mode = "retry"; count = 0; requests.length = 0;
    const requestId = randomUUID(), params = { expectedRunId: truncated.runId };
    const continued = await call(length, "agent.resume", params, requestId) as { runId: string };
    assert.notEqual(continued.runId, truncated.runId);
    assert.equal(service.store.session(w.id, length.sessionId).unread, true, "new input does not acknowledge old results");
    assert.deepEqual(await call(length, "agent.resume", params, requestId), continued, "same request receipt never repeats the run");
    await assert.rejects(call(length, "agent.resume", params), { code: "RUN_MISMATCH" });
    await done(length);
    assert.equal(info(length).run?.resumedFromRunId, truncated.runId);
    assert.equal(info(length).run?.status, "completed", info(length).run?.error ?? "");
    assert.equal(service.agents.messages(length).filter((m) => m?.role === "user").length, 1);
    assert.deepEqual(requests[0].messages, originalLengthRequest, "manual retry adds no user instruction or empty message");
    assert.deepEqual(requests[0].messages, requests[1].messages, "resumed run retains native retry lifecycle");
    assert.equal(entries(length).filter((e) => e.type === "message" && e.message.role === "user").length, 1);
    await assert.rejects(call(length, "agent.resume", {}), { code: "INVALID_INPUT" });
    await assert.rejects(call(length, "agent.resume", { expectedRunId: continued.runId, text: "hidden instruction" }), { code: "INVALID_INPUT" });

    const tool = await create(); await run(tool, "tool"); await done(tool);
    assert.equal(info(tool).run?.status, "completed");
    assert.equal(count, 3);
    assert.equal(readFileSync(join(project, "once.txt"), "utf8"), "one execution");
    assert.equal(entries(tool).filter((e) => e.type === "message" && e.message.role === "toolResult" && e.message.toolName === "write").length, 1);
    assert.deepEqual(requests[1].messages, requests[2].messages, "tool results stay in the retry prefix");

    const manualTool = await create(); const toolFailed = await run(manualTool, "tool-exhaust"); await done(manualTool);
    assert.equal(info(manualTool).run?.status, "failed");
    const afterTool = requests[1].messages;
    mode = "success"; count = 0; requests.length = 0;
    await call(manualTool, "agent.resume", { expectedRunId: toolFailed.runId }); await done(manualTool);
    assert.equal(info(manualTool).run?.status, "completed", info(manualTool).run?.error ?? "");
    assert.equal(count, 1, "resume makes only the missing response request");
    assert.deepEqual(requests[0].messages, afterTool, "resume continues directly from existing tool results");
    assert.equal(entries(manualTool).filter((e) => e.type === "message" && e.message.role === "toolResult" && e.message.toolName === "write").length, 1);
    assert.equal(entries(manualTool).filter((e) => e.type === "message" && e.message.role === "user").length, 1);
    await service.agents.releaseIdle(manualTool);
    const restored = openTranscript(String(service.store.db.prepare("SELECT file FROM agent_sessions WHERE sessionId=?").get(manualTool.sessionId)!.file), project).buildSessionContext().messages;
    assert.equal(restored.some((m) => m.role === "custom" && m.customType === "axiom-resume"), false, "control trigger is excluded after reload");

    // Simulate a worker crash between saving one sibling result and the other.
    const interrupted = await create(); const interruptedRun = await run(interrupted, "auth"); await done(interrupted);
    const interruptedFile = String(service.store.db.prepare("SELECT file FROM agent_sessions WHERE sessionId=?").get(interrupted.sessionId)!.file);
    const manager = openTranscript(interruptedFile, project);
    const failureEntry = manager.getBranch().findLast((e) => e.type === "message" && e.message.role === "assistant")!;
    assert.ok(failureEntry.type === "message" && failureEntry.message.role === "assistant");
    manager.appendContextEdit(failureEntry.id, null);
    manager.appendMessage({ ...failureEntry.message, stopReason: "toolUse", content: [
      { type: "toolCall", id: "saved-write", name: "write", arguments: { path: "once.txt", content: "do not replay" } },
      { type: "toolCall", id: "unknown-write", name: "write", arguments: { path: "unknown.txt", content: "do not replay" } },
    ] });
    manager.appendMessage({ role: "toolResult", toolCallId: "saved-write", toolName: "write",
      content: [{ type: "text", text: "Saved tool result" }], isError: false, timestamp: Date.now() });
    writeFileSync(join(project, "unknown.txt"), "possibly already executed");
    mode = "success"; count = 0; requests.length = 0;
    await call(interrupted, "agent.resume", { expectedRunId: interruptedRun.runId }); await done(interrupted);
    assert.equal(info(interrupted).run?.status, "completed");
    assert.equal(count, 1);
    assert.equal(readFileSync(join(project, "once.txt"), "utf8"), "one execution");
    assert.equal(readFileSync(join(project, "unknown.txt"), "utf8"), "possibly already executed");
    const toolMessages = requests[0].messages.filter((m: any) => m.role === "tool");
    assert.equal(toolMessages.length, 2);
    assert.match(JSON.stringify(toolMessages), /Saved tool result/);
    assert.match(JSON.stringify(toolMessages), /结果未知/);
    const unknownResult = entries(interrupted).find((e) => e.type === "message" && e.message.role === "toolResult" && e.message.toolCallId === "unknown-write");
    assert.ok(unknownResult?.type === "message" && unknownResult.message.role === "toolResult" && unknownResult.message.isError);

    // A child retry must keep task scheduling, immutable reports and research/test tools.
    const parent = await create(), child = await create(), taskId = randomUUID();
    service.store.db.prepare("INSERT INTO task_parents(sessionId,frozen) VALUES(?,1)").run(parent.sessionId);
    service.store.db.prepare("INSERT INTO tasks(id,workspaceId,parentSessionId,sessionId,anchor,description,status,budgets,createdAt) VALUES(?,?,?,?,'fixture','retry child','interrupted','{}',?)")
      .run(taskId, w.id, parent.sessionId, child.sessionId, Date.now());
    await run(child, "auth");
    await until(() => service.tasks.child(child)?.status === "failed", "child initial execution did not fail");
    const childRun = info(child).run!.id;
    const previousResult = service.store.db.prepare("SELECT body FROM task_results WHERE runId=?").get(childRun)!.body;
    mode = "success"; count = 0; requests.length = 0;
    const childRequest = randomUUID();
    const childAccepted = await call(child, "agent.resume", { expectedRunId: childRun }, childRequest);
    assert.deepEqual(await call(child, "agent.resume", { expectedRunId: childRun }, childRequest), childAccepted);
    await until(() => service.tasks.child(child)?.status === "completed", "child retry did not complete");
    assert.equal(info(child).run?.resumedFromRunId, childRun);
    assert.equal(count, 1);
    assert.deepEqual(requests[0].tools.map((tool: any) => tool.function.name).sort(), ["find", "grep", "ls", "read", process.platform === "win32" ? "powershell" : "bash"].sort());
    assert.equal(entries(child).filter((e) => e.type === "message" && e.message.role === "user").length, 1);
    assert.equal(service.store.db.prepare("SELECT body FROM task_results WHERE runId=?").get(childRun)!.body, previousResult);
    assert.equal(service.store.db.prepare("SELECT COUNT(*) AS n FROM task_results WHERE taskId=?").get(taskId)!.n, 2);
    assert.equal(service.store.db.prepare("SELECT COUNT(*) AS n FROM task_inputs WHERE taskId=?").get(taskId)!.n, 0);

    // Leave a wide cancellation window on loaded CI runners; the preceding
    // retry cases intentionally use short delays, but this case must stop
    // during backoff rather than race its expiry. Successful cancellation
    // aborts the timer, so this does not add a 30-second test wait.
    writeFileSync(join(root, "pi", "settings.json"), JSON.stringify({ retry: { enabled: true, maxRetries: 2, baseDelayMs: 30000, provider: { maxRetries: 0 } }, compaction: { enabled: false }, cacheWarming: "off" }));
    const stopped = await create(); await run(stopped, "stop");
    await until(() => info(stopped).run?.retry?.state === "waiting", "missing stop waiting state");
    assert.equal(info(stopped).environment?.retry?.baseDelayMs, 30000);
    await call(stopped, "agent.stop", { runId: info(stopped).run!.id });
    assert.equal(info(stopped).run?.status, "cancelled");
    assert.equal(info(stopped).run?.retry?.state, "cancelled");
    assert.equal(count, 1, "cancellation during backoff starts no further model request");
    assert.equal(service.agents.active(stopped), false);
    mode = "success"; count = 0;
    await call(stopped, "agent.resume", { expectedRunId: info(stopped).run!.id }); await done(stopped);
    assert.equal(info(stopped).run?.status, "completed");
    assert.equal(count, 1);
    assert.equal(entries(stopped).filter((e) => e.type === "message" && e.message.role === "user").length, 1);

    // No session timing/count override: the real host worker must install the
    // nine-stage policy, not merely display it in a preview. Stop, don't wait.
    writeFileSync(join(root, "pi", "settings.json"), JSON.stringify({ retry: { provider: { maxRetries: 0 } }, compaction: { enabled: false }, cacheWarming: "off" }));
    const defaults = await create();
    const preview = await call(defaults, "agent.environment") as SessionEnvironment;
    assert.equal(preview.retry?.maxRetries, 9);
    assert.deepEqual(preview.retry?.delaysMs, [...sessionRetryDelaysMs]);
    await run(defaults, "stop");
    await until(() => info(defaults).run?.retry?.state === "waiting", "missing default-policy waiting state");
    assert.equal(info(defaults).run?.retry?.maxAttempts, 9, "actual worker event uses the new budget");
    assert.deepEqual(info(defaults).environment?.retry, JSON.parse(JSON.stringify(preview.retry)), "worker IPC omits undefined optional provider fields");
    await call(defaults, "agent.stop", { runId: info(defaults).run!.id });
    assert.equal(info(defaults).run?.status, "cancelled");
  } finally {
    await app?.close(); fixture.closeAllConnections(); await new Promise<void>((resolve) => fixture.close(() => resolve()));
    if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
