import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import type { Command } from "../src/shared/protocol.js";
import { emptyAgent } from "../src/shared/agent.js";
import { taskWindowFixture } from "./fixtures/task-window.js";
import { TaskWindows } from "../src/server/task-windows.js";

test("composer and retry share whole task counts, gate unknown and recover without full task subscriptions", async t => {
  const f = taskWindowFixture(t), windows = new TaskWindows(f.store, () => "e".repeat(64)); t.after(() => windows.close());
  for (let i = 0; i < 145; i++) f.task(`activity-${i}`, i);
  const commands: Command[] = []; let seq = 0, hint = 0, failOpen = false;
  let release!: () => void;
  const opening = new Promise<void>(resolve => { release = resolve; });
  const selection = { provider: "fixture-provider", id: "fixture-model", thinking: "off" };
  const info = { ...emptyAgent, selection, run: { id: "parent-run", status: "failed", selection } };
  const bundle = await build({ stdin: { resolveDir: resolve("."), loader: "tsx", contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {Composer} from './src/client/chat/Composer.tsx';import {RetryAction} from './src/client/chat/RetryAction.tsx';
    import {TaskWindowProvider} from './src/client/tasks/TaskWindowProvider.tsx';import {connect} from './src/client/transport.ts';
    window.fetch=async(url,options)=>({ok:true,json:async()=>String(url).startsWith('/api/draft')
      ? options?.method==='POST'?{revision:1}:{revision:0,draft:{text:'',attachment:null}}:{}});
    class Socket{static OPEN=1;static CONNECTING=0;static CLOSED=3;readyState=0;
      constructor(){window.socket=this;queueMicrotask(()=>{this.readyState=1;this.onopen?.();this.emit({type:'hello',streamId:'fixture'});});}
      emit(frame){this.onmessage?.({data:JSON.stringify(frame)});}
      send(raw){const command=JSON.parse(raw);window.hostCommand(command).then(frames=>{frames.forEach(frame=>this.emit(frame));
        if(command.op==='prompt')window.promptReplies=(window.promptReplies??0)+1;});}
      close(){this.readyState=3;this.onclose?.();}}
    window.WebSocket=Socket;const scope=${JSON.stringify(f.scope)};
    createRoot(document.getElementById('root')).render(<React.StrictMode><TaskWindowProvider scope={scope}>
      <RetryAction scope={scope} nested={false}/><Composer scope={scope}/></TaskWindowProvider></React.StrictMode>);void connect();
  ` }, bundle: true, write: false, format: "iife", platform: "browser", loader: { ".svg": "text", ".css": "empty" }, define: { "process.env.NODE_ENV": '"development"' } });
  const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  try {
    const page = await browser.newPage(); const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => route.abort());
    await page.exposeFunction("hostCommand", async (c: Command) => {
      commands.push(c); const receipt = { type: "receipt", requestId: c.requestId, ok: true, data: null };
      if (c.op === "subscribe") {
        const scope = String(c.params?.scope);
        const data = scope === "configuration" ? { revision: "x", available: [], providerCount: 0, modelCount: 0, dataRoot: "" } : scope.startsWith("agent:") ? info : undefined;
        return data ? [{ type: "snapshot", streamId: "fixture", seq: ++seq, scope, data }, receipt] : [receipt];
      }
      if (c.op === "task.window") {
        await opening;
        if (failOpen) { failOpen = false; return [{ ...receipt, ok: false, error: { code: "UNAVAILABLE", message: "任务状态暂不可用" } }]; }
        return [windows.read(f.scope, c.requestId, c.params?.query)];
      }
      if (c.op === "costs.get") return [{ ...receipt, ok: false, error: { code: "UNAVAILABLE", message: "Fixture has no cost report" } }];
      assert.ok(["prompt", "agent.accountUsage.cached", "unsubscribe", "read.cancel", "ping"].includes(c.op), `unexpected ${c.op}`);
      return [receipt];
    });
    await page.route("https://axiom-task-activity.test/", route => route.fulfill({ status: 200, contentType: "text/html", body: '<div id="root"></div>' }));
    await page.goto("https://axiom-task-activity.test/"); await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const send = page.locator('button.send'), retry = page.getByRole("button", { name: "重试", exact: true }), input = page.locator('#prompt');
    await page.getByText("任务状态待同步，输入已保留。", { exact: true }).waitFor();
    await input.fill("retained while unknown"); await input.press("Enter");
    assert.equal(await send.isDisabled(), true); assert.equal(await retry.count(), 0);
    assert.equal(commands.filter(c => c.op === "prompt").length, 0); assert.equal(await input.inputValue(), "retained while unknown");
    assert.ok(release); release(); await retry.waitFor(); assert.equal(await send.isDisabled(), false);
    const update = async (status: string) => {
      f.store.db.prepare("UPDATE tasks SET status=? WHERE id='activity-0'").run(status);
      await page.evaluate(data => (window as unknown as {socket:{emit:(data:unknown)=>void}}).socket.emit(data), {
        type: "snapshot", streamId: "fixture", seq: ++seq, scope: `task-window:${f.scope.workspaceId}:${f.scope.sessionId}`, data: { revision: ++hint },
      });
    };
    await update("running"); await page.getByRole("button", { name: "停止执行", exact: true }).waitFor();
    assert.equal(await retry.count(), 0, "old off-page activity blocks retry");
    await update("future-status"); await page.getByText("任务状态待同步，输入已保留。", { exact: true }).waitFor();
    await input.press("Enter"); assert.equal(commands.filter(c => c.op === "prompt").length, 0);
    assert.equal(await send.isDisabled(), true); assert.equal(await retry.count(), 0);
    failOpen = true; await update("completed"); await page.getByRole("button", { name: "刷新任务状态" }).waitFor();
    assert.equal(await send.isDisabled(), true);
    await page.getByRole("button", { name: "刷新任务状态" }).click(); await retry.waitFor();
    assert.equal(await input.inputValue(), "retained while unknown");
    await update("running"); await page.getByRole("button", { name: "停止执行", exact: true }).waitFor();
    await input.press("Enter"); await page.waitForFunction(() => (document.querySelector('#prompt') as HTMLTextAreaElement)?.value === '');
    await page.waitForFunction(() => !(document.querySelector('button.send') as HTMLButtonElement)?.disabled);
    assert.equal(commands.filter(c => c.op === "prompt").at(-1)?.params?.mode, "steer");
    await update("completed"); await page.getByRole("button", { name: "发送消息", exact: true }).waitFor();
    await input.fill("fresh prompt"); await input.press("Enter");
    await page.waitForFunction(() => (window as unknown as {promptReplies:number}).promptReplies === 2 && (document.querySelector('#prompt') as HTMLTextAreaElement)?.value === '');
    assert.equal(commands.filter(c => c.op === "prompt").length, 2);
    assert.equal(commands.filter(c => c.op === "prompt").at(-1)?.params?.mode, undefined);
    assert.equal(commands.some(c => c.op === "subscribe" && String(c.params?.scope).startsWith("tasks:")), false);
    assert.ok(commands.filter(c => c.op === "task.window").every(c => (c.params?.query as {op:string}).op === "open"));
    assert.deepEqual(errors, []);
  } finally { release?.(); await browser.close(); }
});
