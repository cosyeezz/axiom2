// Standalone: npm exec tsx tests/steering-ui.check.ts
// Real current-source page + isolated storage/configuration. Only execution,
// queue snapshots, recall receipts and file completion are mocked at the WS boundary.
// Every check gets a fresh page, so missing steering does not hide recall failures.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Locator, type Page, type WebSocketRoute } from "playwright";
import { startServer } from "../src/server/index.js";
import { SessionDrafts } from "../src/server/session-drafts.js";
import { agentScope, emptyAgent, messageScope, threadScope, type Selection } from "../src/shared/agent.js";
import { defaultBudgets, emptyTasks, tasksScope, type Task } from "../src/shared/tasks.js";
import type { Command, Draft, Scope, Session, Workspace } from "../src/shared/protocol.js";

const root = mkdtempSync(join(tmpdir(), "axiom-steering-ui-"));
const project = join(root, "workspace"), pi = join(root, "pi");
const artifacts = process.env.AXIOM_QUEUE_RECALL_ARTIFACTS ?? "/tmp/axiom-queue-recall-ui";
mkdirSync(project); mkdirSync(pi); mkdirSync(artifacts, { recursive: true });
const selection: Selection = { provider: "steering-fixture", id: "fixture", thinking: "off" };
writeFileSync(join(pi, "models.json"), JSON.stringify({ providers: {
  [selection.provider]: { api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1",
    models: [{ id: selection.id, name: "Steering Fixture", input: ["text"] }] },
} }));
writeFileSync(join(pi, "auth.json"), JSON.stringify({ [selection.provider]: { type: "api_key", key: "isolated-test-only" } }));
const previousPi = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = pi;
let app: Awaited<ReturnType<typeof startServer>> | undefined, browser: Browser | undefined;
let owner: Scope, other: Scope, child: Scope, task: Task;
const passed: string[] = [], failed: string[] = [];
type QueueItem = { id: string; text: string; mode: "steer" | "followUp" };
const initialQueue = (scope: Scope): QueueItem[] => [
  { id: `steer-${scope.sessionId}`, text: `queued-steer-${scope.sessionId}`, mode: "steer" },
  { id: `follow-${scope.sessionId}`, text: `queued-followUp-${scope.sessionId}`, mode: "followUp" },
];
const blank = (): Draft => ({ text: "", attachment: null, attachments: [], images: [], skills: [] });
const stops = (commands: Command[]) => commands.filter((c) => ["agent.stop", "task.cancel"].includes(c.op));
const sends = (commands: Command[]) => commands.filter((c) => /^(prompt|agent\.(prompt|continue)|task\.(append|followup))$/.test(c.op));
const recalls = (commands: Command[]) => commands.filter((c) => c.op === "agent.recall");
async function eventually(check: () => Promise<boolean> | boolean, message: string, timeout = 2500) {
  const deadline = Date.now() + timeout;
  do {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 25));
  } while (Date.now() < deadline);
  assert.fail(message);
}
async function getDraft(page: Page, scope: Scope): Promise<Draft> {
  return page.evaluate(async (target) => {
    const path = "/drafts.ts";
    return (await import(/* @vite-ignore */ path)).getDraft(target);
  }, scope);
}
async function setDraft(page: Page, scope: Scope, draft: Draft) {
  await page.evaluate(async ({ target, value }) => {
    const path = "/drafts.ts";
    (await import(/* @vite-ignore */ path)).updateDraft(target, value);
  }, { target: scope, value: draft });
}
async function doubleEscape(input: Locator) {
  await input.press("Escape");
  await input.press("Escape");
}

