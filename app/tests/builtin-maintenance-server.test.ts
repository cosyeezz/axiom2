import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";
import { startServer } from "../src/server/index.js";
import { ProxyProcess } from "../src/server/integrations/model-proxy-process.js";
import { atomicProxyJson, proxyConfigPath, proxyDirectory } from "../src/server/integrations/model-proxy-config.js";
import { atomicReaJson, reaConfigPath, reaDirectory } from "../src/server/integrations/rea-runtime.js";
import { atomicRtkJson, rtkConfigPath, rtkDirectory } from "../src/server/integrations/rtk-config.js";
import { openCliConfigPath, openCliVersionPaths } from "../src/server/integrations/opencli-runtime.js";
import { defaultOpenCliSettings } from "../src/shared/builtin-tools.js";
import type { Reply, Session, Workspace } from "../src/shared/protocol.js";
import type { ModelProxyState } from "../src/shared/model-proxy.js";
import type { ReaState } from "../src/shared/rea.js";
import type { RtkState } from "../src/shared/rtk.js";
import type { OpenCliState } from "../src/shared/builtin-tools.js";
import type { ResourceState } from "../src/shared/resources.js";
import { running } from "../src/shared/agent.js";
import { openCliFixture } from "./fixtures/opencli.js";
import { writeReaPackage } from "./rea-fixture.js";
import { replyToFixtureTitle } from "./model-request-fixture.js";

const wait = async (check: () => boolean | Promise<boolean>, label: string) => {
  const deadline = Date.now() + 15000;
  while (!await check()) { assert.ok(Date.now() < deadline, label); await delay(20); }
};

