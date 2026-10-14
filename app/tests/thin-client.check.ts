// Standalone browser regression: npx tsx tests/thin-client.check.ts
// No backend or model requests: exercise the actual Composer and transport with a mocked WebSocket.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createServer } from "vite";
import { chromium } from "playwright";
import type { Command, PickedAttachment } from "../src/shared/protocol.js";

const server = await createServer({
  configFile: false,
  root: resolve("src/client"),
  plugins: [{
    name: "thin-client-fixture",
    resolveId(id) { if (id === "virtual:thin-client") return id; },
    load(id) { if (id === "virtual:thin-client") return fixture; },
  }],
  server: { host: "127.0.0.1", port: 0 },
});
await server.listen();
const browser = await chromium.launch({ headless: true, executablePath: process.env.AXIOM_TEST_BROWSER });
const page = await browser.newPage();
const commands: Command[] = [], errors: string[] = [];
const picks: URL[] = [];
const picked: PickedAttachment[] = [
  { name: "notes.txt", path: "C:/fixture/notes.txt", kind: "file" },
  { name: "selected.png", path: "C:/fixture/selected.png", kind: "image" },
  { name: "sources", path: "C:/fixture/sources", kind: "folder" },
];
let respond: (() => void) | undefined;
let fail = false;
page.on("pageerror", (error) => errors.push(error.message));
const fixture = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {Composer} from '/chat/Composer.tsx';
import {acceptSnapshot, connect} from '/transport.ts';
const root = createRoot(document.getElementById('root'));
let seq = 0;
const selection = {provider:'fixture',id:'fixture',thinking:'off'};
window.renderComposer = (sessionId = 'parent', active = false, nested = false) => {
  const scope = {workspaceId:'workspace',sessionId};
  const publish = (scope,data) => acceptSnapshot({scope,data,streamId:'fixture',seq:++seq});
  publish('configuration',{revision:'1',providerCount:1,modelCount:1,dataRoot:'fixture',available:[{provider:'fixture',id:'fixture',name:'Fixture',levels:['off'],input:['text','image']}]});
  publish('agent:workspace:'+sessionId,{selection,run:active?{id:'run',sessionId,status:'running',selection,startedAt:Date.now(),endedAt:null,error:null}:null,environment:null,usage:null,...(nested?{task:{id:'task',parentSessionId:'parent',status:active?'running':'completed'}}:{})});
  publish('tasks:workspace:'+sessionId,{tasks:[],frozen:false,defaultModel:null});
  root.render(React.createElement(Composer,{key:sessionId,scope,nested}));
};
window.renderComposer();
connect();
`;
const html = '<!doctype html><html><body><div id="root"></div><script type="module" src="/@id/virtual:thin-client"></script></body></html>';
try {
  await page.route("**/thin-check", (route) => route.fulfill({ contentType: "text/html", body: html }));
  await page.route("**/api/status", (route) => route.fulfill({ json: {} }));
  await page.route("**/api/attachments/pick?*", (route) => {
    assert.equal(route.request().method(), "POST");
    picks.push(new URL(route.request().url()));
    return route.fulfill({ json: { items: picked } });
  });
  await page.routeWebSocket("**/ws", (socket) => {
    socket.onMessage((raw) => {
      const command = JSON.parse(raw.toString()) as Command;
      commands.push(command);
      const reply = () => socket.send(JSON.stringify(fail && command.op === "prompt"
        ? { type: "receipt", requestId: command.requestId, ok: false, error: { code: "TEST_ERROR", message: "test send failed" } }
        : { type: "receipt", requestId: command.requestId, ok: true, data: command.op === "files.upload"
          ? { name: command.params?.name, path: "C:/fixture/uploads/large.png", kind: "image", id: command.params?.id, text: "" }
          : {} }));
      if (command.op === "prompt") respond = reply;
      else reply();
    });
  });
  await page.goto(server.resolvedUrls!.local[0] + "thin-check");
  const input = page.getByRole("textbox", { name: "描述你的编码任务" });
  const send = page.getByRole("button", { name: "发送消息", exact: true });
  await input.fill("first draft");
  await send.waitFor();
  await page.waitForFunction(() => !(document.querySelector('button[aria-label="发送消息"]') as HTMLButtonElement)?.disabled);
  await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true, keyCode: 229 });
  assert.equal(commands.filter((c) => c.op === "prompt").length, 0);
  await send.click();
  await page.waitForTimeout(50);
  assert.ok(respond);
  await input.fill("typed during response");
  respond!(); respond = undefined;
  await page.waitForTimeout(50);
  assert.equal(await input.inputValue(), "typed during response");
  fail = true;
  await send.click();
  await page.waitForTimeout(50);
  respond!(); respond = undefined;
  await page.getByRole("status").filter({ hasText: "test send failed" }).waitFor();
  assert.equal(await input.inputValue(), "typed during response");
  assert.equal(await page.getByRole("button", { name: /核实发送|显式继续|确认已清理|恢复此草稿/ }).count(), 0);
  assert.equal(await page.evaluate(() => Object.keys(sessionStorage).some((key) => /^(draft|pending):/.test(key))), false);
  await page.evaluate(() => (window as any).renderComposer("other"));
  assert.equal(await input.inputValue(), "");
  await input.fill("other draft");
  await page.evaluate(() => (window as any).renderComposer("parent"));
  assert.equal(await input.inputValue(), "typed during response");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1kAAAAASUVORK5CYII=", "base64");
  const largePng = Buffer.concat([png, Buffer.alloc(420_000)]);
  await page.getByRole("button", { name: "添加附件", exact: true }).click();
  for (const item of picked)
    await page.getByRole("button", { name: `移除附件：${item.name}`, exact: true }).waitFor();
  assert.equal(picks.length, 1);
  assert.equal(picks[0].searchParams.get("workspaceId"), "workspace");
  assert.equal(picks[0].searchParams.get("sessionId"), "parent");
  for (const id of ["file1", "imag1", "folder1"])
    assert.ok((await input.inputValue()).includes(`[${id}]`));
  await input.evaluate((node, data) => {
    const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
    const clipboardData = new DataTransfer();
    clipboardData.items.add(new File([bytes], "large.png", { type: "image/png" }));
    node.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  }, largePng.toString("base64"));
  await page.getByRole("button", { name: "移除附件：large.png", exact: true }).waitFor();
  assert.match(await input.inputValue(), /\[imag2\]/);
  const upload = commands.find((c) => c.op === "files.upload")!;
  assert.equal(upload.workspaceId, "workspace");
  assert.equal(upload.sessionId, "parent");
  assert.equal(upload.params?.data, largePng.toString("base64"));
  fail = false;
  await send.click();
  await page.waitForTimeout(50);
  const sent = commands.filter((c) => c.op === "prompt").at(-1)!;
  assert.deepEqual(sent.params?.attachments, [
    ...picked.map((item, i) => ({ ...item, id: ["file1", "imag1", "folder1"][i], text: "" })),
    { name: "large.png", path: "C:/fixture/uploads/large.png", kind: "image", id: "imag2", text: "" },
  ]);
  assert.deepEqual(sent.params?.images, []);
  respond!(); respond = undefined;
  await page.waitForTimeout(50);
  assert.equal(await input.inputValue(), "");
  assert.equal(await page.getByRole("button", { name: /^移除附件：/ }).count(), 0);
  await input.fill("discard on reload");
  await page.evaluate(() => (window as any).renderComposer("parent", true));
  await page.getByRole("button", { name: "停止执行", exact: true }).click();
  await page.waitForTimeout(50);
  assert.deepEqual(commands.find((c) => c.op === "agent.stop")?.params, { runId: "run" });
  await page.evaluate(() => (window as any).renderComposer("child", true, true));
  await page.getByRole("button", { name: "停止执行", exact: true }).click();
  await page.waitForTimeout(50);
  const cancel = commands.find((c) => c.op === "task.cancel");
  assert.deepEqual(cancel?.params, { taskId: "task" });
  assert.equal(cancel?.sessionId, "parent");
  assert.equal(commands.filter((c) => /^(draft\.|agent\.(receipt|continue|confirm-cleanup))/.test(c.op)).length, 0);
  await page.reload();
  assert.equal(await input.inputValue(), "");
  assert.deepEqual(errors, []);
  console.log("PASS: in-memory scoped drafts, IME, late response preservation, plain send errors, no recovery UI/storage, scoped native attachment selection and large clipboard image upload, direct parent/child stop, reload discards drafts");
} finally {
  await browser.close();
  await server.close();
}
