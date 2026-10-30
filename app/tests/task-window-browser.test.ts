import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import { TaskWindows } from "../src/server/task-windows.js";
import type { Command } from "../src/shared/protocol.js";
import { taskWindowFixture } from "./fixtures/task-window.js";

/** Real React/transport/browser, simulated socket, private real SQL/window engine.
 * Does NOT start index, an agent, a model, or the production service. */
test("task cards and operations share bounded reads, page errors, refresh and reconnect", async t => {
  const f = taskWindowFixture(t), windows = new TaskWindows(f.store, () => "b".repeat(64));
  for (let i = 0; i < 145; i++) f.task(`task-${i}`, i);
  f.store.db.prepare("UPDATE tasks SET anchor='batch',title=id").run();
  const task = f.records.rows("WHERE id='task-0'")[0];
  for (let i = 0; i < 145; i++) f.input(task, `receipt-${i}`, i, i === 0 ? "failed" : "delivered");
  const receiptError = "追加失败的详细原因 😀\n".repeat(3000);
  f.store.db.prepare("UPDATE task_input_receipts SET error=? WHERE inputId='receipt-0'").run(receiptError);
  const result = { id: "tool-append-op", role: "tool", text: JSON.stringify({ inputId: "receipt-0" }), status: "completed", streaming: false };
  const commands: Command[] = []; let seq = 0;
  const bundle = await build({
    stdin: { resolveDir: resolve("."), loader: "tsx", contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {OriginalConversationProvider} from './src/client/chat/OriginalConversation.tsx';
      import {TaskCards, OpenTask} from './src/client/tasks/TaskCards.tsx';
      import {TaskOperation} from './src/client/tasks/TaskOperation.tsx';
      import {connect} from './src/client/transport.ts';
      window.fetch = async () => ({ok:true});
      class Socket {
        static OPEN=1; static CONNECTING=0; static CLOSED=3; readyState=0;
        constructor(){window.socket=this;queueMicrotask(()=>{this.readyState=1;this.onopen?.();this.emit({type:'hello',streamId:'fixture'});});}
        emit(data){if(data.type==='receipt'&&data.ok&&data.data?.kind==='tasks'&&data.data.anchorKey===null)window.currentCut=data.data.revision;this.onmessage?.({data:JSON.stringify(data)});}
        send(raw){window.hostCommand(JSON.parse(raw)).then(frames=>{if(this.readyState===1)frames.forEach(frame=>this.emit(frame));});}
        close(){this.readyState=3;this.onclose?.();}
      }
      window.WebSocket=Socket;
      window.reconnect=()=>{window.socket.close();void connect();};
      window.hint=(revision)=>window.socket.emit({type:'snapshot',streamId:'fixture',seq:revision,scope:${JSON.stringify(`task-window:${f.scope.workspaceId}:${f.scope.sessionId}`)},data:{revision}});
      const scope=${JSON.stringify(f.scope)};
      function App(){
        const [cards,setCards]=React.useState(true);window.showCards=setCards;
        return <OriginalConversationProvider scope={scope}><OpenTask.Provider value={id=>document.body.dataset.opened=id}>
          {cards&&<TaskCards scope={scope} call={{id:'batch',name:'delegate',input:JSON.stringify({tasks:[{title:'准备任务'}]})}} message={{id:'assistant',role:'assistant',text:'',streaming:false}} />}
          <TaskOperation name='append' scope={scope} call={{id:'append-op',name:'append',input:JSON.stringify({taskId:'task-0',mode:'followUp',text:'追加内容'})}} message={{id:'append-message',role:'assistant',text:'',streaming:false}} />
        </OpenTask.Provider></OriginalConversationProvider>;
      }
      createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
      void connect();
    ` }, bundle: true, write: false, format: "iife", platform: "browser",
    loader: { ".svg": "text", ".css": "empty" }, define: { "process.env.NODE_ENV": '"development"' },
  });
  const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  try {
    const page = await browser.newPage({ viewport: { width: 700, height: 900 } });
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => route.abort());
    await page.exposeFunction("hostCommand", (c: Command) => {
      commands.push(c);
      const receipt = { type: "receipt", requestId: c.requestId, ok: true, data: null };
      if (c.op === "task.window") return [windows.read(f.scope, c.requestId, c.params?.query)];
      if (c.op === "subscribe") {
        const scope = String(c.params?.scope);
        return [{ type: "snapshot", streamId: "fixture", seq: ++seq, scope,
          data: scope.startsWith("task-window:") ? { revision: seq } : scope.startsWith("messages:") ? [result] : [] }, receipt];
      }
      assert.ok(["unsubscribe", "read.cancel", "ping"].includes(c.op), `Unexpected command ${c.op}`);
      return [receipt];
    });
    const css = ["tokens", "workbench", "task-calls"].map(name => readFileSync(new URL(`../src/client/styles/${name}.css`, import.meta.url), "utf8")).join("\n");
    // Native crypto.randomUUID needs a secure context; about:blank is not one.
    await page.route("https://axiom-task-window.test/", route => route.fulfill({ status: 200, contentType: "text/html",
      body: `<style>${css}</style><div id="root" style="padding:20px"></div>` }));
    await page.goto("https://axiom-task-window.test/");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const rows = page.locator(".subagent-card");
    try {
      await page.waitForFunction(() => document.querySelectorAll('.subagent-card').length === 64 && !document.querySelector('.subagent-card[aria-busy="true"]'), undefined, { timeout: 8000 });
    } catch (error) {
      console.error(JSON.stringify({ errors, commands, html: (await page.locator("body").innerHTML()).slice(-6000) }));
      throw error;
    }
    assert.equal(await rows.count(), 64);
    assert.match(await page.locator(".subagents-head [aria-label]").getAttribute("aria-label") ?? "", /145/);
    await page.getByRole("button", { name: "加载更早的子任务" }).click();
    await page.waitForFunction(() => document.querySelectorAll('.subagent-card').length === 128);
    await page.getByRole("button", { name: "加载更早的子任务" }).click();
    await page.waitForFunction(() => document.querySelectorAll('.subagent-card').length === 145);
    assert.equal(await page.getByRole("button", { name: "加载更早的子任务" }).count(), 0);
    await page.getByRole("button", { name: "打开子会话：task-0", exact: true }).click();
    await page.waitForFunction(() => document.body.dataset.opened === "task-0");
    await page.evaluate(() => { (window as unknown as { savedRow: Element | null }).savedRow = document.querySelector('.subagent-card'); });
    f.store.db.prepare("UPDATE tasks SET title='更新后的任务',status='failed',error='private failure' WHERE id='task-144'").run();
    await page.evaluate(revision => (window as unknown as { hint: (n: number) => void }).hint(revision), ++seq);
    await page.getByRole("button", { name: "打开子会话：更新后的任务", exact: true }).waitFor();
    assert.equal(await rows.count(), 145);
    assert.equal(await page.evaluate(() => (window as unknown as { savedRow: Element }).savedRow === document.querySelector('.subagent-card')), true);
    const oldCut = await page.evaluate(() => (window as unknown as { currentCut: string }).currentCut);
    await page.evaluate(() => { delete document.body.dataset.opened; (window as unknown as { reconnect: () => void }).reconnect(); });
    await page.waitForFunction(old => (window as unknown as { currentCut: string }).currentCut !== old && document.querySelectorAll('.subagent-card').length === 145 && !document.querySelector('.subagent-card[aria-busy="true"]'), oldCut);
    await page.getByRole("button", { name: "打开子会话：task-0", exact: true }).click();
    await page.waitForFunction(() => document.body.dataset.opened === "task-0");
    // Off-page task and oldest receipt, although cards started with only the last 64.
    const operation = page.locator('.task-operation');
    await page.waitForFunction(() => document.querySelector('.task-operation')?.getAttribute('aria-busy') === 'false');
    assert.equal(await operation.getAttribute('aria-label'), '追加追问：task-0');
    assert.match(await operation.locator('.task-operation-status').innerText(), /追加失败/);
    assert.equal(commands.some(c => c.op === 'task.window' && ['field', 'fieldInfo'].includes((c.params?.query as {op:string}).op)), false);
    await operation.locator('summary').first().click();
    const errorText = operation.locator('.task-call-error');
    await page.waitForFunction(() => (document.querySelector('.task-operation .task-call-error')?.textContent?.length ?? 0) > 100);
    assert.ok((await errorText.innerText()).length < receiptError.length);
    while (await operation.getByRole('button', {name:'加载更多错误详情'}).count()) {
      const length = (await errorText.textContent())!.length;
      await operation.getByRole('button', {name:'加载更多错误详情'}).click();
      await page.waitForFunction(n => (document.querySelector('.task-operation .task-call-error')?.textContent?.length ?? 0) > n, length);
    }
    assert.equal(await errorText.textContent(), receiptError);
    assert.equal(await operation.getByText('结束后追问', {exact:true}).count(), 1);
    // Receipt updates come from host metadata, not the original tool receipt.
    f.store.db.prepare("UPDATE task_input_receipts SET state='delivered',error=NULL WHERE inputId='receipt-0'").run();
    await page.evaluate(revision => (window as unknown as {hint:(n:number)=>void}).hint(revision), ++seq);
    await page.waitForFunction(() => document.querySelector('.task-operation .task-operation-status')?.textContent === '已送达');
    assert.equal(await errorText.count(), 0);
    // Reconnect with NO delegate card mounted: the operation must acquire its own
    // demand on the same provider, not silently depend on an anchor card's open.
    const operationCut = await page.evaluate(() => (window as unknown as {currentCut:string}).currentCut);
    await page.evaluate(() => { delete document.body.dataset.opened; (window as unknown as {showCards:(show:boolean)=>void}).showCards(false); });
    await page.waitForFunction(() => !document.querySelector('.subagent-card'));
    await page.evaluate(() => (window as unknown as {reconnect:()=>void}).reconnect());
    await page.waitForFunction(old => (window as unknown as {currentCut:string}).currentCut !== old && document.querySelector('.task-operation')?.getAttribute('aria-busy') === 'false', operationCut);
    await operation.getByRole('button', {name:'打开子会话',exact:true}).click();
    await page.waitForFunction(() => document.body.dataset.opened === 'task-0');
    assert.equal(commands.some(c => c.op === "subscribe" && String(c.params?.scope).startsWith("tasks:")), false);
    assert.equal(commands.some(c => ["task.result", "message.get", "message.part"].includes(c.op)), false);
    assert.ok(commands.some(c => c.op === "task.window" && c.params?.query && (c.params.query as { op: string }).op === "target"));
    assert.deepEqual(errors, []);
    if (process.env.AXIOM_VALIDATION_DIR) await page.screenshot({ path: join(process.env.AXIOM_VALIDATION_DIR, "task-cards.png") });
    console.log(`Browser checks: 64/128/145 rows; counts; keyed refresh; reconnect/navigation; off-page operation/old receipt; explicit error chunks; receipt refresh; operation-only reconnect; no legacy task subscription. ${commands.length} simulated commands.`);
  } finally { await browser.close(); windows.close(); }
});
