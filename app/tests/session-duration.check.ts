// Actual Usage component against old/new backend snapshots; no model requests.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createServer } from "vite";
import { chromium } from "playwright";

const fixture = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {Usage} from '/chat/Usage.tsx';
import {acceptSnapshot} from '/transport.ts';
const root = createRoot(document.getElementById('root'));
let seq = 0;
window.showUsage = (options = {}) => {
  const sessionId = options.sessionId ?? 'parent';
  const scope = {workspaceId:'workspace',sessionId};
  const info = {selection:null,environment:null,usage:null,run:{
    id: options.id ?? 'run', sessionId, status:options.status ?? 'running',
    selection:{provider:'fixture',id:'fixture',thinking:'off'},
    startedAt:Date.now()-5000, endedAt:null, error:null
  }};
  if (options.status === 'cancelled') info.run.endedAt = info.run.startedAt+5000;
  if (options.total != null) info.completedRunDurationMs = options.total;
  if (options.child) info.task = {id:'task',parentSessionId:'parent',status:'running'};
  flushSync(() => root.render(React.createElement(Usage,{scope})));
  acceptSnapshot({scope:'agent:workspace:'+sessionId,data:info,streamId:'fixture',seq:++seq});
};
window.showUsage();
`;
const server = await createServer({
  configFile: false, root: resolve("src/client"),
  plugins: [{ name: "duration-fixture", resolveId(id) { if (id === "virtual:duration") return id; },
    load(id) { if (id === "virtual:duration") return fixture; } }],
  server: { host: "127.0.0.1", port: 0 },
});
await server.listen();
const browser = await chromium.launch({ headless: true, executablePath: process.env.AXIOM_TEST_BROWSER });
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/duration-check", (route) => route.fulfill({ contentType: "text/html", body:
    '<!doctype html><html><body><div id="root"></div><script type="module" src="/@id/virtual:duration"></script></body></html>' }));
  await page.goto(server.resolvedUrls!.local[0] + "duration-check");
  await page.waitForFunction(() => typeof (window as any).showUsage === "function");
  await page.waitForTimeout(100);
  assert.deepEqual(errors, [], "component loads without browser errors");
  const timer = page.locator('[data-od-id="run-duration"]');
  const expectTime = async (text: string) => page.waitForFunction((expected) =>
    document.querySelector('[data-od-id="run-duration"] strong')?.textContent === expected, text);
  await expectTime("5s");
  assert.match((await timer.getAttribute("data-tooltip"))!, /最近一次运行时间.*重启后台/);
  await expectTime("6s");
  await page.evaluate(() => (window as any).showUsage({ status: "cancelled" }));
  await expectTime("5s");
  await page.waitForTimeout(1100);
  assert.equal(await timer.locator("strong").textContent(), "5s");
  await page.evaluate(() => (window as any).showUsage({ id: "next", total: 15000 }));
  await expectTime("20s");
  assert.match((await timer.getAttribute("data-tooltip"))!, /主会话累计运行时间/);
  await page.evaluate(() => (window as any).showUsage({ sessionId: "child", child: true, total: 30000 }));
  await expectTime("35s");
  assert.match((await timer.getAttribute("data-tooltip"))!, /子会话累计运行时间/);
  assert.deepEqual(errors, []);
  console.log("Usage browser regression passed: legacy live timer, stopped timer, cumulative total and child scope");
} finally {
  await browser.close();
  await server.close();
}
