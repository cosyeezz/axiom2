import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";

const source = (await build({ entryPoints: ["src/client/theme.tsx"], bundle: true, write: false, format: "cjs", platform: "browser", external: ["react", "react/jsx-runtime"], logLevel: "silent" })).outputFiles[0].text;
const delivery = await readFile("desktop/axiom_theme.js", "utf8");
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function fixture(controller: boolean, saved = "light", delivered = true) {
  const store = new Map([["axiom.theme", saved]]);
  const requests: { args: any; resolve: (state: any) => void; reject: (error: unknown) => void }[] = [];
  const window = new EventTarget() as EventTarget & Record<string, any>;
  window.__TAURI_INTERNALS__ = { invoke: (_command: string, args: any) => new Promise((resolve, reject) => requests.push({ args, resolve, reject })) };
  const document = { documentElement: { dataset: {} as Record<string, string>, style: {} }, querySelector: () => null };
  const localStorage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) };
  const module = { exports: {} as { initializeTheme: (controller?: boolean) => void; setTheme: (value: string) => Promise<void>; chooseTheme: (value: string) => Promise<void> } };
  const globals = { window, document, localStorage, module, require: () => ({}), setTimeout, clearTimeout, queueMicrotask, CustomEvent };
  if (!controller && delivered) runInNewContext(delivery, globals);
  runInNewContext(source, globals);
  module.exports.initializeTheme(controller);
  return { window, document, store, requests, api: module.exports };
}

test("startup restoration and rapid controller changes share a serial queue", async () => {
  const f = fixture(true);
  const dark = f.api.setTheme("dark");
  const light = f.api.setTheme("light");
  await tick();
  assert.equal(f.requests.length, 1, "initial restore is the only in-flight write");
  assert.equal(f.requests[0].args.theme, "light");
  f.requests[0].resolve({ theme: "light", revision: 1 });
  await tick();
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[1].args.theme, "dark");
  f.requests[1].resolve({ theme: "dark", revision: 2 });
  await dark;
  await tick();
  assert.equal(f.requests.length, 3);
  f.requests[2].resolve({ theme: "light", revision: 3 });
  await light;
  assert.equal(f.document.documentElement.dataset.theme, "light");
  assert.equal(f.store.get("axiom.theme"), "light");
});

test("controller rejects stale replies and continues after failed writes", async () => {
  const f = fixture(true);
  await tick();
  f.requests[0].resolve({ theme: "light", revision: 4 });
  await tick();
  const stale = f.api.setTheme("dark");
  await tick();
  f.requests[1].resolve({ theme: "dark", revision: 3 });
  await stale;
  assert.equal(f.document.documentElement.dataset.theme, "light");
  assert.equal(f.store.get("axiom.theme"), "light");
  const failed = f.api.setTheme("dark");
  const rejected = assert.rejects(failed, /offline/);
  await tick();
  f.requests[2].reject(Error("offline"));
  await tick();
  // Failure reads authoritative native state to reconcile an uncertain write.
  if (f.requests[3]) f.requests[3].resolve({ theme: "light", revision: 4 });
  await rejected;
  const retry = f.api.setTheme("dark");
  await tick();
  f.requests.at(-1)!.resolve({ theme: "dark", revision: 5 });
  await retry;
  assert.equal(f.document.documentElement.dataset.theme, "dark");
});

test("desktop workbench ignores browser storage changes and old native revisions", async () => {
  const f = fixture(false);
  f.window.__axiomApplyTheme({ theme: "light", revision: 4 });
  f.store.set("axiom.theme", "dark");
  const storage = new Event("storage");
  Object.assign(storage, { key: "axiom.theme" });
  f.window.dispatchEvent(storage);
  await tick();
  assert.equal(f.document.documentElement.dataset.theme, "light");
  await f.api.setTheme("dark");
  assert.equal(f.document.documentElement.dataset.theme, "light");
  f.window.__axiomApplyTheme({ theme: "dark", revision: 3 });
  assert.equal(f.document.documentElement.dataset.theme, "light");
  f.window.__axiomApplyTheme({ theme: "dark", revision: 5 });
  assert.equal(f.document.documentElement.dataset.theme, "dark");
  assert.equal(f.store.get("axiom.theme"), "dark");
  assert.equal(f.requests.length, 0);
});

test("explicit settings choices reach native while newer broadcasts beat delayed replies", async () => {
  const f = fixture(false);
  f.window.__axiomApplyTheme({ theme: "dark", revision: 4 });
  const choice = f.api.chooseTheme("light");
  await tick();
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].args.theme, "light");
  f.window.__axiomApplyTheme({ theme: "light", revision: 5 });
  f.window.__axiomApplyTheme({ theme: "dark", revision: 6 });
  f.requests[0].resolve({ theme: "light", revision: 5 });
  await choice;
  assert.equal(f.document.documentElement.dataset.theme, "dark");
  assert.equal(f.store.get("axiom.theme"), "dark");
  const retry = f.api.chooseTheme("light");
  await tick();
  f.requests[1].resolve({ theme: "light", revision: 7 });
  await retry;
  f.window.__axiomApplyTheme({ theme: "dark", revision: 6 });
  assert.equal(f.document.documentElement.dataset.theme, "light", "late native injection cannot repaint an older theme");
  assert.equal(f.window.__AXIOM_THEME__, "light");
  assert.equal(f.store.get("axiom.theme"), "light");
});

test("workbench in a client without native theme sync falls back to local themes", async () => {
  // Older clients expose Tauri IPC but neither the delivery script nor the axiom_theme command.
  const f = fixture(false, "dark", false);
  const choice = f.api.chooseTheme("light");
  await tick();
  assert.equal(f.requests.length, 1);
  f.requests[0].reject("Command axiom_theme not found");
  await choice;
  assert.equal(f.requests.length, 1, "a missing command is not re-read as an uncertain write");
  assert.equal(f.document.documentElement.dataset.theme, "light");
  assert.equal(f.store.get("axiom.theme"), "light");
  await f.api.chooseTheme("dark");
  assert.equal(f.requests.length, 1, "later choices stay local");
  assert.equal(f.document.documentElement.dataset.theme, "dark");
  f.store.set("axiom.theme", "light");
  const storage = new Event("storage");
  Object.assign(storage, { key: "axiom.theme" });
  f.window.dispatchEvent(storage);
  await tick();
  assert.equal(f.document.documentElement.dataset.theme, "light", "tabs sync like a browser");
});

test("plain-string native failures still reject", async () => {
  const f = fixture(false, "dark", false);
  const choice = f.api.chooseTheme("light");
  const rejected = assert.rejects(choice, { name: "Error", message: "页面来源无效。" });
  await tick();
  f.requests[0].reject("页面来源无效。");
  await tick();
  f.requests[1]?.reject("页面来源无效。");
  await rejected;
  assert.equal(f.document.documentElement.dataset.theme, "dark");
  assert.equal(f.store.get("axiom.theme"), "dark");
});
