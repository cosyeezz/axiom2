import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { deflateSync, crc32 } from "node:zlib";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { Store } from "../src/server/storage.js";
import { TaskRecords } from "../src/server/tasks/records.js";
import { TaskDelivery } from "../src/server/tasks/delivery.js";
import { TaskScheduler } from "../src/server/tasks/scheduler.js";

async function wait(check: () => boolean, label: string | (() => string) = "worker barrier") {
  const end = Date.now() + 15000;
  while (!check()) { assert.ok(Date.now() < end, typeof label === "function" ? label() : label); await new Promise(r => setTimeout(r, 10)); }
}
async function fixture(inject = false, partial = false) {
  const root = mkdtempSync(join(tmpdir(), "axiom-worker-fixes-")), cwd = join(root, "project"), pi = join(root, "pi");
  mkdirSync(cwd); mkdirSync(pi);
  const bodies: any[] = [], events: any[] = [], releases: ((tool?: { name: string; args: unknown }) => void)[] = [];
  const provider = createServer(async (req, res) => {
    let raw = ""; for await (const data of req) raw += data;
    bodies.push(JSON.parse(raw)); res.writeHead(200, { "Content-Type": "text/event-stream" }); res.flushHeaders();
    if (partial) res.write(`data: ${JSON.stringify({ id: randomUUID(), object: "chat.completion.chunk", model: "fixture", choices: [{ index: 0, delta: { role: "assistant", content: "Saved evidence before boundary." }, finish_reason: null }] })}\n\n`);
    releases.push(tool => {
      const chunk = (delta: unknown, finish_reason: string | null = null) => res.write(`data: ${JSON.stringify({ id: randomUUID(), object: "chat.completion.chunk", model: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
      if (tool) { chunk({ role: "assistant", tool_calls: [{ index: 0, id: randomUUID(), type: "function", function: { name: tool.name, arguments: JSON.stringify(tool.args) } }] }); chunk({}, "tool_calls"); }
      else { chunk({ role: "assistant", content: "Evidence preserved." }); chunk({}, "stop"); }
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>(resolve => provider.listen(0, "127.0.0.1", resolve));
  const modelsFile = join(pi, "models.json");
  writeFileSync(modelsFile, JSON.stringify({ providers: { fixture: { api: "openai-completions", baseUrl: `http://127.0.0.1:${(provider.address() as any).port}/v1`, models: [{ id: "fixture", input: ["text", "image"], contextWindow: 32000, maxTokens: 1000 }] } } }));
  writeFileSync(join(pi, "auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "loopback" } }));
  writeFileSync(join(pi, "settings.json"), JSON.stringify({ retry: { enabled: false }, compaction: { enabled: false } }));
  const manager = SessionManager.create(cwd, root);
  manager.appendMessage({ role: "user", content: "Bound isolated task", timestamp: 1 }); manager.appendCustomEntry("fixture", {});
  const worker = inject ? new URL("./worker-submission-fixture.ts", import.meta.url)
    : new URL(process.env.AXIOM_TEST_COMPILED ? "../dist/server/agent-worker.js" : "../src/server/agent-worker.ts", import.meta.url);
  const lease = { instanceId: randomUUID(), generation: 1, leaseId: randomUUID() };
  const child = fork(worker, [], { cwd, env: { ...process.env, AXIOM_PI_DIR: pi, AXIOM_EXECUTION_INSTANCE: lease.instanceId, AXIOM_EXECUTION_GENERATION: "1", AXIOM_EXECUTION_PROFILE: "fixture" }, execArgv: worker.pathname.endsWith(".ts") ? ["--import", import.meta.resolve("tsx")] : [], stdio: ["ignore", "ignore", "pipe", "ipc"] });
  let stderr = "", runId = "";
  child.stderr?.on("data", data => { stderr += data; }); child.on("message", event => events.push(event));
  const exit = once(child, "exit");
  const watchdog = setTimeout(() => child.kill(), 60000);
  const budget = (revision: number) => ({ workMs: 600000, deadlineAt: Date.now() + 600000, elapsedMs: 0, summaryDeadlineAt: null, revision });
  const send = (value: object) => child.send({ runId, ...value, lease });
  const start = async () => {
    runId = randomUUID();
    send({ type: "start", input: { root, cwd, modelsFile, file: manager.getSessionFile(), runId,
      selection: { provider: "fixture", id: "fixture", thinking: "off" }, prompt: "Inspect evidence.",
      task: { id: "isolated", role: "", inputIds: [], budget: budget(0) } } });
    await wait(() => bodies.length > 0, stderr);
  };
  const summarize = async (revision = 1) => {
    const count = bodies.length;
    send({ type: "summarize", ...budget(revision), deadlineAt: Date.now(), summaryDeadlineAt: Date.now() + 180000 });
    await wait(() => bodies.length > count, stderr); assert.deepEqual(bodies.at(-1).tools ?? [], []);
  };
  const append = (text: string, images: any[] = [], revision = 2) => {
    const id = randomUUID(); send({ type: "input", id, text, images, mode: "steer", budget: budget(revision) }); return id;
  };
  const barrier = async () => {
    const key = randomUUID(); send({ type: "recall", key, ids: [] });
    await wait(() => events.some(e => e.type === "recalled" && e.key === key), stderr);
  };
  return { root, cwd, get runId() { return runId; }, file: manager.getSessionFile()!, bodies, events, releases, send, start, summarize, append, barrier,
    done: () => events.filter(e => e.type === "done" && e.runId === runId),
    idle: () => wait(() => events.some(e => e.type === "idle" && e.runId === runId), stderr),
    close: async () => {
      clearTimeout(watchdog); if (child.exitCode === null) child.kill(); await exit;
      provider.closeAllConnections(); await new Promise<void>(resolve => provider.close(() => resolve()));
      rmSync(root, { recursive: true, force: true });
    } };
}
const brokenImage = { id: "imag1", name: "broken.png", mimeType: "image/png", data: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64") };
const png = (() => {
  const chunk = (name: string, data: Buffer) => {
    const type = Buffer.from(name), size = Buffer.alloc(4), crc = Buffer.alloc(4);
    size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([type, data])));
    return Buffer.concat([size, type, data, crc]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.from([0,255,0,0,255]))), chunk("IEND", Buffer.alloc(0))]).toString("base64");
})();
const validImage = { ...brokenImage, name: "pixel.png", data: png };

test("summary rejects undecodable images without tool restoration or a fictitious work turn", { timeout: 30000 }, async () => {
  const f = await fixture();
  try {
    await f.start(); await f.summarize();
    const id = f.append("BROKEN-IMAGE-MUST-NOT-RESUME", [brokenImage]);
    await wait(() => f.events.some(e => e.type === "input-error" && e.id === id));
    assert.equal(f.bodies.length, 2); assert.equal(f.events.some(e => e.type === "input-accepted" && e.id === id), false);
    f.releases[1](); await f.idle();
    assert.equal(f.bodies.length, 2); assert.equal(f.done().length, 1);
    assert.equal(f.done()[0].reasonCode, "BUDGET_SUMMARY");
  } finally { await f.close(); }
});

test("valid image restores one serialized work turn, and another deadline closes tools again", { timeout: 30000 }, async () => {
  const f = await fixture();
  try {
    await f.start(); await f.summarize();
    const id = f.append("VALID-IMAGE-REQUIREMENT", [validImage]);
    await wait(() => f.bodies.length === 3, () => JSON.stringify(f.events));
    assert.ok(f.events.some(e => e.type === "input-accepted" && e.id === id));
    assert.ok(f.bodies[2].tools.some((tool: any) => tool.function.name === "read"));
    assert.equal(JSON.stringify(f.bodies[2].messages).match(/VALID-IMAGE-REQUIREMENT/g)?.length, 1);
    assert.match(JSON.stringify(f.bodies[2].messages), /image_url/);
    assert.ok(JSON.stringify(f.bodies[2].messages).includes(png), "the prepared one-pixel image retains the expected content");
    assert.match(JSON.stringify(f.bodies[2].messages), /imag1/);
    await f.summarize(3); f.releases.at(-1)!(); await f.idle();
    assert.equal(f.done().length, 1); assert.equal(f.done()[0].reasonCode, "BUDGET_SUMMARY");
  } finally { await f.close(); }
});

test("summary image preparation can be recalled without treating its acknowledgement as resumed work", { timeout: 30000 }, async () => {
  const f = await fixture(true);
  let store: Store | undefined, delivery: TaskDelivery | undefined;
  try {
    await f.start(); await f.summarize();
    const preparing = randomUUID(); f.send({ type: "fixture-hold-images", id: preparing });
    const id = f.append("WITHDRAWN-IMAGE", [validImage]);
    await wait(() => f.events.some(e => e.type === "fixture-preparing-image" && e.id === preparing));
    assert.equal(f.bodies.length, 2, "decoding cannot interrupt summary or restore tools");
    store = new Store(join(f.root, "recall-store"));
    const workspace = store.execute({ op: "workspace.open", requestId: randomUUID(), params: { path: f.cwd, authorized: true } }) as any;
    const session = store.execute({ op: "session.create", requestId: randomUUID(), workspaceId: workspace.id }) as any;
    const records = new TaskRecords(store), selection = { provider: "fixture", id: "fixture", thinking: "off" as const };
    const taskId = records.create({ workspaceId: workspace.id, sessionId: session.id }, "image-recall", "context", [{ task: "inspect", role: "" }], selection).taskIds[0];
    const row = () => records.rows("WHERE id=?", taskId)[0];
    records.deliver(row(), records.inputs(row(), "queued").map(input => input.id));
    store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt) VALUES(?,?,'running',?,?)").run(f.runId, row().sessionId, JSON.stringify(selection), Date.now());
    store.db.prepare("UPDATE tasks SET runId=?,status='running' WHERE id=?").run(f.runId, taskId);
    records.queue(taskId, "WITHDRAWN-IMAGE", "steer", [validImage], id);
    store.db.prepare("UPDATE task_inputs SET runId=?,state='inflight' WHERE id=?").run(f.runId, id);
    records.receipt(id, "unknown", null, f.runId, taskId);
    const draft = { text: "WITHDRAWN-IMAGE [imag1]", attachment: null, attachments: [], images: [validImage] };
    records.drafts.set(id, draft);
    let recalls = 0;
    const agents = { store, publish: () => {}, thread: () => {}, setQueue: () => {}, recallIds: async (_scope: unknown, ids: string[]) => {
      recalls++; const key = randomUUID(); f.send({ type: "recall", key, ids });
      await wait(() => f.events.some(e => e.type === "recalled" && e.key === key));
      return f.events.find(e => e.type === "recalled" && e.key === key).ids;
    } } as any;
    delivery = new TaskDelivery(agents, records); delivery.pause();
    const scheduler = new TaskScheduler(agents, records, delivery); scheduler.kick = () => {};
    const restored = await scheduler.recall(row());
    assert.deepEqual(restored.ids, [id]); assert.deepEqual(restored.drafts, [draft]);
    assert.deepEqual((await scheduler.recall(row())).drafts, []); assert.equal(recalls, 1);
    assert.equal(records.drafts.has(id), false);
    assert.equal(store.db.prepare("SELECT state FROM task_input_receipts WHERE inputId=?").get(id)!.state, "cancelled");
    assert.ok(f.events.some(e => e.type === "input-accepted" && e.id === id));
    f.send({ type: "fixture-release", id: preparing });
    await wait(() => f.events.some(e => e.type === "fixture-image-prepared" && e.id === preparing));
    const again = randomUUID(); f.send({ type: "recall", key: again, ids: [id] });
    await wait(() => f.events.some(e => e.type === "recalled" && e.key === again));
    assert.deepEqual(f.events.find(e => e.type === "recalled" && e.key === again).ids, []);
    f.releases[1](); await f.idle();
    assert.equal(f.bodies.length, 2); assert.equal(f.done().length, 1);
    assert.equal(f.done()[0].reasonCode, "BUDGET_SUMMARY");
    await new Promise<void>(resolve => setImmediate(resolve));
  } finally { await delivery?.close(); store?.close(); await f.close(); }
});

test("a newer summary deadline supersedes preparation and unknown resume without opening tools", { timeout: 30000 }, async () => {
  const f = await fixture(true);
  try {
    await f.start(); await f.summarize();
    const id = f.append("UNKNOWN-SUBMISSION");
    await wait(() => f.events.some(e => e.type === "input-error" && e.id === id && e.uncertain));
    await f.summarize(3);
    assert.deepEqual(f.bodies.at(-1).tools ?? [], []);
    f.releases.at(-1)!(); await f.idle();
    assert.equal(f.done().length, 1); assert.equal(f.done()[0].reasonCode, "BUDGET_SUMMARY");
  } finally { await f.close(); }
});

for (const mode of ["REJECT-BEFORE", "THROW-AFTER", "UNKNOWN-SUBMISSION", "WAIT-REJECT"]) test(`SDK submission boundary: ${mode}`, { timeout: 30000 }, async () => {
  const f = await fixture(true);
  try {
    await f.start(); await f.summarize();
    const id = f.append(mode); let second: string | undefined;
    if (mode === "WAIT-REJECT") {
      await wait(() => f.events.some(e => e.type === "fixture-submitting" && e.id === id));
      second = f.append("SECOND-VALID-REQUIREMENT", [validImage], 3); await f.barrier();
      f.send({ type: "fixture-release", id });
    }
    if (mode === "REJECT-BEFORE") {
      await wait(() => f.done().length === 1, JSON.stringify(f.events));
      assert.equal(f.done()[0].status, "failed"); assert.equal(f.done()[0].reasonCode, "TASK_RESUME_FAILED");
      assert.equal(f.bodies.length, 2, "rejected submission cannot create an empty work request");
    } else {
      if (mode === "UNKNOWN-SUBMISSION") {
        await wait(() => f.events.some(e => e.type === "input-error" && e.id === id && e.uncertain));
        assert.equal(f.bodies.length, 2);
        f.append("LATER-SUCCESS-WAKES-RESUME", [], 3);
      }
      await wait(() => f.bodies.length === 3, () => JSON.stringify(f.events));
      assert.ok(f.bodies[2].tools.length > 0);
      const text = JSON.stringify(f.bodies[2].messages);
      if (mode === "THROW-AFTER") {
        assert.ok(f.events.some(e => e.type === "input-accepted" && e.id === id));
        assert.equal(text.match(/THROW-AFTER/g)?.length, 1);
      } else assert.doesNotMatch(text, /UNKNOWN-SUBMISSION|WAIT-REJECT/);
      f.releases[2](); await f.idle(); assert.equal(f.done().length, 1); assert.equal(f.done()[0].status, "completed");
      if (second) {
        assert.equal(f.events.filter(e => e.type === "input-error" && e.id === id).length, 1);
        assert.equal(f.events.filter(e => e.type === "input-accepted" && e.id === id).length, 0);
        assert.equal(f.events.filter(e => e.type === "input-accepted" && e.id === second).length, 1);
        assert.equal(f.events.filter(e => e.type === "delivered" && e.ids.includes(second)).length, 1);
      }
    }
  } finally { await f.close(); }
});

test("all rejected resume inputs preserve real partial output in exactly one immutable result", { timeout: 30000 }, async () => {
  const f = await fixture(true, true);
  let store: Store | undefined;
  try {
    await f.start();
    await wait(() => f.events.some(e => e.type === "message" && e.message.text?.includes("Saved evidence before boundary.")));
    await f.summarize();
    const first = f.append("WAIT-REJECT");
    await wait(() => f.events.some(e => e.type === "fixture-submitting" && e.id === first));
    const second = f.append("REJECT-BEFORE", [], 3); await f.barrier();
    f.send({ type: "fixture-release", id: first });
    await wait(() => f.done().length === 1);
    assert.equal(f.done()[0].status, "failed"); assert.equal(f.done()[0].reasonCode, "TASK_RESUME_FAILED");
    assert.equal(f.bodies.length, 2);
    for (const id of [first, second]) {
      const errors = f.events.filter(e => e.type === "input-error" && e.id === id);
      assert.equal(errors.length, 1); assert.notEqual(errors[0].uncertain, true);
      assert.equal(f.events.some(e => e.type === "input-accepted" && e.id === id), false);
    }
    store = new Store(join(f.root, "verification"));
    const workspace = store.execute({ op: "workspace.open", requestId: randomUUID(), params: { path: f.cwd, authorized: true } }) as any;
    const parent = store.execute({ op: "session.create", requestId: randomUUID(), workspaceId: workspace.id }) as any;
    const scope = { workspaceId: workspace.id, sessionId: parent.id }, records = new TaskRecords(store);
    const selection = { provider: "fixture", id: "fixture", thinking: "off" as const };
    const taskId = records.create(scope, "fixture", "fixture", [{ task: "verify partial", role: "" }], selection).taskIds[0];
    const child = records.rows("WHERE id=?", taskId)[0], endedAt = Date.now();
    const run = { id: f.done()[0].runId, sessionId: child.sessionId, status: "failed" as const, selection, startedAt: endedAt - 1000, endedAt, error: f.done()[0].error, reasonCode: "TASK_RESUME_FAILED" };
    store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt,endedAt) VALUES(?,?,'failed',?,?,?)").run(run.id, run.sessionId, JSON.stringify(selection), run.startedAt, endedAt);
    store.db.prepare("UPDATE tasks SET runId=?,status='running' WHERE id=?").run(run.id, taskId);
    store.db.prepare("UPDATE agent_sessions SET file=? WHERE sessionId=?").run(f.file, child.sessionId);
    const delivery = new TaskDelivery({ store } as any, records), current = records.rows("WHERE id=?", taskId)[0];
    delivery.save(current, run); delivery.save(current, run);
    const saved = store.db.prepare("SELECT body FROM task_results WHERE taskId=?").all(taskId);
    assert.equal(saved.length, 1);
    const result = JSON.parse(String(saved[0].body));
    assert.equal(result.status, "failed"); assert.equal(result.reportKind, "partial");
    assert.match(result.report, /Saved evidence before boundary/); assert.equal(result.budgetSummary, undefined);
  } finally { store?.close(); await f.close(); }
});

test("allowed platform shell can change synthetic source; parallel tasks isolate artifacts and ports", { timeout: 45000 }, async () => {
  const fixtures = await Promise.all([fixture(), fixture()]);
  try {
    await Promise.all(fixtures.map(async (f, index) => {
      writeFileSync(join(f.cwd, "synthetic-source.ts"), "original");
      writeFileSync(join(f.cwd, "verify.cjs"), `const fs=require('node:fs');fs.writeFileSync('synthetic-source.ts','changed-${index}');fs.mkdirSync('test-output',{recursive:true});fs.writeFileSync('test-output/result.txt','result-${index}');console.log('ISOLATED_TEST_PASSED');`);
      for (let attempt = 0; attempt < 2; attempt++) {
        const previous = f.bodies.length; await f.start(); await wait(() => f.bodies.length > previous);
        f.releases.at(-1)!({ name: process.platform === "win32" ? "powershell" : "bash", args: { command: "node verify.cjs", timeout: 10 } });
        await wait(() => f.bodies.length > previous + 1);
        assert.match(JSON.stringify(f.bodies.at(-1).messages), /ISOLATED_TEST_PASSED/);
        f.releases.at(-1)!(); await f.idle();
        assert.equal(readFileSync(join(f.cwd, "synthetic-source.ts"), "utf8"), `changed-${index}`);
        assert.equal(readFileSync(join(f.cwd, "test-output/result.txt"), "utf8"), `result-${index}`);
        assert.equal(f.done().length, 1);
      }
    }));
    assert.notEqual(fixtures[0].cwd, fixtures[1].cwd);
  } finally { await Promise.all(fixtures.map(f => f.close())); }
});
