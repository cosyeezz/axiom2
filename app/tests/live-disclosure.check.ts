// Expanded live thinking and running tool output must grow steadily while streaming.
// Bounded previews change on every delta; the body must not fall back to the preview
// or re-show its loading line while a slower full read is in flight.
// Run: npm exec tsx tests/live-disclosure.check.ts
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { startServer } from "../src/server/index.js";
import type { AgentViews } from "../src/server/agents/views.js";
import type { ChatMessage } from "../src/shared/agent.js";
import type { Scope, Session, Workspace } from "../src/shared/protocol.js";

type Sample = { length: number; loading: boolean };
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
/** Delta bursts faster than one full read, separated by pauses longer than one. */
async function stream(send: (count: number) => void) {
  for (let count = 21; count <= 80; count++) { send(count); await sleep(count % 6 === 0 ? 300 : 40); }
}

/** Record the expanded body on every frame, so a single-frame fallback is visible. */
// A string script keeps tsx helpers such as __name out of the page.
async function startSampling(page: Page, body: string, loading: string) {
  await page.evaluate(`(() => {
    const samples = window.__samples = [];
    const tick = () => {
      const node = document.querySelector(${JSON.stringify(body)});
      if (node) samples.push({ length: node.textContent?.length ?? 0, loading: !!document.querySelector(${JSON.stringify(loading)}) });
      window.__sampling = requestAnimationFrame(tick);
    };
    tick();
  })()`);
}
async function stopSampling(page: Page) {
  return page.evaluate("cancelAnimationFrame(window.__sampling), window.__samples") as Promise<Sample[]>;
}
/** After the first full read, the body only grows and the loading line stays hidden. */
function assertSteady(label: string, samples: Sample[], previewCap: number) {
  // Run-length trace of visible lengths; "L" marks frames with the loading line.
  const trace = samples.reduce<string[]>((runs, sample) => {
    const value = `${sample.length}${sample.loading ? "L" : ""}`;
    if (runs.at(-1) !== value) runs.push(value);
    return runs;
  }, []).join(" ");
  if (process.env.AXIOM_CHECK_TRACE) console.log(`${label}: ${samples.length} frames: ${trace}`);
  const first = samples.findIndex(sample => !sample.loading && sample.length > previewCap + 40);
  assert.ok(first >= 0, `${label}: the first full read completed during streaming\n${trace}`);
  let shrinks = 0, reloads = 0, peak = 0;
  for (const sample of samples.slice(first)) {
    if (sample.length + 1 < peak) shrinks++;
    if (sample.loading) reloads++;
    peak = Math.max(peak, sample.length);
  }
  assert.equal(shrinks, 0, `${label}: body never falls back to the shorter preview (${samples.length} frames)\n${trace}`);
  assert.equal(reloads, 0, `${label}: loading line never returns during live updates (${samples.length} frames)\n${trace}`);
}

