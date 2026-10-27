import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock } from "node:test";
import { chromium } from "playwright";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { startServer } from "../src/server/index.js";

const root = mkdtempSync(join(tmpdir(), "axiom-model-loading-ui-")), previous = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = join(root, "pi"); mkdirSync(process.env.AXIOM_PI_DIR);
const modelsPath = join(process.env.AXIOM_PI_DIR, "models.json"), authPath = join(process.env.AXIOM_PI_DIR, "auth.json");
writeFileSync(modelsPath, JSON.stringify({ providers: { fixture: {
  name: "本地配置夹具", api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1", models: [{ id: "fixture", name: "Fixture Model" }],
} } }));
writeFileSync(authPath, JSON.stringify({ fixture: { type: "api_key", key: "PRIVATE-KEY" } }));
const app = await startServer({ root: join(root, "data"), port: 0 });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
try {
  const models = readFileSync(modelsPath, "utf8"), auth = readFileSync(authPath, "utf8");
  // Startup can establish global inference availability; opening the editor cannot.
  for (const method of ["refresh", "checkAuth", "getAvailable", "getAuth", "login"] as const)
    mock.method(ModelRuntime.prototype, method, () => assert.fail(`editor invoked ${method}`));
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [], requests: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => requests.push(request.url()));
  let release!: () => void, configReads = 0, readMs = 0, started = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const reads = new Set<string>();
  await page.routeWebSocket("**/ws", route => {
    const server = route.connectToServer();
    route.onMessage(message => {
      const command = JSON.parse(message.toString());
      if (command.op === "configuration.get") { configReads++; reads.add(command.requestId); started = performance.now(); }
      server.send(message);
    });
    server.onMessage(async message => {
      const event = JSON.parse(message.toString());
      if (reads.delete(event.requestId)) {
        readMs = performance.now() - started;
        assert.equal(event.ok, true, "configuration.get must not run auth/availability checks");
        assert.ok(readMs < 1500, `local configuration receipt took ${readMs}ms`);
        assert.doesNotMatch(JSON.stringify(event.data), /PRIVATE-KEY/);
      }
      // Hold hello/snapshots too, so focus happens on an open socket that has
      // not received any response evidence yet (lastResponse === 0).
      await gate;
      route.send(message);
    });
  });
  await page.goto(app.origin + "/model-config.html");
  await page.locator(".save-state").filter({ hasText: "读取本地配置" }).waitFor();
  assert.match(await page.locator("#supplier-heading").innerText(), /…/);
  assert.equal(await page.getByText("暂无供应商", { exact: true }).count(), 0);
  assert.equal(requests.some(url => /\/assets\/ModelRegistry-/.test(url)), false, "model editor chunk must not load on first screen");
  assert.equal(requests.some(url => /\/assets\/ModelLogin-/.test(url)), false, "login chunk must not load on first screen");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  release();
  await page.getByRole("heading", { name: "本地配置夹具", exact: true }).waitFor();
  await page.locator(".connection-badge").filter({ hasText: "已配置认证" }).waitFor();
  assert.match(await page.locator("#supplier-heading").innerText(), /1/);
  assert.equal(configReads, 1, "opening settings should issue only one editable configuration read");
  assert.equal(requests.some(url => /\/assets\/ModelRegistry-/.test(url)), false);
  await page.getByRole("tab", { name: "模型配置", exact: true }).click();
  await page.getByRole("searchbox", { name: "搜索当前供应商的模型", exact: true }).waitFor();
  assert.equal(requests.some(url => /\/assets\/ModelRegistry-/.test(url)), true, "model editor downloads on first visit");
  await page.getByRole("button", { name: "重新读取配置", exact: true }).click();
  await page.locator(".container[aria-busy=false]").waitFor();
  assert.equal(configReads, 2);
  assert.equal(readFileSync(modelsPath, "utf8"), models);
  assert.equal(readFileSync(authPath, "utf8"), auth);
  assert.deepEqual(errors, []);

  // Lose the very first read before it reaches the server. The next connection
  // must retry initialization rather than leaving the empty editor disabled.
  const retryPage = await browser.newPage();
  let attempts = 0, dropped = false, sockets = 0;
  let disconnect!: () => void, confirmReconnect!: () => void;
  const reconnected = new Promise<void>(resolve => { confirmReconnect = resolve; });
  await retryPage.routeWebSocket("**/ws", route => {
    const generation = ++sockets;
    disconnect = () => route.close({ code: 1012, reason: "fixture reconnect" });
    const server = route.connectToServer();
    route.onMessage(message => {
      const command = JSON.parse(message.toString());
      if (command.op === "configuration.get") {
        attempts++;
        if (!dropped) { dropped = true; route.close({ code: 1012, reason: "fixture reconnect" }); return; }
      }
      server.send(message);
    });
    server.onMessage(message => {
      route.send(message);
      if (generation === 3 && JSON.parse(message.toString()).type === "hello") confirmReconnect();
    });
  });
  await retryPage.goto(app.origin + "/model-config.html");
  await retryPage.getByRole("heading", { name: "本地配置夹具", exact: true }).waitFor({ timeout: 15000 });
  assert.equal(attempts, 2, "initial read retries once on a new connection generation");
  await retryPage.locator("#provider-name").fill("Unsaved reconnect draft");
  disconnect();
  await reconnected;
  await retryPage.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  assert.equal(attempts, 2, "reconnection must not reload an existing draft");
  assert.equal(await retryPage.locator("#provider-name").inputValue(), "Unsaved reconnect draft");
  assert.equal(readFileSync(modelsPath, "utf8"), models);
  assert.equal(readFileSync(authPath, "utf8"), auth);
  await retryPage.close();
  console.log(`PASS model loading: ${readMs.toFixed(1)}ms local receipt; no auth checks/writes, one initial read, loading distinct from empty, editor/login chunks lazy, initial disconnect recovers.`);
} finally {
  mock.restoreAll(); await browser.close(); await app.close();
  if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  rmSync(root, { recursive: true, force: true });
}
