import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createServer, request as httpRequest } from "node:http";
import { connect } from "node:net";
import type { Duplex } from "node:stream";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";
import { Agents } from "../src/server/agents.js";
import { Store } from "../src/server/storage.js";
import { ModelService } from "../src/server/model-service.js";
import { openTranscript } from "../src/server/transcript.js";
import type { Selection } from "../src/shared/agent.js";
import type { Session, Workspace } from "../src/shared/protocol.js";
import { replyToFixtureTitle } from "./model-request-fixture.js";

const first: Selection = { provider: "safe-direct", id: "model-a", thinking: "high" };
const second: Selection = { ...first, id: "model-b", thinking: "low" };
const third: Selection = { provider: "safe-proxy", id: "model-c", thinking: "low" };
const png = (() => {
  const chunk = (name: string, data: Buffer) => {
    const type = Buffer.from(name), size = Buffer.alloc(4), crc = Buffer.alloc(4);
    size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([type, data])));
    return Buffer.concat([size, type, data, crc]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.from([0,255,0,0,255]))), chunk("IEND", Buffer.alloc(0))]).toString("base64");
})();
const wait = async (check: () => boolean, label: string | (() => string)) => {
  const deadline = Date.now() + 25000;
  while (!check()) {
    assert.ok(Date.now() < deadline, typeof label === "function" ? label() : label);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
};

async function fixture(t: TestContext, { smallTarget = false, availabilityFailure = false, extensionThinking = false, holdSelection = false }:
  { smallTarget?: boolean; availabilityFailure?: boolean; extensionThinking?: boolean; holdSelection?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "axiom-model-safe-point-")), cwd = join(root, "project"), pi = join(root, "pi");
  for (const path of [pi, cwd, join(cwd, ".pi/extensions")]) mkdirSync(path, { recursive: true });
  const keys = ["AXIOM_PI_DIR", "PI_CODING_AGENT_DIR", "AXIOM_EXECUTION_MODE"] as const;
  const before = keys.map(key => process.env[key]);
  process.env.AXIOM_PI_DIR = pi; process.env.PI_CODING_AGENT_DIR = join(root, "native-auth"); process.env.AXIOM_EXECUTION_MODE = "managed";
  writeFileSync(join(cwd, ".pi/extensions/checkpoint.ts"), `import {appendFileSync,existsSync,writeFileSync} from 'node:fs';
export default function(pi) {
  let heldSelection = false;
  pi.on('model_select', async (event, ctx) => {
    if (${holdSelection} && !heldSelection) {
      heldSelection = true;
      writeFileSync(${JSON.stringify(join(root, "selection-boundary"))}, 'entered');
      while (!existsSync(${JSON.stringify(join(root, "release-selection"))})) await new Promise(r => setTimeout(r, 10));
    }
    if (${availabilityFailure}) {
      const native = ctx.modelRegistry.getProvider(event.model.provider);
      const unavailable = () => { throw Error('fixture availability-only failure'); };
      ctx.modelRegistry.registerProvider({ ...native, filterModels: unavailable, filterAllModels: unavailable });
      await ctx.modelRegistry.refresh({ providers: [event.model.provider], allowNetwork: false });
    }
    if (${availabilityFailure}) writeFileSync(${JSON.stringify(join(root, "availability"))}, JSON.stringify({
      error: ctx.modelRegistry.getError(), modelExists: !!ctx.modelRegistry.find(event.model.provider, event.model.id)
    }));
    if (${extensionThinking} && event.model.id === ${JSON.stringify(second.id)}) {
      pi.setThinkingLevel('off');
      writeFileSync(${JSON.stringify(join(root, "extension-thinking"))}, pi.getThinkingLevel());
    }
  });
  process.on('message', value => { if(value?.type==='model') appendFileSync(${JSON.stringify(join(root, "received"))}, value.revision+'\\n'); });
  pi.registerTool({name:'checkpoint',label:'checkpoint',description:'Local safe point gate',parameters:{type:'object',properties:{},additionalProperties:false},
    async execute(id) {
      writeFileSync(${JSON.stringify(root)}+'/entered-'+id, 'entered');
      while(!existsSync(${JSON.stringify(root)}+'/release-'+id)) await new Promise(r=>setTimeout(r,10));
      appendFileSync(${JSON.stringify(join(root, "finished"))}, id+'\\n');
      return {content:[{type:'text',text:'finished '+id}],details:{}};
    }});
}`);
  writeFileSync(join(pi, "settings.json"), JSON.stringify({ retry: { enabled: false }, compaction: { enabled: false } }));
  const requests: any[] = [], releases: (() => void)[] = [], proxyRequests: string[] = [];
  const requestPaths: string[] = [], requestHeaders: any[] = [], failures = new Map<string, string>();
  let toolBatch = true;
  const http = createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    if ((body.messages ?? []).some((message: any) => typeof message.content === "string" && message.content.includes("为会话生成简明标题"))) {
      replyToFixtureTitle(body, res); return;
    }
    requests.push(body); requestPaths.push(req.url!); requestHeaders.push(req.headers);
    if (failures.has(body.model)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: failures.get(body.model), type: "invalid_request_error" } }));
      return;
    }
    const tools = toolBatch; toolBatch = false;
    res.writeHead(200, { "Content-Type": "text/event-stream" }); res.flushHeaders();
    const chunk = (delta: unknown, finish_reason: string | null = null) => res.write(`data: ${JSON.stringify({ id: randomUUID(), object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    chunk(tools ? { role: "assistant", tool_calls: [0, 1].map(index => ({ index, id: `call-${index}`, type: "function", function: { name: "checkpoint", arguments: "{}" } })) }
      : { role: "assistant", content: "continuing" });
    releases.push(() => { chunk({}, tools ? "tool_calls" : "stop"); res.end("data: [DONE]\n\n"); });
  });
  await new Promise<void>(resolve => http.listen(0, "127.0.0.1", resolve));
  const port = (http.address() as any).port;
  const sockets = new Set<Duplex>();
  const proxy = createServer((req, res) => {
    const url = new URL(req.url!);
    assert.equal(url.hostname, "switch-fixture.invalid");
    proxyRequests.push(url.host);
    const upstream = httpRequest({ hostname: "127.0.0.1", port, path: url.pathname + url.search, method: req.method, headers: req.headers }, response => {
      res.writeHead(response.statusCode!, response.headers); response.pipe(res);
    });
    upstream.on("error", () => { res.writeHead(502); res.end(); });
    req.pipe(upstream);
  });
  proxy.on("connect", (request, socket, head) => {
    proxyRequests.push(request.url!);
    assert.equal(request.url, `switch-fixture.invalid:${port}`);
    const upstream = connect(port, "127.0.0.1");
    for (const peer of [socket, upstream]) { sockets.add(peer); peer.once("close", () => sockets.delete(peer)); }
    upstream.on("error", () => socket.destroy()); socket.on("error", () => upstream.destroy());
    socket.once("close", () => upstream.destroy()); upstream.once("close", () => socket.destroy());
    upstream.once("connect", () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      socket.pipe(upstream); upstream.pipe(socket);
    });
  });
  await new Promise<void>(resolve => proxy.listen(0, "127.0.0.1", resolve));
  const models = { providers: {
    [first.provider]: { api: "openai-completions", baseUrl: `http://127.0.0.1:${port}/v1`,
      models: [first.id, second.id].map(id => ({ id, reasoning: true, input: ["text", "image"], contextWindow: smallTarget && id === second.id ? 1024 : 32000, maxTokens: 256 })) },
    [third.provider]: { api: "openai-completions", baseUrl: `http://switch-fixture.invalid:${port}/v1`,
      axiomProxy: { mode: "external", url: `http://127.0.0.1:${(proxy.address() as any).port}` },
      models: [{ id: third.id, reasoning: true, input: ["text"], contextWindow: 32000, maxTokens: 256 }] },
  } };
  writeFileSync(join(pi, "models.json"), JSON.stringify(models));
  writeFileSync(join(pi, "auth.json"), JSON.stringify(Object.fromEntries([first.provider, third.provider].map(provider => [provider, { type: "api_key", key: "local-fixture-only" }]))));
  const store = new Store(root), agents = new Agents(store, new ModelService(root), () => {});
  const events: unknown[] = [];
  agents.onEvent = (_scope, _run, event) => { if (["model-applied", "model-request", "warning", "done"].includes(event.type)) events.push(event); };
  t.after(async () => {
    await agents.close(); store.close();
    for (const socket of sockets) socket.destroy();
    http.closeAllConnections(); proxy.closeAllConnections();
    await Promise.all([http, proxy].map(server => new Promise<void>(resolve => server.close(() => resolve()))));
    keys.forEach((key, index) => { if (before[index] === undefined) delete process.env[key]; else process.env[key] = before[index]; });
    rmSync(root, { recursive: true, force: true });
  });
  const workspace = store.execute({ op: "workspace.open", requestId: randomUUID(), params: { path: cwd, authorized: true } }) as Workspace;
  const session = store.execute({ op: "session.create", requestId: randomUUID(), workspaceId: workspace.id }) as Session;
  const scope = { workspaceId: workspace.id, sessionId: session.id };
  const command = (op: string, params: Record<string, unknown> = {}) => agents.command({ op, ...scope, requestId: randomUUID(), params });
  await command("agent.model", { selection: first });
  const releaseTool = (id: string) => writeFileSync(join(root, "release-" + id), "go");
  const entered = (id: string) => existsSync(join(root, "entered-" + id));
  const finished = () => existsSync(join(root, "finished")) ? readFileSync(join(root, "finished"), "utf8").trim().split("\n") : [];
  const received = () => existsSync(join(root, "received")) ? readFileSync(join(root, "received"), "utf8").trim().split("\n").length : 0;
  return { root, cwd, pi, models, store, agents, scope, command, requests, requestPaths, requestHeaders, failures, releases, proxyRequests, releaseTool, entered, finished, received, events };
}

