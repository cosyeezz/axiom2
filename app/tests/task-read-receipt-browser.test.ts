import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { emptyAgent } from "../src/shared/agent.js";
import type { Command } from "../src/shared/protocol.js";
import type { TaskWindowQuery } from "../src/shared/task-window.js";
import { TaskWindows } from "../src/server/task-windows.js";
import { taskWindowFixture } from "./fixtures/task-window.js";

test("read receipt waits for all current-cut pairs and rechecks visibility after asynchronous proof", async t => {
  const f = taskWindowFixture(t), task = f.task("receipt-task"), windows = new TaskWindows(f.store, () => "d".repeat(64)); t.after(() => windows.close());
  const references = Array.from({ length: 65 }, (_, i) => {
    const result = f.result(task, `receipt-${i}`);
    f.store.db.prepare("INSERT INTO session_results(sessionId,sourceId,kind,version) VALUES(?,?,'task',?)").run(f.scope.sessionId, result.id, i + 1);
    return { taskId: task.id, resultId: result.id };
  });
  f.store.db.prepare("UPDATE sessions SET resultVersion=65 WHERE id=?").run(f.scope.sessionId);
  const index = { ids: ["m"], groups: [], resultVersion: 65, readVersion: 0, resultTasks: references };
  const commands: Command[] = [], held: { revision: string; release: () => void }[] = [];
  const ready: (() => void)[] = [], waits = [0, 1].map(() => new Promise<void>(resolve => ready.push(resolve))); let seq = 0;
  const gate = async (index: number) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([waits[index], new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`membership gate ${index} not reached`)), 5000); })]); }
    finally { clearTimeout(timer); }
  };
  const bundle = await build({ stdin: { resolveDir: resolve("."), loader: "tsx", contents: `
    import React,{useRef,useState} from 'react';import {createRoot} from 'react-dom/client';
    import {useReadReceipt} from './src/client/chat/useReadReceipt.ts';
    import {TaskWindowProvider} from './src/client/tasks/TaskWindowProvider.tsx';
    import {useScope,connect} from './src/client/transport.ts';import {agentScope,threadScope,messageScope,emptyAgent} from './src/shared/agent.ts';
    window.fetch=async()=>({ok:true});window.proofs=[];
    class Socket{static OPEN=1;static CONNECTING=0;static CLOSED=3;readyState=0;
      constructor(){window.socket=this;queueMicrotask(()=>{this.readyState=1;this.onopen?.();this.emit({type:'hello',streamId:'fixture'});});}
      emit(frame){if(frame.type==='receipt'&&frame.ok&&frame.data?.kind==='membership')window.proofs.push(frame.data.revision);this.onmessage?.({data:JSON.stringify(frame)});}
      send(raw){window.hostCommand(JSON.parse(raw)).then(frames=>{if(this.readyState===1)frames.forEach(frame=>this.emit(frame));});}
      close(){this.readyState=3;this.onclose?.();}}
    window.WebSocket=Socket;const scope=${JSON.stringify(f.scope)},empty={ids:[],groups:[]};
    function Probe(){const ref=useRef(null),[blocked,setBlocked]=useState(false);window.block=setBlocked;
      const index=useScope(threadScope(scope),empty),info=useScope(agentScope(scope),emptyAgent),message=useScope(messageScope(scope,'m'),null);
      useReadReceipt(scope,index,info,true,ref);
      return <><div ref={ref} data-view style={{height:80,width:360,overflow:'auto'}}>{message?.text}</div>
        {blocked&&<div data-overlay style={{position:'fixed',inset:0,zIndex:100,background:'#ddd'}}>covered</div>}</>;}
    createRoot(document.getElementById('root')).render(<React.StrictMode><TaskWindowProvider scope={scope}><Probe/></TaskWindowProvider></React.StrictMode>);void connect();
  ` }, bundle: true, write: false, format: "iife", platform: "browser", loader: { ".svg": "text", ".css": "empty" }, define: { "process.env.NODE_ENV": '"development"' } });
  const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  const page = await browser.newPage(); const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  try {
    await page.route("**/*", route => route.abort());
    await page.exposeFunction("hostCommand", async (c: Command) => {
      commands.push(c); const receipt = { type: "receipt", requestId: c.requestId, ok: true, data: null };
      if (c.op === "subscribe") {
        const scope = String(c.params?.scope), data = scope.startsWith("thread:") ? index : scope.startsWith("agent:") ? emptyAgent
          : scope.startsWith("messages:") ? [{ id: "m", role: "assistant", text: "painted result", status: "completed", streaming: false }] : undefined;
        return data ? [{ type: "snapshot", streamId: "fixture", seq: ++seq, scope, data }, receipt] : [receipt];
      }
      if (c.op === "task.window") {
        const query = c.params?.query as TaskWindowQuery, reply = windows.read(f.scope, c.requestId, query);
        if (query.op === "hasResults" && query.references.length === 1)
          await new Promise<void>(release => { held.push({ revision: query.revision, release }); ready[held.length - 1]?.(); });
        return [reply];
      }
      assert.ok(["session.read", "unsubscribe", "read.cancel", "ping"].includes(c.op), `unexpected ${c.op}`); return [receipt];
    });
    await page.route("https://axiom-read-receipt.test/", route => route.fulfill({ status: 200, contentType: "text/html", body: '<div id="root"></div>' }));
    await page.goto("https://axiom-read-receipt.test/"); await page.bringToFront(); await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const reads = () => commands.filter(c => c.op === "session.read");
    await gate(0); assert.equal(reads().length, 0, "first 64 pairs cannot prove all 65");
    await page.evaluate(frame => (window as unknown as {socket:{emit:(value:unknown)=>void}}).socket.emit(frame), {
      type: "snapshot", streamId: "fixture", seq: ++seq, scope: `task-window:${f.scope.workspaceId}:${f.scope.sessionId}`, data: { revision: 1 },
    });
    await gate(1); assert.notEqual(held[0].revision, held[1].revision);
    held[0].release();
    const delivered = (revision: string) => page.waitForFunction(value => (window as unknown as {proofs:string[]}).proofs.filter(revision => revision === value).length >= 3, revision);
    await delivered(held[0].revision); assert.equal(reads().length, 0, "late complete old proof cannot acknowledge the replacement cut");
    await page.evaluate(() => (window as unknown as {block:(value:boolean)=>void}).block(true)); await page.locator('[data-overlay]').waitFor();
    held[1].release(); await delivered(held[1].revision);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    assert.equal(reads().length, 0, "proof completion must recheck occlusion, not reuse its initial visible state");
    await page.evaluate(() => (window as unknown as {block:(value:boolean)=>void}).block(false)); await page.locator('[data-overlay]').waitFor({ state: "detached" });
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForFunction(() => document.querySelector('[data-view]')?.textContent === 'painted result');
    // Drain the simulated receipt round trip without waiting for the one-second retry.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    assert.equal(reads().length, 1);
    assert.equal(reads()[0].params?.throughVersion, 65);
    assert.equal(reads()[0].sessionId, f.scope.sessionId);
    assert.equal(commands.some(c => c.op === "subscribe" && String(c.params?.scope).startsWith("tasks:")), false);
    assert.deepEqual(errors, []);
  } catch (error) {
    console.log(JSON.stringify({ errors, commands: commands.map(c => ({op:c.op,query:c.params?.query,scope:c.params?.scope})), body: await page.locator('body').innerText() })); throw error;
  } finally { held.forEach(item => item.release()); await browser.close(); }
});