test("builtin removal never drains or interrupts a real session, or blocks model selection and steering", { timeout: 60000, skip: process.platform === "win32" && "proxy fixture needs POSIX process enumeration" }, async t => {
  const cli = openCliFixture(), root = cli.root, pi = join(root, "pi"), project = join(root, "project");
  mkdirSync(pi); mkdirSync(project);
  const oldPi = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = pi;
  t.after(() => {
    if (oldPi === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = oldPi;
    rmSync(root, { recursive: true, force: true });
  });
  let app: Awaited<ReturnType<typeof startServer>> | undefined, ws: WebSocket | undefined;
  let releaseProxy!: () => void, stopping = false;
  const proxyGate = new Promise<void>(resolve => { releaseProxy = resolve; });
  t.mock.method(ProxyProcess.prototype, "start", async function(this: ProxyProcess) { this.endpoint.status = "running"; });
  t.mock.method(ProxyProcess.prototype, "stop", async function(this: ProxyProcess) {
    stopping = true; await proxyGate; this.endpoint.status = "stopped";
  });
  const reaVersion = `v6.7.0-${randomUUID()}`, reaPath = join(reaDirectory(root), "versions", reaVersion);
  writeReaPackage(join(reaPath, "node_modules", "rea-agents"), "6.7.0");
  atomicReaJson(reaConfigPath(root), { format: 1, revision: randomUUID(), enabled: true, skillInstalled: true, mcpInstalled: true, installation: { directory: reaVersion, version: "6.7.0" } });
  const cliVersion = `v1.8.8-${randomUUID()}`, cliPaths = openCliVersionPaths(root, cliVersion);
  cli.install("1.8.8", cliPaths.packageRoot, cliPaths.binDirectory);
  writeFileSync(openCliConfigPath(root), JSON.stringify({ format: 1, revision: randomUUID(), ...defaultOpenCliSettings, ...cliPaths, directory: cliVersion }));
  const rtkVersion = `v1.0.0-${randomUUID()}`, rtkPath = join(rtkDirectory(root), "versions", rtkVersion);
  mkdirSync(rtkPath, { recursive: true }); writeFileSync(join(rtkPath, "sentinel"), "program");
  atomicRtkJson(rtkConfigPath(root), { format: 1, revision: randomUUID(), enabled: false, level: "balanced", subagents: true, installation: { directory: rtkVersion, version: "1.0.0" } });
  const proxyVersion = `xray-1.0.0-${randomUUID()}`, proxyPath = join(proxyDirectory(root), "versions", proxyVersion);
  mkdirSync(proxyPath, { recursive: true }); writeFileSync(join(proxyPath, "sentinel"), "program");
  atomicProxyJson(proxyConfigPath(root), { revision: randomUUID(), installations: { xray: { directory: proxyVersion, version: "1.0.0" } }, bindings: {}, profiles: [{ id: randomUUID(), name: "fixture", kernel: "xray", node: "fixture", source: "fixture", enabled: true }] });
  const skill = join(pi, "skills", "remove-while-streaming"); mkdirSync(skill, { recursive: true });
  writeFileSync(join(skill, "SKILL.md"), "---\nname: remove-while-streaming\ndescription: nonblocking removal fixture\n---\nGuide\n");
  const bodies: any[] = [], releases: (() => void)[] = [];
  const model = createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    if ((body.messages ?? []).some((message: any) => ["system", "developer"].includes(message.role) && typeof message.content === "string" && message.content.includes("为会话生成简明标题"))) { replyToFixtureTitle(body, res); return; }
    bodies.push(body);
    res.writeHead(200, { "Content-Type": "text/event-stream" }); res.flushHeaders();
    const chunk = (delta: unknown, finish_reason: string | null = null) => res.write(`data: ${JSON.stringify({ id: randomUUID(), object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    chunk({ role: "assistant", content: "working" });
    let released = false;
    releases.push(() => {
      if (released || res.destroyed || res.writableEnded) return;
      released = true; chunk({ content: " done" }); chunk({}, "stop"); res.end("data: [DONE]\n\n");
    });
  });
  t.after(() => new Promise<void>(resolve => { model.close(() => resolve()); model.closeAllConnections(); }));
  await new Promise<void>(resolve => model.listen(0, "127.0.0.1", resolve));
  const selection = { provider: "removal-fixture", id: "model-a", thinking: "off" }, next = { ...selection, id: "model-b" };
  writeFileSync(join(pi, "models.json"), JSON.stringify({ providers: { [selection.provider]: { api: "openai-completions", baseUrl: `http://127.0.0.1:${(model.address() as { port: number }).port}/v1`, models: [selection.id, next.id].map(id => ({ id, contextWindow: 32000, maxTokens: 1000 })) } } }));
  writeFileSync(join(pi, "auth.json"), JSON.stringify({ [selection.provider]: { type: "api_key", key: "fixture" } }));
  writeFileSync(join(pi, "settings.json"), JSON.stringify({ retry: { enabled: false }, compaction: { enabled: false } }));
  try {
    app = await startServer({ root, port: 0, openCli: { execute: cli.execute, runtime: cli.runtime, locateNpm: cli.locateNpm } });
    const server = app;
    ws = new WebSocket(app.origin.replace("http", "ws") + "/ws", { origin: app.origin }); await once(ws, "open");
    const socket = ws;
    async function request(op: string, params = {}, scope = {}): Promise<Reply> {
      const requestId = randomUUID();
      const response = new Promise<Reply>((resolve, reject) => {
        const timer = setTimeout(() => { socket.off("message", receive); reject(Error(`receipt timeout: ${op}`)); }, 10000);
        function receive(raw: Buffer) {
          const value = JSON.parse(raw.toString());
          if (value.type !== "receipt" || value.requestId !== requestId) return;
          clearTimeout(timer); socket.off("message", receive); resolve(value);
        }
        socket.on("message", receive);
      });
      socket.send(JSON.stringify({ requestId, op, params, ...scope })); return response;
    }
    async function call<T>(op: string, params = {}, scope = {}): Promise<T> {
      const reply = await request(op, params, scope); assert.equal(reply.ok, true, JSON.stringify(reply)); return reply.data as T;
    }
    const workspace = await call<Workspace>("workspace.open", { path: project, authorized: true });
    const session = await call<Session>("session.create", {}, { workspaceId: workspace.id });
    const scope = { workspaceId: workspace.id, sessionId: session.id };
    await call("agent.model", { selection }, scope); await call("prompt", { text: "keep streaming" }, scope);
    await wait(() => releases.length === 1, "real worker starts its model request");
    const runId = app.agents.info(scope).run!.id;
    assert.equal('maintenance' in app.agents.pool, false, "the global worker maintenance mechanism is removed");
    assert.equal('maintenancePending' in app.agents, false, "session managers expose no component-maintenance admission state");
    // Call-through spies also permit the pool's normal shutdown after assertions.
    const trim = t.mock.method(app.agents.pool, "trim");
    const invalidate = t.mock.method(app.agents.pool, "invalidate");
    const proxy = await call<ModelProxyState>("modelProxy.get");
    await call("modelProxy.uninstall", { kernel: "xray", confirm: true, revision: proxy.revision, cleanupRevision: proxy.cleanup!.xray!.revision });
    await wait(() => stopping, "proxy begins its own process cleanup without waiting for the session");
    assert.equal((await call<ModelProxyState>("modelProxy.get")).job!.running, true);
    await call("agent.model", { selection: next }, scope);
    await call("prompt", { text: "steer while maintenance is running" }, scope);
    const append = await request("task.append", { taskId: "missing-task", text: "new work" }, scope);
    assert.equal(append.ok, false); assert.equal(append.error.code, "TASK_SCOPE_MISMATCH", "task validation is independent of component maintenance");
    const resources = await call<ResourceState>("resources.get"), item = resources.items.find(item => item.name === "remove-while-streaming")!;
    assert.ok(item?.removable);
    await call("resources.remove", { id: item.id, revision: resources.revision, confirm: true });
    await wait(async () => !(await call<ResourceState>("resources.get")).job?.running, "resource removal settles while proxy cleanup is active");
    assert.equal((await call<ResourceState>("resources.get")).job?.error, undefined); assert.equal(existsSync(skill), false);
    for (const [tool, path] of [["rea", reaPath], ["opencli", cliPaths.prefix], ["rtk", rtkPath]] as const) {
      const before = await call<ReaState | OpenCliState | RtkState>(`${tool}.get`);
      await call(`${tool}.uninstall`, { confirm: true, revision: before.revision, cleanupRevision: before.cleanup!.revision });
      await wait(async () => !(await call<ReaState | OpenCliState | RtkState>(`${tool}.get`)).job?.running, `${tool} removal does not wait for the session or another component`);
      const after = await call<ReaState | OpenCliState | RtkState>(`${tool}.get`);
      assert.equal(after.job?.error, undefined, `${tool} removal succeeded`); assert.equal(existsSync(path), false, `${tool} files are physically removed`);
    }
    assert.equal(bodies.length, 1, "maintenance and model selection cannot restart the in-flight model request");
    assert.equal(app.agents.info(scope).run!.id, runId); assert.equal(running(app.agents.info(scope).run), true);
    assert.equal(trim.mock.callCount(), 0); assert.equal(invalidate.mock.callCount(), 0);
    releaseProxy();
    await wait(async () => !(await call<ModelProxyState>("modelProxy.get")).job?.running, "proxy removal settles");
    assert.equal((await call<ModelProxyState>("modelProxy.get")).job?.error, undefined); assert.equal(existsSync(proxyPath), false);
    releases[0](); await wait(() => releases.length === 2, "same session processes steering after removal");
    assert.deepEqual(bodies.map(body => body.model), [selection.id, next.id]);
    assert.equal(app.agents.info(scope).run!.id, runId, "no forced session restart or replacement");
    releases[1](); await wait(() => !running(server.agents.info(scope).run), "session finishes normally");
    assert.equal(app.agents.info(scope).run!.status, "completed");
    assert.equal(trim.mock.callCount(), 0); assert.equal(invalidate.mock.callCount(), 0);
  } finally {
    releaseProxy(); for (const release of releases) release();
    ws?.terminate();
    // Keep the proxy fixture mocks active through service shutdown.
    try { await app?.close(); } finally { t.mock.restoreAll(); }
  }
});