test("model switches wait for the full tool batch, coalesce choices, rebind proxy, and never invent a turn", { timeout: 60000 }, async t => {
  const f = await fixture(t);
  await f.command("prompt", { text: "Run both checkpoint tools, then finish." });
  await wait(() => f.releases.length === 1, "first response starts");
  const runId = f.agents.info(f.scope).run!.id;
  f.releases[0]();
  await wait(() => f.entered("call-0"), "first tool starts");
  await f.command("agent.model", { selection: second });
  await f.command("agent.model", { selection: third });
  await wait(() => f.received() === 2, "both model selections reached the worker");
  assert.equal(f.requests.length, 1);
  assert.deepEqual(f.agents.info(f.scope).run!.selection, first);
  assert.deepEqual(f.agents.info(f.scope).selection, third);
  assert.equal(f.agents.affected([third.provider]).length, 1, "pending target is covered by credential revocation");
  await assert.rejects(f.agents.stopProviders([third.provider], false), { code: "ACTIVE_RUNS_CONFIRMATION_REQUIRED" });
  f.releaseTool("call-0");
  await wait(() => f.finished().includes("call-0") && f.entered("call-1"), "second tool remains blocked");
  assert.equal(f.requests.length, 1, "one finished tool is not a safe point");
  assert.deepEqual(f.agents.info(f.scope).run!.selection, first);
  f.releaseTool("call-1");
  await wait(() => f.releases.length === 2 || !f.agents.active(f.scope), () => JSON.stringify({ run: f.agents.info(f.scope).run, proxy: f.proxyRequests, finished: f.finished(), events: f.events }));
  assert.equal(f.releases.length, 2, JSON.stringify(f.agents.info(f.scope).run));
  assert.deepEqual(f.finished().sort(), ["call-0", "call-1"]);
  assert.deepEqual(f.requests.map(body => [body.model, body.reasoning_effort]), [[first.id, "high"], [third.id, "low"]]);
  assert.ok(f.proxyRequests.length > 0, "cross-provider request uses the newly selected proxy, not the old direct network");
  assert.equal(f.requests[1].messages.filter((message: any) => message.role === "tool").length, 2);
  assert.deepEqual(f.requests[1].messages.filter((message: any) => message.role === "user"), f.requests[0].messages.filter((message: any) => message.role === "user"));
  assert.equal(f.agents.info(f.scope).run!.id, runId);
  assert.deepEqual(f.agents.info(f.scope).run!.selection, third);
  assert.equal(f.agents.affected([third.provider]).length, 1);
  assert.equal(f.agents.affected([first.provider]).length, 0, "old provider is no longer the active or desired provider");

  const effort: Selection = { ...third, thinking: "high" };
  await f.command("agent.model", { selection: effort });
  await f.command("prompt", { text: "One more check without repeating the tools." });
  f.releases[1]();
  await wait(() => f.releases.length === 3, "effort-only switch precedes steering");
  assert.equal(f.requests[2].reasoning_effort, "high");
  assert.deepEqual(f.finished().sort(), ["call-0", "call-1"], "completed tools were not replayed");
  await f.command("agent.model", { selection: first });
  await wait(() => f.received() === 4, "final-response selection reaches worker");
  f.releases[2]();
  await wait(() => !f.agents.active(f.scope), "execution completes without an invented continuation");
  assert.equal(f.requests.length, 3);
  assert.equal(f.agents.info(f.scope).run!.status, "completed", f.agents.info(f.scope).run!.error ?? "");
  assert.deepEqual(f.agents.info(f.scope).selection, first, "next selection stays persisted");
  assert.deepEqual(f.agents.info(f.scope).run!.selection, effort, "a menu-only final switch cannot claim a request happened");
  assert.equal(f.agents.hasIdle(f.scope), false, "changed worker cannot reenter the pool under its old profile");
  assert.equal(f.store.db.prepare("SELECT COUNT(*) AS n FROM runs WHERE sessionId=?").get(f.scope.sessionId)!.n, 1);
});

