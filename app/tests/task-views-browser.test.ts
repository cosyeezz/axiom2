import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import { TaskWindows } from "../src/server/task-windows.js";
import type { Command } from "../src/shared/protocol.js";
import { emptyAgent, emptyThread } from "../src/shared/agent.js";
import { emptyTasks } from "../src/shared/tasks.js";
import { taskWindowFixture } from "./fixtures/task-window.js";

test("real task dialog shares the parent cut, reads briefs and old reports in explicit chunks, and retains unknown dialogs", async t => {
  const f = taskWindowFixture(t), windows = new TaskWindows(f.store, () => "d".repeat(64));
  const task = f.task("task-0");
  for (let i = 1; i < 145; i++) f.task(`task-${i}`, i + 1);
  f.store.db.prepare("UPDATE tasks SET anchor='batch',title=id").run();
  const description = "任务目标 😀\n".repeat(12000), report = "报告内容 😀\n".repeat(15000), notes = "未验证附注 😀\n".repeat(10000);
  f.store.db.prepare("UPDATE tasks SET description=?,initialInputId='initial-input' WHERE id=?").run(description, task.id);
  for (let i = 0; i < 145; i++) {
    const result = f.result(task, `result-${i}`, "completed", i === 0 ? report : `交付${i}`);
    if (i === 0) f.store.db.prepare("UPDATE task_results SET body=? WHERE id=?").run(JSON.stringify({ ...result, reportKind: "partial", unfinished: [notes] }), result.id);
  }
  let seq = 0; const commands: Command[] = [];
  const bundle = await build({ stdin: { resolveDir: resolve("."), loader: "tsx", contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {TaskViews} from './src/client/tasks/TaskViews.tsx';
    import {TaskCards,OpenTask} from './src/client/tasks/TaskCards.tsx';
    import {OriginalConversationProvider} from './src/client/chat/OriginalConversation.tsx';
    import {connect} from './src/client/transport.ts';
    const scope=${JSON.stringify(f.scope)};
    window.fetch=async()=>({ok:true});
    class Socket { static OPEN=1;static CONNECTING=0;static CLOSED=3;readyState=0;
      constructor(){window.socket=this;queueMicrotask(()=>{this.readyState=1;this.onopen?.();this.emit({type:'hello',streamId:'fixture'});});}
      emit(data){this.onmessage?.({data:JSON.stringify(data)});}
      send(raw){window.hostCommand(JSON.parse(raw)).then(frames=>{if(this.readyState===1)frames.forEach(frame=>this.emit(frame));});}
      close(){this.readyState=3;this.onclose?.();}
    }
    window.WebSocket=Socket;
    window.hint=revision=>window.socket.emit({type:'snapshot',streamId:'fixture',seq:revision,scope:${JSON.stringify(`task-window:${f.scope.workspaceId}:${f.scope.sessionId}`)},data:{revision}});
    function Open(){const open=React.useContext(OpenTask);window.openTask=open;return <button onClick={()=>open('task-0')}>打开最早任务</button>;}
    function App(){return <TaskViews scope={scope} composer={child=><div data-child-scope={child.sessionId}/> }>
      <OriginalConversationProvider scope={scope}><Open/><TaskCards scope={scope} call={{id:'batch',name:'delegate',input:'{}'}} message={{id:'m',role:'assistant',text:'',streaming:false}}/></OriginalConversationProvider>
    </TaskViews>;}
    createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);void connect();
  ` }, bundle: true, write: false, format: "iife", platform: "browser", loader: { ".svg": "text", ".css": "empty" }, define: { "process.env.NODE_ENV": '"development"' } });
  const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => route.abort());
    await page.exposeFunction("hostCommand", (c: Command) => {
      commands.push(c);
      const receipt = { type: "receipt", requestId: c.requestId, ok: true, data: null as unknown };
      if (c.op === "task.window") return [windows.read({ workspaceId: c.workspaceId!, sessionId: c.sessionId! }, c.requestId, c.params?.query)];
      if (c.op === "agent.history.index") return [{ ...receipt, data: { revision: "empty", segments: [] } }];
      if (c.op === "agent.environment") return [receipt];
      if (c.op === "subscribe") {
        const scope = String(c.params?.scope);
        const data = scope.startsWith("task-window:") ? { revision: seq + 1 } : scope.startsWith("thread:") ? emptyThread :
          scope.startsWith("agent:") ? { ...emptyAgent, task: { id: task.id, parentSessionId: f.scope.sessionId } } :
          scope.startsWith("tasks:") ? emptyTasks : scope === "configuration" ? { available: [] } :
          scope.startsWith("capabilities:") ? { revision: 0, locked: false, legacy: false, selection: null } :
          scope.includes("preferences") ? { revision: 0 } : [];
        return [{ type: "snapshot", streamId: "fixture", seq: ++seq, scope, data }, receipt];
      }
      assert.ok(["unsubscribe", "read.cancel", "ping"].includes(c.op), `Unexpected command ${c.op}`);
      return [receipt];
    });
    const css = ["tokens", "workbench", "chat", "task-calls"].map(name => readFileSync(new URL(`../src/client/styles/${name}.css`, import.meta.url), "utf8")).join("\n");
    await page.route("https://axiom-task-views.test/", route => route.fulfill({ status: 200, contentType: "text/html", body: `<style>${css}</style><div id="root"></div>` }));
    await page.goto("https://axiom-task-views.test/"); await page.addScriptTag({ content: bundle.outputFiles[0].text });
    try {
      await page.waitForFunction(() => document.querySelectorAll('.subagent-card').length === 64, undefined, { timeout: 8000 });
      await page.getByRole("button", { name: "打开最早任务" }).click();
      const dialog = page.getByRole("dialog", { name: "子代理会话" });
      await dialog.locator(`[data-child-scope="${task.sessionId}"]`).waitFor({ state: "attached", timeout: 8000 });
      await page.waitForFunction(() => (document.querySelector('[data-task-brief] [data-task-field="text"] p')?.textContent?.length ?? 0) > 100);
      assert.equal(await dialog.locator('[data-task-result]').count(), 0);
      assert.equal(commands.some(c => c.op === "task.window" && (c.params?.query as { op: string }).op === "results"), false);
      const brief = dialog.locator('[data-task-brief]');
      assert.ok((await brief.locator('[data-task-field="text"] > p').first().textContent())!.length < description.length);
      await dialog.getByRole("button", { name: "任务说明", exact: true }).click();
      while (await brief.getByRole("button", { name: "加载更多任务目标" }).count()) {
        await brief.getByRole("button", { name: "加载更多任务目标" }).click();
        await page.waitForFunction(() => !document.querySelector('[data-task-brief] [data-task-field="text"] [role="status"]'));
      }
      assert.equal(await brief.locator('[data-task-field="text"] > p').first().textContent(), description);
      await dialog.locator('.task-results > details > summary').click();
      await page.waitForFunction(() => document.querySelectorAll('[data-task-result]').length === 64);
      await dialog.getByRole("button", { name: "加载更早的交付" }).click();
      await page.waitForFunction(() => document.querySelectorAll('[data-task-result]').length === 128);
      await dialog.getByRole("button", { name: "加载更早的交付" }).click();
      await page.waitForFunction(() => document.querySelectorAll('[data-task-result]').length === 145);
      await dialog.getByRole("button", { name: "第 1 次 · 已完成", exact: true }).click();
      await page.waitForFunction(() => (document.querySelector('[data-task-report] [data-task-field="text"] .markdown')?.textContent?.length ?? 0) > 100);
      const reportView = dialog.locator('[data-task-report]');
      assert.ok((await reportView.locator('[data-task-field="text"] .markdown').innerText()).length < report.length);
      for (const label of ["报告", "交付附注"]) {
        const button = reportView.getByRole("button", { name: `加载更多${label}`, exact: true });
        while (await button.count()) {
          await button.click();
          await page.waitForFunction(() => !document.querySelector('[data-task-report] [role="status"]'));
        }
      }
      // Markdown renders soft breaks as <br>; textContent omits them. Compare
      // rendered text with innerText, not the original Markdown's DOM text nodes.
      assert.ok((await reportView.locator('[data-task-field="text"] .markdown').innerText()).trim() === report.trim(), "complete rendered report text");
      assert.ok(await reportView.locator('[data-task-field="input"] > p').first().textContent() === `未完成／未验证\n${notes}`, "complete notes text");
      // New metadata cut must rebind report/brief prefixes, not reload an entire
      // report or discard explicitly loaded content and scroll state.
      f.store.db.prepare("UPDATE tasks SET title='任务标题已更新' WHERE id=?").run(task.id);
      await page.evaluate(revision => (window as unknown as { hint: (n: number) => void }).hint(revision), ++seq);
      await dialog.locator('.subagent-dialog-heading strong', { hasText: '任务标题已更新' }).waitFor();
      await page.waitForFunction(() => !document.querySelector('[data-task-report] [role="status"]'));
      assert.ok((await reportView.locator('[data-task-field="text"] .markdown').innerText()).trim() === report.trim(), "refresh retains complete rendered report");
      assert.equal(commands.some(c => c.op === "subscribe" && c.params?.scope === `tasks:${f.scope.workspaceId}:${f.scope.sessionId}`), false);
      assert.equal(commands.some(c => ["task.result", "message.get", "message.part"].includes(c.op)), false);
      await page.evaluate(() => (window as unknown as { openTask: (id: string) => void }).openTask("missing-task"));
      await dialog.getByText("当前窗口未找到任务。", { exact: false }).waitFor();
      assert.equal(await dialog.count(), 1); // No absent-page auto-close.
      await dialog.getByRole("button", { name: "关闭子代理会话，返回主对话" }).click();
      assert.equal(await dialog.count(), 0);
      assert.deepEqual(errors, []);
      if (process.env.AXIOM_VALIDATION_DIR) await page.screenshot({ path: join(process.env.AXIOM_VALIDATION_DIR, "task-dialog.png") });
      console.log(`Task dialog: actual React/AgentThread, bounded parent task reads; 64/128/145 results; explicit brief/report/notes chunks; refresh rebind; missing task remains open; ${commands.length} simulated commands. Child read-receipt legacy subscription retained.`);
    } catch (error) {
      console.error(JSON.stringify({ errors, commands: commands.slice(-25), ui: await page.locator('dialog,button,[role="alert"],[role="status"]').evaluateAll(items => items.map(item => ({ tag: item.tagName, text: item.textContent?.slice(0,100) }))) })); throw error;
    }
  } finally { await browser.close(); windows.close(); }
});
