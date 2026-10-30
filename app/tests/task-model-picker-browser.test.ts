import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import type { Command } from "../src/shared/protocol.js";
import { emptyAgent } from "../src/shared/agent.js";

/** Isolated browser socket fixture. No server, SQL, credentials or model runtime. */
test("default child model reads scalar preferences, preserves unknown, and saves without a full task-list response", async () => {
  const commands: Command[] = []; let seq = 0;
  const bundle = await build({ stdin: { resolveDir: resolve("."), loader: "tsx", contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {ModelPicker} from './src/client/chat/ModelPicker.tsx';import {connect} from './src/client/transport.ts';
    window.fetch=async()=>({ok:true});
    class Socket{static OPEN=1;static CONNECTING=0;static CLOSED=3;readyState=0;
      constructor(){window.socket=this;queueMicrotask(()=>{this.readyState=1;this.onopen?.();this.emit({type:'hello',streamId:'fixture'});});}
      emit(frame){this.onmessage?.({data:JSON.stringify(frame)});}
      send(raw){window.hostCommand(JSON.parse(raw)).then(frames=>frames.forEach(frame=>this.emit(frame)));}
      close(){this.readyState=3;this.onclose?.();}}
    window.WebSocket=Socket;
    createRoot(document.getElementById('root')).render(<React.StrictMode><ModelPicker childDefault scope={{workspaceId:'w',sessionId:'s'}}/></React.StrictMode>);void connect();
  ` }, bundle: true, write: false, format: "iife", platform: "browser", loader: { ".svg": "text", ".css": "empty" }, define: { "process.env.NODE_ENV": '"development"' } });
  const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  try {
    const page = await browser.newPage(); const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => route.abort());
    await page.exposeFunction("hostCommand", (c: Command) => {
      commands.push(c); const receipt = { type: "receipt", requestId: c.requestId, ok: true, data: null };
      if (c.op === "subscribe") {
        const scope = String(c.params?.scope);
        if (scope === "task-preferences") return [receipt]; // Deliberately withhold authority.
        const data = scope === "configuration" ? { revision: "x", available: [], providerCount: 0, modelCount: 0, dataRoot: "" } : scope.startsWith("agent:") ? emptyAgent : [];
        return [{ type: "snapshot", streamId: "fixture", seq: ++seq, scope, data }, receipt];
      }
      assert.ok(["task.preferences", "unsubscribe", "read.cancel", "ping"].includes(c.op), `unexpected ${c.op}`);
      return [receipt];
    });
    await page.route("https://axiom-task-model.test/", route => route.fulfill({ status: 200, contentType: "text/html", body: '<div id="root"></div>' }));
    await page.goto("https://axiom-task-model.test/"); await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const picker = page.locator('.model-picker > summary');
    await picker.getByText("默认子模型待同步", { exact: false }).waitFor();
    assert.equal(await picker.getAttribute("aria-disabled"), "true");
    await picker.click({ force: true }); assert.equal(await page.locator('.model-popover').count(), 0);
    await page.evaluate(revision => (window as unknown as {socket:{emit:(data:unknown)=>void}}).socket.emit({ type: "snapshot", streamId: "fixture", seq: revision,
      scope: "task-preferences", data: { selection: { provider: "fixture-provider", id: "fixture-model", thinking: "off" }, budgets: { concurrency: 4, workMs: 600000 } } }), ++seq);
    await picker.getByText("fixture-model", { exact: false }).waitFor();
    assert.equal(await picker.getAttribute("aria-disabled"), null);
    await picker.click(); await page.locator('.model-option').first().click();
    await page.getByRole("button", { name: "确认模型设置" }).click();
    await page.waitForFunction(() => !document.querySelector('.model-picker[open]'));
    assert.ok(commands.some(c => c.op === "task.preferences" && c.params?.selection === null));
    assert.equal(commands.some(c => c.op === "task.default-model" || c.op === "subscribe" && String(c.params?.scope).startsWith("tasks:")), false);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
