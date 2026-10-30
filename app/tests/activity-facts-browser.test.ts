import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { messageScope, type ChatMessage } from "../src/shared/agent.js";
import type { Command } from "../src/shared/protocol.js";
import { TaskWindows } from "../src/server/task-windows.js";
import { taskWindowFixture } from "./fixtures/task-window.js";

test("activity hook uses full anchor counts and releases masked, removed and disconnected task leases", async t => {
  const f = taskWindowFixture(t), windows = new TaskWindows(f.store, () => "f".repeat(64)); t.after(() => windows.close());
  for (let i = 0; i < 145; i++) f.task(`facts-${i}`, i);
  f.store.db.prepare("UPDATE tasks SET anchor='batch'").run();
  f.store.db.prepare("UPDATE tasks SET status='running' WHERE id='facts-0'").run();
  const calls = [{ id: "batch", name: "delegate", input: "{}" }, { id: "plain", name: "read", input: "{}" }];
  let message: ChatMessage = { id: "m", role: "assistant", text: "", thinking: "thought", status: "completed", calls };
  const results = new Map(calls.map(call => [messageScope(f.scope, `tool-${call.id}`), {
    id: `tool-${call.id}`, role: "toolResult", text: "{}", status: "completed",
  }]));
  const commands: Command[] = []; let seq = 0, revision = 0, offPageWitness = false;
  let opening: Promise<void> | null = null, release: (() => void) | undefined;
  const bundle = await build({ stdin: { resolveDir: resolve("."), loader: "tsx", contents: `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
    import {useActivityFacts} from './src/client/chat/ActivityFacts.tsx';
    import {TaskWindowProvider,useTaskWindowModel} from './src/client/tasks/TaskWindowProvider.tsx';import {connect} from './src/client/transport.ts';
    window.fetch=async()=>({ok:true});
    class Socket{static OPEN=1;static CONNECTING=0;static CLOSED=3;readyState=0;
      constructor(){window.socket=this;queueMicrotask(()=>{this.readyState=1;this.onopen?.();this.emit({type:'hello',streamId:'fixture'});});}
      emit(frame){this.onmessage?.({data:JSON.stringify(frame)});}
      send(raw){window.hostCommand(JSON.parse(raw)).then(frames=>frames.forEach(frame=>this.emit(frame)));}
      close(){this.readyState=3;this.onclose?.();}}
    window.WebSocket=Socket;window.reconnect=()=>{window.socket.close();void connect();};const scope=${JSON.stringify(f.scope)};
    function Probe(){const [thinking,setThinking]=useState(false);window.mask=setThinking;
      const model=useTaskWindowModel(scope);window.taskFrame=()=>model?.snapshot('batch');
      const facts=useActivityFacts(scope,['m'],thinking?['m']:[]);
      return <div data-probe>{facts.map(([id,fact])=><output key={id} data-id={id}>{fact.status}</output>)}</div>;}
    function App(){const [shown,setShown]=useState(true);window.show=setShown;
      return <TaskWindowProvider scope={scope}>{shown&&<Probe/>}</TaskWindowProvider>;}
    createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);void connect();
  ` }, bundle: true, write: false, format: "iife", platform: "browser", loader: { ".svg": "text", ".css": "empty" }, define: { "process.env.NODE_ENV": '"development"' } });
  const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  const page = await browser.newPage(); const errors: string[] = []; page.on("pageerror", error => errors.push(error.message)); page.setDefaultTimeout(5000);
  try {
    await page.route("**/*", route => route.abort());
    await page.exposeFunction("hostCommand", async (c: Command) => {
      commands.push(c); const receipt = { type: "receipt", requestId: c.requestId, ok: true, data: null };
      if (c.op === "subscribe") {
        // messageScope is a local selector; transport still subscribes to the
        // legacy messages collection until the canonical body migration.
        const scope = String(c.params?.scope), data = scope === `messages:${f.scope.workspaceId}:${f.scope.sessionId}`
          ? [message, ...results.values()] : scope === messageScope(f.scope, "m") ? message : results.get(scope);
        return data ? [{ type: "snapshot", streamId: "fixture", seq: ++seq, scope, data }, receipt] : [receipt];
      }
      if (c.op === "task.window") {
        if ((c.params?.query as {op:string}).op === "open" && opening) await opening;
        const reply = windows.read(f.scope, c.requestId, c.params?.query);
        if (reply.ok) {
          const data = reply.data as {kind?:string;counts?:{running:number};items?:{status:string}[]};
          if (data.kind === "tasks" && data.counts?.running === 1 && data.items?.length === 64 && data.items.every(item => item.status === "completed")) offPageWitness = true;
        }
        return [reply];
      }
      assert.ok(["unsubscribe", "read.cancel", "ping"].includes(c.op), `unexpected ${c.op}`); return [receipt];
    });
    await page.route("https://axiom-activity-facts.test/", route => route.fulfill({ status: 200, contentType: "text/html", body: '<div id="root"></div>' }));
    await page.goto("https://axiom-activity-facts.test/"); await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const status = (expected: string) => page.waitForFunction(value => document.querySelector('[data-id="batch"]')?.textContent === value, expected, { timeout: 5000 });
    const hint = () => page.evaluate(data => (window as unknown as {socket:{emit:(frame:unknown)=>void}}).socket.emit(data), {
      type: "snapshot", streamId: "fixture", seq: ++seq, scope: `task-window:${f.scope.workspaceId}:${f.scope.sessionId}`, data: { revision: ++revision },
    });
    const publish = () => page.evaluate(data => (window as unknown as {socket:{emit:(frame:unknown)=>void}}).socket.emit(data), {
      type: "snapshot", streamId: "fixture", seq: ++seq, scope: messageScope(f.scope, "m"), data: message,
    });
    const reads = () => commands.filter(c => c.op === "task.window").length;
    await status("running"); assert.ok(offPageWitness);
    assert.equal(await page.locator('[data-id="plain"]').textContent(), "completed");
    f.store.db.prepare("UPDATE tasks SET status='future-status' WHERE id='facts-0'").run(); await hint(); await status("unknown");
    await page.waitForFunction(() => { const frame = (window as unknown as {taskFrame:()=>{current:boolean;page?:{counts:{unknown:number}}}}).taskFrame();
      return frame?.current && frame.page?.counts.unknown === 1; });
    message = { ...message, calls: [calls[1]] }; await publish(); await page.locator('[data-id="batch"]').waitFor({ state: "detached" });
    const removed = reads(); f.store.db.prepare("UPDATE tasks SET status='completed'").run(); await hint(); await page.waitForTimeout(350);
    assert.equal(reads(), removed, "removed task call must release the only anchor demand");
    message = { ...message, calls }; await publish(); await status("completed");
    assert.ok(reads() > removed, "reacquiring after an inactive hint must not reuse the invalidated cut");
    await page.evaluate(() => (window as unknown as {mask:(value:boolean)=>void}).mask(true));
    await page.locator('[data-id="batch"]').waitFor({ state: "detached" });
    const masked = reads(); await hint(); await page.waitForTimeout(350); assert.equal(reads(), masked, "thinking-only mask releases task demand");
    await page.evaluate(() => (window as unknown as {mask:(value:boolean)=>void}).mask(false)); await status("completed");
    const beforeReconnect = commands.filter(c => c.op === "task.window" && (c.params?.query as {op:string}).op === "open").length;
    opening = new Promise<void>(resolve => { release = resolve; });
    await page.evaluate(() => (window as unknown as {reconnect:()=>void}).reconnect()); await status("unknown");
    release!(); opening = null; await status("completed");
    assert.ok(commands.filter(c => c.op === "task.window" && (c.params?.query as {op:string}).op === "open").length > beforeReconnect);
    await page.evaluate(() => (window as unknown as {show:(value:boolean)=>void}).show(false)); await page.locator('[data-probe]').waitFor({ state: "detached" });
    const unmounted = reads(); await hint(); await page.waitForTimeout(350); assert.equal(reads(), unmounted);
    assert.equal(commands.some(c => c.op === "subscribe" && String(c.params?.scope).startsWith("tasks:")), false);
    assert.deepEqual(errors, []);
  } catch (error) {
    console.log(JSON.stringify({ errors, commands: commands.map(c => ({ op: c.op, scope: c.params?.scope, query: c.params?.query })), body: await page.locator('body').innerText() })); throw error;
  } finally { release?.(); await browser.close(); }
});