const root = mkdtempSync(join(tmpdir(), "axiom-live-disclosure-"));
mkdirSync(join(root, "workspace")); mkdirSync(join(root, "pi"));
const previousPi = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = join(root, "pi");
let app: Awaited<ReturnType<typeof startServer>> | undefined, browser: Browser | undefined;
try {
  app = await startServer({ root: join(root, "data"), port: 0, dev: true });
  const workspace = app.store.execute({ requestId: crypto.randomUUID(), op: "workspace.open", params: { path: join(root, "workspace"), authorized: true } }) as Workspace;
  const session = app.store.execute({ requestId: crypto.randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const scope: Scope = { workspaceId: workspace.id, sessionId: session.id };
  const views = (app.agents as unknown as { views: AgentViews }).views;
  const update = (message: ChatMessage) => { views.messageChanged(scope, message); views.flush(scope); };
  const line = (label: string, index: number) => `${label}第 ${index} 行，继续核对实现与验证结果。\n`;
  const grow = (label: string, count: number) => Array.from({ length: count }, (_, index) => line(label, index)).join("");

  update({ id: "user", role: "user", text: "检查展开闪烁" });
  const assistant = (thinking: string, active: boolean): ChatMessage => ({
    id: "a1", role: "assistant", text: "", thinking, thinkingActive: active, streaming: active,
    ...(active ? {} : { calls: [{ id: "sh", name: "bash", input: JSON.stringify({ command: "npm test" }) }] }),
  });
  update(assistant(grow("思考", 20), true));

  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(10000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(value => sessionStorage.setItem("view", JSON.stringify(value)), scope);
  // Full reads are slower than stream deltas, as with a busy desktop server.
  let partReads = 0;
  let mode: "slow" | "fail" | "hold" = "slow";
  let release: (() => void) | undefined, received: (() => void) | undefined;
  const pendingRequest = () => new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Expected a held message.part receipt within 10 seconds")), 10000);
    received = () => { clearTimeout(timer); resolve(); };
  });
  await page.routeWebSocket("**/ws", socket => {
    const server = socket.connectToServer();
    const slow = new Map<string, "slow" | "hold">();
    socket.onMessage(raw => {
      const request = JSON.parse(raw.toString()) as { op?: string; requestId?: string };
      if (request.op === "message.part" && request.requestId) {
        partReads++;
        if (mode === "fail") {
          socket.send(JSON.stringify({ type: "receipt", requestId: request.requestId, ok: false, error: { code: "READ_FAILED", message: "字段读取失败夹具" } }));
          return;
        }
        slow.set(request.requestId, mode);
      }
      server.send(raw);
    });
    server.onMessage(raw => {
      const frame = JSON.parse(raw.toString()) as { type?: string; requestId?: string };
      const policy = frame.type === "receipt" && frame.requestId ? slow.get(frame.requestId) : undefined;
      if (!policy) { socket.send(raw); return; }
      slow.delete(frame.requestId!);
      const respond = () => socket.send(raw);
      if (policy === "hold") { release = respond; received?.(); }
      else setTimeout(respond, 150);
    });
  });
  await page.goto(app.origin);

  // Live thinking: open the process, then the thought, while it keeps streaming.
  const card = page.locator(".process-live").first();
  await card.locator(":scope > summary").click();
  await page.locator(".thinking-block > summary").click();
  await page.locator(".thinking-body").waitFor();
  await startSampling(page, ".thinking-block .thinking-body", ".thinking-body .tool-truncated[role=status]");
  await stream(count => update(assistant(grow("思考", count), true)));
  assertSteady("thinking", await stopSampling(page), 320);
  update(assistant(grow("思考", 80) + "THINKING_END", false));
  await page.waitForFunction(() => document.querySelector(".thinking-body")?.textContent?.includes("THINKING_END"));
  assert.equal(await page.locator(".thinking-body .tool-truncated").count(), 0, "thinking: final text loaded");

  // Running tool output: open the call, then stream its output.
  const result = (text: string, running: boolean): ChatMessage => ({
    id: "tool-sh", role: "toolResult", toolCallId: "sh", toolName: "bash", text,
    status: running ? "running" : "completed", streaming: running, toolStartedAt: Date.now() - 3000,
    ...(running ? {} : { durationMs: 3200 }),
  });
  update(result(grow("输出", 20), true));
  await page.locator(".tool-call > summary").first().click();
  await page.locator(".tool-detail").waitFor();
  const output = ".tool-call .tool-detail > pre:last-of-type";
  await startSampling(page, output, ".tool-call .tool-detail > pre:last-of-type ~ .tool-truncated[role=status]");
  await stream(count => update(result(grow("输出", count), true)));
  assertSteady("tool output", await stopSampling(page), 320);
  update(result(grow("输出", 80) + "OUTPUT_END", false));
  await page.waitForFunction(selector => document.querySelector(selector)?.textContent?.includes("OUTPUT_END"), output);
  assert.equal(await page.locator(".tool-detail .tool-truncated").count(), 0, "tool output: final text loaded");

  const waitOutput = (text: string) => page.waitForFunction(({ selector, text }) => document.querySelector(selector)?.textContent === text, { selector: output, text });
  const alert = page.locator(".tool-detail .execution-alert").filter({ hasText: "字段读取失败夹具" });
  const rewritten = grow("改写", 40);
  mode = "fail";
  update(result(rewritten, false));
  await alert.waitFor();
  mode = "slow";
  await alert.getByRole("button", { name: "重新加载", exact: true }).click();
  await waitOutput(rewritten);
  assert.equal(await alert.count(), 0, "successful retry clears the read error");

  // A complete replacement no longer needs a full read or an old error/retry control.
  mode = "fail";
  update(result(grow("再次改写", 40), false));
  await alert.waitFor();
  update(result("完整短输出", false));
  await waitOutput("完整短输出");
  assert.equal(await alert.count(), 0, "complete short output clears the obsolete read error");
  assert.equal(await page.locator(".tool-detail .tool-truncated").count(), 0);

  // A late full response cannot overwrite a newer complete preview.
  mode = "hold";
  const shortReplacement = pendingRequest();
  update(result(grow("旧的长输出", 40), false));
  await shortReplacement;
  update(result("替换后的短输出", false));
  await waitOutput("替换后的短输出");
  release!(); release = undefined;
  await page.waitForTimeout(200);
  assert.equal(await page.locator(output).textContent(), "替换后的短输出");

  // Closing releases the old request; reopening may read a new version immediately.
  const closedRequest = pendingRequest();
  update(result(grow("收起前输出", 40), false));
  await closedRequest;
  await page.locator(".tool-call > summary").first().click();
  assert.equal(await page.locator(".tool-detail").count(), 0);
  mode = "slow";
  const reopened = grow("重新展开输出", 40);
  update(result(reopened, false));
  await page.locator(".tool-call > summary").first().click();
  await waitOutput(reopened);
  release!(); release = undefined;
  await page.waitForTimeout(200);
  assert.equal(await page.locator(output).textContent(), reopened, "closed disclosure's late receipt cannot replace the reopened body");

  assert.ok(partReads > 0, "long fields were read in full");
  assert.deepEqual(errors, []);
  console.log(`live disclosure check passed (${partReads} full reads)`);
} finally {
  await browser?.close();
  await app?.close();
  if (previousPi === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previousPi;
  rmSync(root, { recursive: true, force: true });
}