test("a changed catalog installs a new provider, proxy and model-copy mapping without changing the execution snapshot", { timeout: 60000 }, async t => {
  const f = await fixture(t);
  await f.command("prompt", { text: "Wait at a checkpoint." });
  await wait(() => f.releases.length === 1, "response starts");
  f.releases[0]();
  await wait(() => f.entered("call-0"), "tools start");
  const originalSnapshot = readdirSync(join(f.root, "execution-models")).find(name => !name.endsWith(".live.json"))!;
  const snapshotFile = join(f.root, "execution-models", originalSnapshot), snapshot = readFileSync(snapshotFile, "utf8");
  const updated = JSON.parse(JSON.stringify(f.models));
  const selection = { ...third, provider: "safe-new", id: "new-copy" };
  updated.providers[selection.provider] = { ...updated.providers[third.provider],
    baseUrl: updated.providers[third.provider].baseUrl.replace("/v1", "/v2"),
    models: [{ ...updated.providers[third.provider].models[0], id: selection.id,
      axiomRequestModelId: "upstream-new", headers: { "x-fixture-model": "fresh-definition" } }] };
  writeFileSync(join(f.pi, "models.json"), JSON.stringify(updated));
  const auth = JSON.parse(readFileSync(join(f.pi, "auth.json"), "utf8"));
  auth[selection.provider] = { type: "api_key", key: "new-local-fixture-key" };
  writeFileSync(join(f.pi, "auth.json"), JSON.stringify(auth));
  await f.command("agent.model", { selection });
  await wait(() => f.received() === 1, "new provider choice received");
  assert.deepEqual(f.agents.info(f.scope).selection, selection);
  assert.deepEqual(f.agents.info(f.scope).run!.selection, first);
  f.releaseTool("call-0"); f.releaseTool("call-1");
  await wait(() => f.releases.length === 2 || !f.agents.active(f.scope), () => JSON.stringify(f.agents.info(f.scope).run));
  assert.equal(f.releases.length, 2);
  assert.equal(f.requests[1].model, "upstream-new");
  assert.equal(f.requestPaths[1], "/v2/chat/completions");
  assert.equal(f.requestHeaders[1]["x-fixture-model"], "fresh-definition");
  assert.equal(f.requestHeaders[1].authorization, "Bearer new-local-fixture-key");
  assert.ok(f.proxyRequests.length > 0);
  assert.equal(readFileSync(snapshotFile, "utf8"), snapshot, "immutable launch snapshot was not overwritten");
  f.releases[1]();
  await wait(() => !f.agents.active(f.scope), "new provider run settles");
  assert.equal(f.agents.info(f.scope).run!.status, "completed");
  assert.deepEqual(f.agents.info(f.scope).run!.selection, selection);
  assert.equal(f.requests.length, 2);
  assert.equal(f.agents.hasIdle(f.scope), false);
  assert.deepEqual(readdirSync(join(f.root, "execution-models")).filter(name => name.endsWith(".live.json")), [], "private configuration is deleted on physical close");
});

