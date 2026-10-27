// Real useSubmission with an isolated Vite fixture and mocked WS; no model/server writes.
// Run from app: AXIOM_TEST_BROWSER=/path/to/chrome npx tsx tests/submission-dispatch.check.ts
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";
import type { Command } from "../src/shared/protocol.js";

type Snapshot = {
  draft: { text: string }; pending: { state: string; draft: { text: string }; queued?: boolean }[];
  trace: { stage: string; at: number; ui?: { text: string; draft: string; state?: string } }[];
};
const root = await mkdtemp(join(tmpdir(), "axiom-submission-dispatch-")), appRoot = resolve(".");
await writeFile(join(root, "index.html"), `<!doctype html><html><body><div id="root"></div><script type="module" src="/@fs/${appRoot}/tests/fixtures/submission-dispatch.tsx"></script></body></html>`);
const server = await createServer({ configFile: false, root, cacheDir: join(root, "cache"),
  resolve: { alias: { react: join(appRoot, "node_modules/react"), "react-dom": join(appRoot, "node_modules/react-dom") } },
  esbuild: { jsx: "automatic" }, server: { host: "127.0.0.1", port: 0, fs: { allow: [root, appRoot] } } });
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  await server.listen();
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  for (const scenario of ["accepted", "steering", "failed", "uncertain", "hidden", "paused-frame"] as const) {
    const page = await browser.newPage(), errors: string[] = [], sends: Command[] = [];
    let reply: (() => void) | undefined;
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(({ hidden, paused }) => {
      if (hidden) Object.defineProperty(document, "visibilityState", { value: "hidden" });
      if (paused) {
        window.requestAnimationFrame = () => 1;
        window.cancelAnimationFrame = () => {};
      }
    }, { hidden: scenario === "hidden", paused: scenario === "paused-frame" });
    // Dependency optimization must not reload the fixture during the first input.
    await page.route("**/@vite/client", async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: (await response.text()).replace("async function handleMessage(payload) {", "async function handleMessage(payload) { return;") });
    });
    await page.route("**/api/status", route => route.fulfill({ json: {} }));
    await page.route("**/api/draft?*", route => route.request().method() === "GET"
      ? route.fulfill({ json: { revision: 0, writer: "", sequence: 0, draft: { text: "", attachment: null } } })
      : undefined); // Intentionally unresolved writes: persistence must not block prompt dispatch.
    await page.routeWebSocket("**/ws", socket => {
      socket.send(JSON.stringify({ type: "hello", streamId: "dispatch-fixture" }));
      socket.onMessage(raw => {
        const command = JSON.parse(raw.toString()) as Command;
        if (command.op === "prompt") {
          sends.push(command);
          const failed = scenario === "failed" || scenario === "uncertain";
          reply = () => socket.send(JSON.stringify({ type: "receipt", requestId: command.requestId, ok: !failed,
            ...(failed ? { error: { code: scenario === "uncertain" ? "UNCERTAIN" : "TEST_REJECTED", message: "isolated fixture rejection" } }
              : { data: scenario === "steering" ? { inputId: command.requestId } : { runId: command.requestId } }) }));
        } else socket.send(JSON.stringify({ type: "receipt", requestId: command.requestId, ok: true, data: command.op === "agent.inputs" ? [] : {} }));
      });
    });
    await page.goto(server.resolvedUrls!.local[0] + (scenario === "steering" ? "?active=1" : ""));
    await page.waitForFunction(() => !(document.querySelector("#send") as HTMLButtonElement)?.disabled, null, { polling: 10 });
    const text = `preserve ${scenario} submission`;
    await page.locator("#draft").fill(text);
    if (scenario === "steering") await page.locator("#draft").press("Enter");
    else await page.locator("#send").click();
    await page.waitForFunction(() => (window as any).submissionDispatch.trace.some((item: any) => item.stage === "socket.send"), null, { timeout: 5000, polling: 10 });
    const beforeReceipt = await page.evaluate(() => ({ ...((window as any).submissionDispatch.snapshot()), trace: (window as any).submissionDispatch.trace })) as Snapshot;
    const stages = beforeReceipt.trace.map(item => item.stage), dispatched = beforeReceipt.trace.find(item => item.stage === "socket.send")!;
    assert.ok(stages.indexOf("pending.commit") >= 0 && stages.indexOf("pending.commit") < stages.indexOf("socket.send"), `${scenario}: local UI must commit before dispatch: ${stages}`);
    if (scenario !== "hidden" && scenario !== "paused-frame")
      assert.ok(stages.indexOf("pending.frame") >= 0 && stages.indexOf("pending.frame") < stages.indexOf("socket.send"), `${scenario}: yield a paint opportunity before dispatch: ${stages}`);
    assert.deepEqual(dispatched.ui, { text, draft: "", state: "sending" }, "local UI is rendered and the captured draft cleared before socket.send");
    assert.equal(beforeReceipt.pending[0].state, "sending", "local feedback does not require or pretend backend acceptance");
    assert.equal(beforeReceipt.pending[0].queued, scenario === "steering");
    assert.equal(await page.locator("#pending").isVisible(), true);
    const deadline = Date.now() + 3000;
    while (!reply && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(reply, "prompt reaches mock backend even with paused animation frames");
    assert.equal(sends.length, 1, "the synchronous in-flight guard prevents duplicate sends");
    assert.equal(sends[0].params?.text, text);
    assert.equal(sends[0].params?.mode, scenario === "steering" ? "steer" : undefined);
    // A late receipt must not erase typing begun after the local submission.
    const newer = `new typing during ${scenario}`;
    await page.locator("#draft").fill(newer);
    reply();
    const expected = scenario === "failed" || scenario === "uncertain" ? scenario : "accepted";
    await page.waitForFunction(state => (window as any).submissionDispatch.snapshot().pending[0]?.state === state, expected, { polling: 10 });
    const afterReceipt = await page.evaluate(() => (window as any).submissionDispatch.snapshot()) as Snapshot;
    assert.equal(afterReceipt.draft.text, newer);
    assert.equal(afterReceipt.pending[0].draft.text, text, "accepted, failed and uncertain inputs retain the captured original");
    assert.equal(afterReceipt.pending[0].queued, scenario === "steering");
    assert.deepEqual(errors, []);
    console.log(`PASS ${scenario}: local UI precedes dispatch and delayed receipt; captured/new typing preserved; no duplicate send`);
    await page.close();
  }
} finally { await browser?.close(); await server.close(); await rm(root, { recursive: true, force: true }); }