async function fixture(nested: boolean, touch = false) {
  const savedDrafts = new SessionDrafts(app!.store);
  for (const scope of [owner, other, child]) savedDrafts.save(scope, {
    revision: savedDrafts.read(scope).revision, writer: randomUUID(), sequence: 1, draft: blank(),
  });
  const page = await browser!.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce", hasTouch: touch });
  page.setDefaultTimeout(5000);
  const errors: string[] = [], commands: Command[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const scope = nested ? child : owner;
  const queues = new Map([owner, other, child].map((s) => [s.sessionId, initialQueue(s)]));
  const stopped = new Set<string>();
  let socket: WebSocketRoute | undefined, seq = 0;
  let holdPrompt = false, holdRecall = false, recalledDrafts: Draft[] = [];
  const pendingPrompt: (() => void)[] = [], pendingRecall: (() => void)[] = [];
  const info = (s: Scope) => ({
    ...emptyAgent, selection,
    run: { id: `run-${s.sessionId}`, sessionId: s.sessionId, status: stopped.has(s.sessionId) ? "cancelled" : "running", selection,
      startedAt: Date.now(), endedAt: null, error: null },
    ...(s.sessionId === child.sessionId ? { task: { id: task.id, parentSessionId: owner.sessionId, status: stopped.has(s.sessionId) ? "cancelled" : "running" } } : {}),
    queue: queues.get(s.sessionId) ?? [],
  });
  const mocked = new Map<string, () => unknown>();
  for (const s of [owner, other, child]) {
    mocked.set(agentScope(s), () => info(s));
    mocked.set(tasksScope(s), () => ({ ...emptyTasks, tasks: s.sessionId === owner.sessionId ? [{ ...task, status: stopped.size ? "cancelled" : "running" }] : [] }));
    mocked.set(threadScope(s), () => ({ ids: s.sessionId === owner.sessionId ? ["delegation"] : [], before: null }));
  }
  const delegation = { id: "delegation", role: "assistant", text: "运行中的委派测试",
    calls: [{ id: task.anchor, name: "delegate", input: "{}" }] };
  mocked.set(messageScope(owner, "delegation"), () => delegation);
  for (const s of [owner, other, child])
    mocked.set(`messages:${s.workspaceId}:${s.sessionId}`, () => s.sessionId === owner.sessionId ? [delegation] : []);
  const snapshot = (key: string) => socket!.send(JSON.stringify({ type: "snapshot", scope: key,
    streamId: "steering-ui-fixture", seq: ++seq, data: mocked.get(key)!() }));
  await page.addInitScript((value) => sessionStorage.setItem("view", JSON.stringify(value)), owner);
  await page.route("**/favicon.ico", (route) => route.fulfill({ status: 204 }));
  await page.routeWebSocket("**/ws", (route) => {
    socket = route;
    const server = route.connectToServer();
    const receipt = (command: Command, data: unknown = {}) => route.send(JSON.stringify({ type: "receipt", requestId: command.requestId, ok: true, data }));
    route.onMessage((raw) => {
      const command = JSON.parse(raw.toString()) as Command;
      commands.push(command);
      const key = String(command.params?.scope ?? "");
      if (["subscribe", "unsubscribe"].includes(command.op) && mocked.has(key)) {
        if (command.op === "subscribe") snapshot(key);
        receipt(command);
      } else if (sends([command]).length) {
        const respond = () => receipt(command, { accepted: true, inputId: command.requestId });
        if (holdPrompt) pendingPrompt.push(respond); else respond();
      } else if (command.op === "agent.recall") {
        // Capture receipt content at request time, just like a server response.
        const drafts = structuredClone(recalledDrafts);
        const inputId = command.params?.inputId as string | undefined;
        const ids = inputId === undefined ? (queues.get(command.sessionId!) ?? []).map(item => item.id) : drafts.length ? [inputId] : [];
        const respond = () => {
          queues.set(command.sessionId!, inputId === undefined ? [] : (queues.get(command.sessionId!) ?? []).filter(item => !ids.includes(item.id)));
          snapshot(agentScope({ workspaceId: command.workspaceId!, sessionId: command.sessionId! }));
          receipt(command, { drafts, ids });
        };
        if (holdRecall) pendingRecall.push(respond); else respond();
      } else if (stops([command]).length) {
        const target = command.op === "task.cancel" ? child : { workspaceId: command.workspaceId!, sessionId: command.sessionId! };
        stopped.add(target.sessionId);
        queues.set(target.sessionId, []);
        snapshot(agentScope(target));
        snapshot(tasksScope(owner));
        receipt(command);
      } else if (command.op === "agent.inputs") {
        receipt(command, (command.params!.ids as string[]).map(id => ({ id, consumed: false,
          active: !stopped.has(command.sessionId!), queued: false,
          receipt: { status: "committed", data: { inputId: id } } })));
      } else if (command.op === "files.complete") {
        receipt(command, { prefix: "@", items: [{ value: "@README.md", label: "README.md" }] });
      } else server.send(raw);
    });
    server.onMessage((raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type !== "snapshot" || !mocked.has(message.scope)) route.send(raw);
    });
  });
  try {
    await page.goto(app!.accessUrl);
    await page.locator('.connection-status[data-connected="true"]').waitFor();
    if (nested) {
      await page.locator(".tool-activity > summary").click();
      await page.getByRole("button", { name: `打开子会话：${task.description}`, exact: true }).click();
    }
    const input = page.locator(nested ? `#prompt-${child.sessionId}` : "#prompt");
    const composer = page.locator(".composer-area").filter({ has: input });
    await input.waitFor();
    await composer.getByRole("button", { name: "停止执行", exact: true }).waitFor();
    return { page, input, composer, scope, commands, errors,
      holdPrompt: () => { holdPrompt = true; },
      holdRecall: (drafts: Draft[] = []) => { holdRecall = true; recalledDrafts = drafts; },
      releasePrompt: () => { pendingPrompt.splice(0).forEach((done) => done()); },
      releaseRecall: () => { pendingRecall.splice(0).forEach((done) => done()); },
      setQueue: (value: QueueItem[]) => { queues.set(scope.sessionId, value); snapshot(agentScope(scope)); },
      consumeLastPrompt: () => {
        const sent = sends(commands).at(-1)!;
        const message = { id: `input-${sent.requestId}`, role: "user", text: sent.params?.text, inputIds: [sent.requestId] };
        const messages = scope.sessionId === owner.sessionId ? [delegation, message] : [message];
        const collection = `messages:${scope.workspaceId}:${scope.sessionId}`;
        mocked.set(collection, () => messages);
        mocked.set(threadScope(scope), () => ({ ids: messages.map((m) => m.id) }));
        queues.set(scope.sessionId, []); snapshot(agentScope(scope));
        snapshot(collection); snapshot(threadScope(scope));
      },
    };
  } catch (error) {
    await page.close();
    throw error;
  }
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function check(name: string, nested: boolean, run: (f: Fixture) => Promise<void>, touch = false) {
  let f: Fixture | undefined;
  try {
    f = await fixture(nested, touch);
    await run(f);
    assert.deepEqual(f.errors, [], "no browser exceptions");
    passed.push(name);
    console.log(`PASS ${name}`);
  } catch (e) {
    const message = `${name}: ${(e as Error).message}`;
    failed.push(message);
    console.error(`FAIL ${message}`);
  } finally {
    await f?.page.close();
  }
}

try {
  app = await startServer({ root: join(root, "data"), port: 0, dev: true });
  const workspace = app.store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: project, authorized: true } }) as Workspace;
  function seed(title: string): Scope {
    const session = app!.store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
    app!.store.execute({ requestId: randomUUID(), op: "session.rename", workspaceId: workspace.id, sessionId: session.id, params: { title } });
    app!.store.db.prepare("INSERT INTO agent_sessions(sessionId,selection) VALUES(?,?) ON CONFLICT(sessionId) DO UPDATE SET selection=excluded.selection")
      .run(session.id, JSON.stringify(selection));
    return { workspaceId: workspace.id, sessionId: session.id };
  }
  owner = seed("Steering A"); other = seed("Steering B"); child = seed("Steering child fixture");
  task = { id: "steering-task", workspaceId: workspace.id, parentSessionId: owner.sessionId,
    sessionId: child.sessionId, anchor: "delegate-call", title: "Steering 子会话", description: "Steering 子会话",
    status: "running", runId: `run-${child.sessionId}`, createdAt: Date.now(), budgets: defaultBudgets, results: [], error: null };
  browser = await chromium.launch({ headless: true, executablePath: process.env.AXIOM_TEST_BROWSER });

  for (const nested of [false, true]) {
    const label = nested ? "child" : "main";
    await check(`${label}: active Enter sends prompt(mode=steer), never stop`, nested, async (f) => {
      await f.input.fill(`${label} steering message`);
      await f.input.press("Enter");
      await eventually(() => sends(f.commands).length === 1, "Enter must send exactly one prompt while active");
      const sent = sends(f.commands)[0];
      assert.equal(sent.op, "prompt");
      assert.equal(sent.params?.mode, "steer");
      assert.equal(sent.params?.text, `${label} steering message`);
      assert.equal(sent.workspaceId, f.scope.workspaceId); assert.equal(sent.sessionId, f.scope.sessionId);
      assert.equal(stops(f.commands).length, 0);
      await eventually(async () => await f.input.inputValue() === "", "successful receipt clears only submitted draft");
      await eventually(async () => (await f.composer.locator(".steering-queue").innerText()).includes(`${label} steering message`), "steering stays in queue after acceptance");
      assert.equal(await f.page.locator(".user-text").filter({ hasText: `${label} steering message` }).count(), 0, "unconsumed steering is not a chat bubble");
      f.consumeLastPrompt();
      await eventually(async () => await f.page.locator(".user-text").filter({ hasText: `${label} steering message` }).count() === 1, "consumed steering enters chat exactly once");
      assert.ok(!(await f.composer.innerText()).includes(`${label} steering message`), "consumed input leaves queue");
    });
    for (const touch of [false, true]) await check(`${label}: ${touch ? "mobile tap" : "desktop click"} directly restores unknown steering without resending`, nested, async (f) => {
      if (touch) await f.page.setViewportSize({ width: 390, height: 844 });
      const attachment = { id: "img1", kind: "image" as const, name: "original.png", path: "/original.png", text: "" };
      const skill = { id: "recovery-fixture", name: "recovery-fixture", description: "保留技能引用" };
      await setDraft(f.page, f.scope, { text: "queued original [img1]", attachment: null, attachments: [attachment], skills: [skill] });
      await f.input.press("Enter");
      await eventually(() => sends(f.commands).length === 1, "initial steering sent once");
      await eventually(async () => await f.input.inputValue() === "", "submitted draft cleared");
      await f.input.fill("new typing");
      await f.composer.getByRole("button", { name: "停止执行", exact: true }).click({ force: true });
      await eventually(() => stops(f.commands).length === 1, "stop command issued once");
      await f.page.evaluate(async target => {
        const path = "/chat/reconcile-inputs.ts";
        await (await import(/* @vite-ignore */ path)).reconcileInputs(target);
      }, f.scope);
      await f.composer.getByText(/发送结果未确认，原文已保留/).waitFor();
      const recovery = f.composer.getByRole("button", { name: "恢复编辑", exact: true });
      const dialogsBeforeRecovery = await f.page.getByRole("dialog").count();
      if (touch) await recovery.tap(); else await recovery.click();
      assert.equal(await f.page.getByRole("dialog").count(), dialogsBeforeRecovery, "recovery does not open an additional confirmation dialog");
      await eventually(async () => await f.input.inputValue() === "queued original [img1]\n\nnew typing", "one action restores both drafts");
      const restored = await getDraft(f.page, f.scope);
      assert.deepEqual(restored.attachments, [attachment]);
      assert.deepEqual(restored.skills, [skill]);
      await eventually(async () => await f.input.evaluate(input => document.activeElement === input), "restored composer gets focus");
      assert.equal(await recovery.count(), 0, "recovered row removed exactly once");
      await f.composer.getByText(/原消息已恢复编辑，尚未发送/).waitFor();
      assert.equal(sends(f.commands).length, 1, "recovery never resends");
      assert.equal(recalls(f.commands).length, 0, "recovery does not pretend to recall unknown input");
      assert.equal(stops(f.commands).length, 1);
    }, touch);
    await check(`${label}: Shift+Enter, IME Enter and empty Enter do not submit`, nested, async (f) => {
      await f.input.fill("line"); await f.input.press("Shift+Enter");
      assert.equal(await f.input.inputValue(), "line\n");
      await f.input.dispatchEvent("compositionstart");
      await f.input.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true });
      await f.input.dispatchEvent("compositionend");
      await f.input.dispatchEvent("keydown", { key: "Enter", code: "Enter", keyCode: 229 });
      await f.input.fill("  \n"); await f.input.press("Enter");
      await f.input.fill(""); await f.input.press("Enter");
      await f.page.waitForTimeout(100);
      assert.equal(sends(f.commands).length, 0); assert.equal(stops(f.commands).length, 0);
    });
    await check(`${label}: no extra send/mode controls; queue text is actionable`, nested, async (f) => {
      assert.equal(await f.composer.locator("form").getByRole("button", { name: /发送追问|加入队列|添加队列|新建队列|排队发送|撤回|steer|follow.?up/i }).count(), 0);
      assert.equal(await f.composer.getByRole("button", { name: /^返回输入框编辑：/ }).count(), 2);
      assert.equal(await f.composer.locator(".append-button").count(), 0);
      assert.equal(await f.composer.getByRole("button", { name: "停止执行", exact: true }).count(), 1);
    });
    await check(`${label}: queue snapshots render and update in owning composer`, nested, async (f) => {
      for (const item of initialQueue(f.scope)) {
        await eventually(async () => (await f.composer.innerText()).includes(item.text), `queue must show ${item.mode} text`);
      }
      const replacement = `${label}-queue-updated`;
      f.setQueue([{ id: "updated", text: replacement, mode: "steer" }]);
      await eventually(async () => (await f.composer.innerText()).includes(replacement), "queue subscription update must render");
      assert.ok(!(await f.composer.innerText()).includes(initialQueue(f.scope)[0].text));
      f.setQueue([]);
      await eventually(async () => !(await f.composer.innerText()).includes(replacement), "empty queue removes stale entry");
      assert.equal(sends(f.commands).length + stops(f.commands).length, 0);
    });
    await check(`${label}: click recalls only selected row, preserves attachments and newer typing`, nested, async (f) => {
      const [keep, selected] = initialQueue(f.scope);
      const existing = { id: "file1", name: "new.txt", path: join(project, "new.txt"), kind: "file" as const, text: "" };
      const returned = { id: "file1", name: "old.txt", path: join(project, "old.txt"), kind: "file" as const, text: "" };
      await setDraft(f.page, f.scope, { ...blank(), text: "NEW [file1]", attachments: [existing] });
      f.holdRecall([{ ...blank(), text: `${selected.text} [file1]`, attachments: [returned] }]);
      await f.page.screenshot({ path: join(artifacts, `${label}-desktop-before.png`) });
      const row = f.composer.getByRole("button", { name: `返回输入框编辑：${selected.text}`, exact: true });
      await row.click();
      await eventually(() => recalls(f.commands).length === 1, "click must request single recall");
      assert.deepEqual(recalls(f.commands)[0].params, { inputId: selected.id });
      assert.equal(recalls(f.commands)[0].sessionId, f.scope.sessionId);
      assert.equal(await row.isDisabled(), true, "pending recall disables every queue action");
      await row.dispatchEvent("click");
      await f.input.press("End"); await f.input.pressSequentially(" LATER");
      await doubleEscape(f.input);
      assert.equal(recalls(f.commands).length, 1, "click and keyboard cannot duplicate in-flight recall");
      f.releaseRecall();
      await eventually(async () => await f.input.inputValue() === `${selected.text} [file2]\n\nNEW [file1] LATER`, "selected message merges with current typing");
      assert.deepEqual((await getDraft(f.page, f.scope)).attachments, [existing, { ...returned, id: "file2" }]);
      assert.equal(await f.input.evaluate(input => document.activeElement === input), true, "click focuses owning input");
      assert.equal(await f.composer.locator(".steering-queue-item").count(), 1);
      assert.ok((await f.composer.locator(".steering-queue").innerText()).includes(keep.text));
      assert.equal(sends(f.commands).length + stops(f.commands).length, 0, "recall never sends or stops");
      await f.page.screenshot({ path: join(artifacts, `${label}-desktop-after.png`) });
    });
    await check(`${label}: mobile queue tap returns content without horizontal overflow`, nested, async (f) => {
      await f.page.setViewportSize({ width: 390, height: 844 });
      const selected = initialQueue(f.scope)[0];
      f.holdRecall([{ ...blank(), text: selected.text }]);
      const row = f.composer.getByRole("button", { name: `返回输入框编辑：${selected.text}`, exact: true });
      assert.ok((await row.boundingBox())!.height >= 44, "touch target is at least 44px high");
      assert.equal(await f.composer.locator(".steering-queue").evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
      await f.page.screenshot({ path: join(artifacts, `${label}-mobile-before.png`) });
      await row.click(); f.releaseRecall();
      await eventually(async () => await f.input.inputValue() === selected.text, "mobile selected row restored");
      assert.equal(await f.input.evaluate(input => document.activeElement === input), true);
      assert.equal(await f.composer.locator(".steering-queue-item").count(), 1);
      await f.page.screenshot({ path: join(artifacts, `${label}-mobile-after.png`) });
    }, true);
    await check(`${label}: queue supports keyboard activation`, nested, async (f) => {
      const selected = initialQueue(f.scope)[0];
      f.holdRecall([{ ...blank(), text: selected.text }]);
      const row = f.composer.getByRole("button", { name: `返回输入框编辑：${selected.text}`, exact: true });
      await row.focus(); await row.press("Enter");
      await eventually(() => recalls(f.commands).length === 1, "keyboard activation recalls once");
      f.releaseRecall();
      await eventually(async () => await f.input.inputValue() === selected.text, "keyboard restores text");
      assert.equal(await f.input.evaluate(input => document.activeElement === input), true);
      assert.equal(sends(f.commands).length + stops(f.commands).length, 0);
    });
    await check(`${label}: accepted optimistic row recalls by receipt ID and disappears once`, nested, async (f) => {
      f.setQueue([]);
      await f.input.fill("accepted pending input"); await f.input.press("Enter");
      await eventually(() => sends(f.commands).length === 1, "steering submitted once");
      const row = f.composer.getByRole("button", { name: "返回输入框编辑：accepted pending input", exact: true });
      await eventually(async () => await row.count() === 1 && !(await row.isDisabled()), "accepted placeholder is actionable");
      f.holdRecall([{ ...blank(), text: "accepted pending input" }]);
      await row.click();
      await eventually(() => recalls(f.commands).length === 1, "accepted placeholder requests recall");
      assert.deepEqual(recalls(f.commands)[0].params, { inputId: sends(f.commands)[0].requestId });
      f.releaseRecall();
      await eventually(async () => await f.input.inputValue() === "accepted pending input", "receipt restores pending message");
      assert.equal(await f.composer.locator(".steering-queue-item").count(), 0);
      assert.equal(sends(f.commands).length, 1, "recall does not resend");
    });
    await check(`${label}: consumed row cannot restore a stale local copy`, nested, async (f) => {
      const selected = initialQueue(f.scope)[0];
      await f.input.fill("keep draft"); f.holdRecall([]);
      await f.composer.getByRole("button", { name: `返回输入框编辑：${selected.text}`, exact: true }).click();
      await eventually(() => recalls(f.commands).length === 1, "recall requested before consumption");
      f.setQueue([initialQueue(f.scope)[1]]); f.releaseRecall();
      await f.composer.getByRole("status").filter({ hasText: "没有可撤回" }).waitFor();
      assert.equal(await f.input.inputValue(), "keep draft");
      assert.equal(await f.composer.locator(".steering-queue-item").count(), 1);
      assert.equal(sends(f.commands).length + stops(f.commands).length, 0);
    });
    await check(`${label}: single/expired Esc inert, double Esc once, pending deduplicated`, nested, async (f) => {
      f.holdRecall();
      await f.input.fill("retain this draft");
      await f.input.press("Escape"); await f.page.waitForTimeout(600);
      assert.equal(recalls(f.commands).length, 0, "one Esc never recalls");
      await f.input.press("Escape"); await f.page.waitForTimeout(100);
      assert.equal(recalls(f.commands).length, 0, "Esc more than 500ms apart never recalls");
      await f.page.waitForTimeout(600);
      await doubleEscape(f.input);
      await eventually(() => recalls(f.commands).length === 1, "double Esc must issue agent.recall");
      await f.input.press("Escape");
      if (nested) assert.equal(await f.page.getByRole("dialog", { name: "子代理会话", exact: true }).isVisible(), true,
        "Escape in busy child composer must not dismiss its dialog while recall is pending");
      await f.input.press("Escape");
      assert.equal(recalls(f.commands).length, 1, "pending recall must not duplicate");
      const request = recalls(f.commands)[0];
      assert.deepEqual(request.params, {});
      assert.equal(request.workspaceId, f.scope.workspaceId); assert.equal(request.sessionId, f.scope.sessionId);
      assert.equal(stops(f.commands).length + sends(f.commands).length, 0);
      f.releaseRecall();
      await f.page.waitForTimeout(100);
      assert.equal(await f.input.inputValue(), "retain this draft", "empty recall preserves draft");
      if (nested) assert.equal(await f.page.getByRole("dialog", { name: "子代理会话", exact: true }).isVisible(), true);
    });
    await check(`${label}: empty queue still asks server and explains nothing can be recalled`, nested, async (f) => {
      f.setQueue([]); f.holdRecall();
      await f.input.fill("keep this input");
      await f.composer.getByRole("button", { name: "停止执行", exact: true }).hover({ force: true });
      await f.page.getByRole("tooltip").waitFor();
      await doubleEscape(f.input);
      await eventually(() => recalls(f.commands).length === 1, "empty queue snapshot cannot suppress authoritative recall command");
      f.releaseRecall();
      await f.composer.getByRole("status").filter({ hasText: "没有可撤回" }).waitFor();
      assert.equal(await f.input.inputValue(), "keep this input");
      assert.equal(sends(f.commands).length + stops(f.commands).length, 0);
    });
    await check(`${label}: IME and held Escape cannot recall`, nested, async (f) => {
      f.holdRecall();
      await f.input.focus();
      await f.input.dispatchEvent("compositionstart");
      for (let i = 0; i < 2; i++) await f.input.dispatchEvent("keydown", { key: "Escape", code: "Escape", isComposing: true });
      await f.input.dispatchEvent("compositionend");
      for (let i = 0; i < 2; i++) await f.input.dispatchEvent("keydown", { key: "Escape", code: "Escape", keyCode: 229 });
      await f.input.press("Escape");
      for (let i = 0; i < 3; i++) await f.input.dispatchEvent("keydown", { key: "Escape", code: "Escape", repeat: true });
      await f.page.waitForTimeout(100);
      assert.equal(recalls(f.commands).length, 0);
      assert.equal(stops(f.commands).length, 0);
    });
    await check(`${label}: file completion consumes Escape before recall`, nested, async (f) => {
      f.holdRecall();
      await f.input.fill("@");
      await f.page.getByRole("listbox", { name: "pi 文件选择" }).waitFor();
      await f.composer.getByRole("button", { name: "停止执行", exact: true }).hover({ force: true });
      await f.page.getByRole("tooltip").waitFor();
      await f.input.press("Escape");
      await f.page.getByRole("listbox", { name: "pi 文件选择" }).waitFor({ state: "detached" });
      await f.input.press("Escape");
      await f.page.waitForTimeout(100);
      assert.equal(recalls(f.commands).length, 0, "closing completion cannot count as first recall Esc");
      await f.page.waitForTimeout(600);
      await doubleEscape(f.input);
      await eventually(() => recalls(f.commands).length === 1, "recall still works after completion closes");
    });
    await check(`${label}: recall merges text, renumbers attachments, preserves in-flight typing`, nested, async (f) => {
      const existing: Draft = { ...blank(), text: "NEW [file1] [imag1] [folder1]", attachments: [
        { id: "file1", name: "new.txt", path: join(project, "new.txt"), kind: "file", text: "" },
        { id: "imag1", name: "new.png", path: join(project, "new.png"), kind: "image", text: "" },
        { id: "folder1", name: "new-dir", path: join(project, "new-dir"), kind: "folder", text: "" },
      ] };
      const returned: Draft[] = [
        { ...blank(), text: "OLD-A [file1] [imag1] [folder1] repeated [file1]", attachments: [
          { id: "file1", name: "old.txt", path: join(project, "old.txt"), kind: "file", text: "" },
          { id: "imag1", name: "old.png", path: join(project, "old.png"), kind: "image", text: "" },
          { id: "folder1", name: "old-dir", path: join(project, "old-dir"), kind: "folder", text: "" },
        ] },
        { ...blank(), text: "OLD-B [file1]", attachments: [
          { id: "file1", name: "last.txt", path: join(project, "last.txt"), kind: "file", text: "" },
        ] },
      ];
      await setDraft(f.page, f.scope, existing);
      f.holdRecall(returned);
      await doubleEscape(f.input);
      await eventually(() => recalls(f.commands).length === 1, "double Esc must request recall before merge");
      await f.input.press("End"); await f.input.pressSequentially(" TYPED-WHILE-WAITING");
      f.releaseRecall();
      await eventually(async () => (await getDraft(f.page, f.scope)).text.includes("OLD-B"), "receipt restores every queued draft");
      const merged = await getDraft(f.page, f.scope);
      assert.ok(merged.text.includes("NEW [file1] [imag1] [folder1] TYPED-WHILE-WAITING"));
      assert.ok(merged.text.includes("OLD-A [file2] [imag2] [folder2] repeated [file2]"));
      assert.ok(merged.text.includes("OLD-B [file3]"));
      assert.ok(merged.text.indexOf("OLD-A") < merged.text.indexOf("OLD-B"), "returned drafts retain queue order");
      assert.ok(merged.text.indexOf("OLD-B") < merged.text.indexOf("NEW"), "recalled queue is restored before current input");
      const expected = [...existing.attachments!, ...returned[0].attachments!.map((a, i) => ({ ...a, id: ["file2", "imag2", "folder2"][i] })),
        { ...returned[1].attachments![0], id: "file3" }];
      assert.deepEqual(merged.attachments, expected);
      assert.equal(new Set(merged.attachments!.map((a) => a.id)).size, 7);
      assert.equal(await f.composer.locator(".attachment-chip").count(), 7);
      assert.equal(sends(f.commands).length + stops(f.commands).length, 0);
    });
    await check(`${label}: late recall belongs to captured session`, nested, async (f) => {
      await f.input.fill("original draft");
      f.holdRecall([{ ...blank(), text: "late recalled text", attachments: [
        { id: "file1", name: "late.txt", path: join(project, "late.txt"), kind: "file", text: "" },
      ] }]);
      await f.composer.getByRole("button", { name: `返回输入框编辑：${initialQueue(f.scope)[0].text}`, exact: true }).click();
      await eventually(() => recalls(f.commands).length === 1, "clicked recall must be pending before navigation");
      if (nested) await f.page.getByRole("button", { name: "关闭子代理会话，返回主对话", exact: true }).click();
      await f.page.locator("#history .history-item").filter({ hasText: "Steering B" }).click();
      await f.page.waitForFunction(id => JSON.parse(sessionStorage.getItem("view") || "null")?.sessionId === id, other.sessionId);
      await f.page.locator("#prompt").fill("B stays untouched");
      f.releaseRecall();
      await eventually(async () => (await getDraft(f.page, f.scope)).text.includes("late recalled text"), "late recall must restore original scope");
      assert.ok((await getDraft(f.page, f.scope)).text.includes("original draft"));
      assert.equal((await getDraft(f.page, f.scope)).attachments?.[0].name, "late.txt");
      assert.deepEqual(await getDraft(f.page, other), { ...blank(), text: "B stays untouched" });
      assert.equal(await f.page.locator("#prompt").inputValue(), "B stays untouched");
      assert.equal(await f.page.locator(".attachment-chip").count(), 0);
    });
    await check(`${label}: late prompt receipt never clears newer or other-session input`, nested, async (f) => {
      f.holdPrompt();
      await f.input.fill("submitted steering"); await f.input.press("Enter");
      await eventually(() => sends(f.commands).length === 1, "steering prompt must be pending before navigation");
      await f.input.fill("new owner input");
      if (nested) await f.page.getByRole("button", { name: "关闭子代理会话，返回主对话", exact: true }).click();
      await f.page.locator("#history .history-item").filter({ hasText: "Steering B" }).click();
      await f.page.waitForFunction(id => JSON.parse(sessionStorage.getItem("view") || "null")?.sessionId === id, other.sessionId);
      await f.page.locator("#prompt").fill("new B input");
      f.releasePrompt(); await f.page.waitForTimeout(150);
      assert.equal((await getDraft(f.page, f.scope)).text, "new owner input");
      assert.equal((await getDraft(f.page, other)).text, "new B input");
      assert.equal(stops(f.commands).length, 0);
    });
    await check(`${label}: existing right-hand stop button still stops`, nested, async (f) => {
      await f.input.fill("must not be sent or discarded");
      // The button continuously scales; click its centre without waiting for an animation to end.
      const stop = f.composer.getByRole("button", { name: "停止执行", exact: true });
      await stop.click({ force: true });
      await eventually(() => stops(f.commands).length === 1, "stop button must issue a stop command");
      const stopped = stops(f.commands)[0];
      assert.equal(stopped.workspaceId, f.scope.workspaceId);
      if (nested) {
        assert.equal(stopped.op, "task.cancel"); assert.equal(stopped.sessionId, owner.sessionId);
        assert.equal(stopped.params?.taskId, task.id);
      } else {
        assert.equal(stopped.op, "agent.stop"); assert.equal(stopped.sessionId, owner.sessionId);
        assert.equal(stopped.params?.runId, `run-${owner.sessionId}`);
      }
      assert.equal(sends(f.commands).length + recalls(f.commands).length, 0);
      assert.equal(await f.input.inputValue(), "must not be sent or discarded");
    });
  }
  await check("outside composer: double Escape never recalls", false, async (f) => {
    await f.page.locator("#history .history-item").filter({ hasText: "Steering A" }).focus();
    await f.page.keyboard.press("Escape"); await f.page.keyboard.press("Escape");
    await f.page.waitForTimeout(100);
    assert.equal(recalls(f.commands).length, 0); assert.equal(stops(f.commands).length, 0);
  });
  assert.equal(app.store.db.prepare("SELECT count(*) AS n FROM runs").get()!.n, 0, "UI test must never launch a model run");
  console.log(`\nSteering UI: ${passed.length} passed, ${failed.length} failed.`);
  if (failed.length) {
    console.error(failed.map((message, i) => `${i + 1}. ${message}`).join("\n"));
    process.exitCode = 1;
  }
} finally {
  try { await browser?.close(); } finally {
    try { await app?.close(); } finally {
      if (previousPi === undefined) delete process.env.AXIOM_PI_DIR;
      else process.env.AXIOM_PI_DIR = previousPi;
      rmSync(root, { recursive: true, force: true });
    }
  }
}