test("image capability never rejects a switch; a target error comes from the real request", { timeout: 60000 }, async t => {
  const f = await fixture(t);
  f.failures.set(third.id, "fixture target rejects image context");
  await f.command("prompt", { text: "Inspect this image and run both checkpoints.", images: [{ id: "img1", name: "pixel.png", mimeType: "image/png", data: png }] });
  await wait(() => f.releases.length === 1, "image request starts");
  f.releases[0]();
  await wait(() => f.entered("call-0"), "tool batch starts");
  await f.command("agent.model", { selection: third });
  await wait(() => f.received() === 1, "incompatible target reaches worker");
  f.releaseTool("call-0"); f.releaseTool("call-1");
  await wait(() => !f.agents.active(f.scope), "real target request fails");
  const run = f.agents.info(f.scope).run!;
  assert.equal(run.status, "failed", JSON.stringify(run));
  assert.notEqual(run.reasonCode, "MODEL_SWITCH_FAILED");
  assert.match(run.error!, /fixture target rejects image context/);
  assert.deepEqual(f.requests.map(body => body.model), [first.id, third.id], "the selected target, never the old model, receives the continuation");
  assert.deepEqual(run.selection, third);
  assert.deepEqual(f.agents.info(f.scope).selection, third);
  assert.ok(f.events.some((event: any) => event.type === "model-applied" && event.selection.id === third.id));
  assert.deepEqual(f.finished().sort(), ["call-0", "call-1"]);
  assert.equal(f.agents.hasIdle(f.scope), false);
});

test("confirmed revocation stops a pending target before any new-provider request", { timeout: 60000 }, async t => {
  const f = await fixture(t);
  await f.command("prompt", { text: "Run checkpoint tools." });
  await wait(() => f.releases.length === 1, "response starts");
  f.releases[0]();
  await wait(() => f.entered("call-0"), "tool starts");
  await f.command("agent.model", { selection: third });
  await wait(() => f.received() === 1, "target received while tools are blocked");
  await f.agents.stopProviders([third.provider], true);
  assert.equal(f.agents.active(f.scope), false);
  const run = f.agents.info(f.scope).run!;
  assert.equal(run.status, "cancelled");
  assert.equal(run.reasonCode, "PROVIDER_STOPPED");
  assert.equal(f.requests.length, 1);
  assert.equal(f.proxyRequests.length, 0);
  assert.equal(f.agents.hasIdle(f.scope), false);
});

test("a smaller context window is accepted and full context reaches the real target request", { timeout: 60000 }, async t => {
  const f = await fixture(t, { smallTarget: true });
  const text = ("Preserve this context. " + "evidence ".repeat(900)).trim();
  await f.command("prompt", { text });
  await wait(() => f.releases.length === 1, "large-context request starts");
  f.releases[0]();
  await wait(() => f.entered("call-0"), "tool batch starts");
  await f.command("agent.model", { selection: second });
  await wait(() => f.received() === 1, "small-window selection reaches worker");
  f.releaseTool("call-0"); f.releaseTool("call-1");
  await wait(() => f.releases.length === 2 || !f.agents.active(f.scope), () => JSON.stringify(f.agents.info(f.scope).run));
  assert.equal(f.releases.length, 2, "small-window target is called instead of being rejected at the safe point");
  assert.equal(f.requests[1].model, second.id);
  const users = (body: any) => body.messages.filter((message: any) => message.role === "user");
  assert.deepEqual(users(f.requests[1]), users(f.requests[0]), "all original user blocks reach the target unchanged");
  assert.ok(users(f.requests[1]).some((message: any) => (typeof message.content === "string" ? message.content
    : message.content.filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n")).includes(text)), "full context is sent without truncation");
  f.releases[1]();
  await wait(() => !f.agents.active(f.scope), "small-window target settles");
  const run = f.agents.info(f.scope).run!;
  assert.equal(run.status, "completed", run.error ?? "");
  assert.deepEqual(run.selection, second);
  assert.deepEqual(f.agents.info(f.scope).selection, second);
  assert.equal(f.requests.length, 2, "no switch-only summary request");
  const file = String(f.store.db.prepare("SELECT file FROM agent_sessions WHERE sessionId=?").get(f.scope.sessionId)!.file);
  assert.ok(readFileSync(file, "utf8").includes(text), "original context remains persisted");
  assert.equal(f.agents.hasIdle(f.scope), false);
});

test("missing authentication and unsupported thinking are accepted; only the real request fails", { timeout: 60000 }, async t => {
  const f = await fixture(t);
  const auth = JSON.parse(readFileSync(join(f.pi, "auth.json"), "utf8"));
  delete auth[third.provider];
  writeFileSync(join(f.pi, "auth.json"), JSON.stringify(auth));
  f.models.providers[third.provider].models[0].reasoning = false;
  writeFileSync(join(f.pi, "models.json"), JSON.stringify(f.models));
  await f.command("prompt", { text: "Run both checkpoint tools." });
  await wait(() => f.releases.length === 1, "first response starts");
  f.releases[0]();
  await wait(() => f.entered("call-0"), "tool batch starts");
  const selection: Selection = { ...third, thinking: "xhigh" };
  await f.command("agent.model", { selection });
  await wait(() => f.received() === 1, "unauthenticated choice received");
  assert.deepEqual(f.agents.info(f.scope).selection, selection);
  assert.equal(f.agents.info(f.scope).run!.status, "running", "no switch-time failure or abort");
  assert.equal(f.requests.length, 1);
  f.releaseTool("call-0"); f.releaseTool("call-1");
  await wait(() => !f.agents.active(f.scope), "real request reports missing auth");
  const run = f.agents.info(f.scope).run!;
  assert.equal(run.status, "failed", JSON.stringify(run));
  assert.notEqual(run.reasonCode, "MODEL_SWITCH_FAILED");
  assert.match(run.error!, /Provider is not configured: safe-proxy/);
  assert.ok(f.events.some((event: any) => event.type === "model-applied" && JSON.stringify(event.selection) === JSON.stringify(selection)), "exact thinking choice is applied without clamping");
  assert.deepEqual(f.agents.info(f.scope).selection, selection);
  assert.equal(f.requests.length, 1, "no old-model fallback or switch-only probe");
  assert.deepEqual(f.finished().sort(), ["call-0", "call-1"]);
});

test("a final-response choice succeeds even with a broken configuration and no target definition", { timeout: 60000 }, async t => {
  const f = await fixture(t);
  await f.command("prompt", { text: "Run both checkpoint tools." });
  await wait(() => f.releases.length === 1, "first response starts");
  f.releases[0]();
  await wait(() => f.entered("call-0"), "tool batch starts");
  f.releaseTool("call-0"); f.releaseTool("call-1");
  await wait(() => f.releases.length === 2, "final response starts");
  writeFileSync(join(f.pi, "models.json"), '{"providers":{broken secret-canary');
  const selection = { ...second, provider: "missing-provider", id: "missing-model" };
  await f.command("agent.model", { selection });
  await wait(() => f.received() === 1, "choice with broken config received");
  f.releases[1]();
  await wait(() => !f.agents.active(f.scope), "final response completes normally");
  const run = f.agents.info(f.scope).run!;
  assert.equal(run.status, "completed", run.error ?? "");
  assert.deepEqual(f.agents.info(f.scope).selection, selection);
  assert.deepEqual(run.selection, first, "unissued target request is not called actual");
  assert.ok(f.events.some((event: any) => event.type === "model-applied" && event.selection.id === selection.id));
  assert.equal(f.requests.length, 2, "no probe, fallback, or invented continuation");
  assert.ok(!JSON.stringify(f.events).includes("secret-canary"), "configuration errors never leak raw secrets");
});

test("same-selection configuration edits reload endpoint and copy IDs, including a later provider switch", { timeout: 60000 }, async t => {
  const f = await fixture(t);
  await f.command("prompt", { text: "Run both checkpoint tools." });
  await wait(() => f.releases.length === 1, "first response starts");
  f.releases[0]();
  await wait(() => f.entered("call-0"), "tool batch starts");
  const updated = JSON.parse(JSON.stringify(f.models));
  updated.providers[first.provider].baseUrl = updated.providers[first.provider].baseUrl.replace("/v1", "/v3");
  updated.providers[first.provider].models[0].axiomRequestModelId = "updated-first";
  updated.providers[third.provider].models[0].axiomRequestModelId = "updated-third";
  writeFileSync(join(f.pi, "models.json"), JSON.stringify(updated));
  await f.command("agent.model", { selection: first });
  await wait(() => f.received() === 1, "same selection with new config received");
  f.releaseTool("call-0"); f.releaseTool("call-1");
  await wait(() => f.releases.length === 2 || !f.agents.active(f.scope), () => JSON.stringify(f.agents.info(f.scope).run));
  assert.equal(f.releases.length, 2);
  assert.equal(f.requests[1].model, "updated-first");
  assert.equal(f.requestPaths[1], "/v3/chat/completions");
  await f.command("agent.model", { selection: third });
  await f.command("prompt", { text: "One more check." });
  await wait(() => f.received() === 2, "next provider received");
  f.releases[1]();
  await wait(() => f.releases.length === 3 || !f.agents.active(f.scope), () => JSON.stringify(f.agents.info(f.scope).run));
  assert.equal(f.releases.length, 3);
  assert.equal(f.requests[2].model, "updated-third", "provider not selected during initial refresh must also see the new configuration");
  f.releases[2]();
  await wait(() => !f.agents.active(f.scope), "updated configuration settles");
  assert.equal(f.agents.info(f.scope).run!.status, "completed");
  assert.equal(f.requests.length, 3);
  assert.equal(f.agents.hasIdle(f.scope), false, "same-selection config changes retire the old profile too");
});

test("availability refresh diagnostics cannot veto a configured target's real request", { timeout: 60000 }, async t => {
  const f = await fixture(t, { availabilityFailure: true });
  await f.command("prompt", { text: "Run both checkpoint tools." });
  await wait(() => f.releases.length === 1, "initial response starts");
  f.releases[0]();
  await wait(() => f.entered("call-0"), "availability fixture installed inside tool boundary");
  await f.command("agent.model", { selection: third });
  await wait(() => f.received() === 1, "choice reaches worker");
  f.releaseTool("call-0"); f.releaseTool("call-1");
  await wait(() => f.releases.length === 2 || !f.agents.active(f.scope), () => JSON.stringify(f.agents.info(f.scope).run));
  assert.deepEqual(JSON.parse(readFileSync(join(f.root, "availability"), "utf8")), {
    error: "Availability refresh: fixture availability-only failure", modelExists: true,
  }, "the SDK has an availability diagnostic but still has a usable target definition");
  assert.equal(f.releases.length, 2, "availability metadata must not prevent the actual configured request");
  assert.deepEqual(f.requests.map(body => body.model), [first.id, third.id]);
  assert.equal(f.requestHeaders[1].authorization, "Bearer local-fixture-only");
  assert.equal(f.requests[1].messages.filter((message: any) => message.role === "tool").length, 2);
  f.releases[1]();
  await wait(() => !f.agents.active(f.scope), "target completes despite availability metadata failure");
  assert.equal(f.agents.info(f.scope).run!.status, "completed");
  assert.deepEqual(f.agents.info(f.scope).run!.selection, third);
  assert.equal(f.requests.length, 2, "there is no availability probe or fallback request");
});

test("an invalid builtin-provider overlay never falls back to its default endpoint", { timeout: 60000 }, async t => {
  const f = await fixture(t);
  await f.command("prompt", { text: "Run both checkpoint tools." });
  await wait(() => f.releases.length === 1, "initial request starts");
  f.releases[0]();
  await wait(() => f.entered("call-0"), "tool boundary starts");
  (f.models.providers as Record<string, unknown>).openai = {
    api: 123, baseUrl: "http://must-not-fallback.invalid/v1",
    // Any accidental builtin request is trapped by the local proxy fixture,
    // whose CONNECT allowlist never forwards external hosts.
    axiomProxy: f.models.providers[third.provider].axiomProxy,
    models: [{ id: "gpt-4.1" }],
  };
  writeFileSync(join(f.pi, "models.json"), JSON.stringify(f.models));
  await f.command("agent.model", { selection: { provider: "openai", id: "gpt-4.1", thinking: "off" } });
  await wait(() => f.received() === 1, "invalid choice is accepted as intent");
  f.releaseTool("call-0"); f.releaseTool("call-1");
  await wait(() => !f.agents.active(f.scope), "invalid target fails its own request");
  assert.equal(f.agents.info(f.scope).run?.status, "failed");
  assert.equal(f.requests.length, 1);
  assert.equal(f.proxyRequests.length, 0, "no builtin endpoint receives credentials or history");
});

test("a second choice during invalid configuration cannot revive a previously loaded endpoint", { timeout: 60000 }, async t => {
  const f = await fixture(t, { holdSelection: true });
  await f.command("prompt", { text: "Run both checkpoint tools." });
  await wait(() => f.releases.length === 1, "initial request starts");
  f.releases[0]();
  await wait(() => f.entered("call-0"), "tool boundary starts");
  (f.models.providers[first.provider] as unknown as { api: number }).api = 123;
  writeFileSync(join(f.pi, "models.json"), JSON.stringify(f.models));
  await f.command("agent.model", { selection: second });
  f.releaseTool("call-0"); f.releaseTool("call-1");
  await wait(() => existsSync(join(f.root, "selection-boundary")), "first invalid choice is being applied");
  await f.command("agent.model", { selection: { ...second, thinking: "high" } });
  await wait(() => f.received() === 2, "second choice arrives before first application completes");
  writeFileSync(join(f.root, "release-selection"), "go");
  await wait(() => !f.agents.active(f.scope), "invalid choices settle locally");
  assert.equal(f.agents.info(f.scope).run?.status, "failed");
  assert.equal(f.requests.length, 1, "the stale runtime must not send either target request");
});

test("the explicit host thinking choice wins extension defaults in both requests and transcript recovery", { timeout: 60000 }, async t => {
  const f = await fixture(t, { extensionThinking: true });
  const selection: Selection = { ...second, thinking: "high" };
  await f.command("prompt", { text: "Run both checkpoint tools." });
  await wait(() => f.releases.length === 1, "initial response starts");
  f.releases[0]();
  await wait(() => f.entered("call-0"), "tool batch starts");
  await f.command("agent.model", { selection });
  await wait(() => f.received() === 1, "choice reaches worker");
  f.releaseTool("call-0"); f.releaseTool("call-1");
  await wait(() => f.releases.length === 2 || !f.agents.active(f.scope), () => JSON.stringify(f.agents.info(f.scope).run));
  assert.equal(readFileSync(join(f.root, "extension-thinking"), "utf8"), "off", "extension really changed and persisted its own default");
  assert.equal(f.releases.length, 2);
  assert.deepEqual(f.requests.map(body => [body.model, body.reasoning_effort]), [[first.id, "high"], [second.id, "high"]]);
  f.releases[1]();
  await wait(() => !f.agents.active(f.scope), "execution settles");
  assert.equal(f.agents.info(f.scope).run!.status, "completed");
  const file = String(f.store.db.prepare("SELECT file FROM agent_sessions WHERE sessionId=?").get(f.scope.sessionId)!.file);
  const recovered = openTranscript(file, f.cwd, { readOnly: true });
  for (const context of [recovered.buildSessionProjection(), recovered.buildSessionContext()]) {
    assert.deepEqual(context.model, { provider: selection.provider, modelId: selection.id });
    assert.equal(context.thinkingLevel, selection.thinking, "reopening cannot restore the extension's overridden default");
  }
  assert.deepEqual(f.agents.info(f.scope).run!.selection, selection);
  assert.equal(f.requests.length, 2);
});

test("a pending switch back to the current selection is a no-op and keeps a clean worker reusable", { timeout: 60000 }, async t => {
  const f = await fixture(t);
  await f.command("prompt", { text: "Run both tools once." });
  await wait(() => f.releases.length === 1, "initial request starts");
  f.releases[0]();
  await wait(() => f.entered("call-0"), "tool starts");
  await f.command("agent.model", { selection: second });
  await f.command("agent.model", { selection: first });
  await wait(() => f.received() === 2, "both choices received");
  f.releaseTool("call-0"); f.releaseTool("call-1");
  await wait(() => f.releases.length === 2, "same-model tool continuation starts");
  assert.deepEqual(f.requests.map(body => body.model), [first.id, first.id]);
  assert.ok(!f.events.some((event: any) => event.type === "model-applied" && event.selection.id === second.id));
  f.releases[1]();
  await wait(() => !f.agents.active(f.scope) && f.agents.hasIdle(f.scope), "unchanged clean worker returns to pool");
  assert.equal(f.agents.info(f.scope).run!.status, "completed");
  assert.equal(f.requests.length, 2);
});
