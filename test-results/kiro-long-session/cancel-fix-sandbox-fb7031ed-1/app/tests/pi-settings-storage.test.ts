import assert from "node:assert/strict";
import { test } from "node:test";
import { fork } from "node:child_process";
import { existsSync, linkSync, lstatSync, symlinkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { tmpdir } from "./temporary.js";
import { Store } from "../src/server/storage.js";
import { Resources } from "../src/server/resources.js";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import "../src/server/pi-settings-storage.js";

const sdk = new URL("./core/settings-manager.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href;
const bridge = new URL("../src/server/pi-settings-storage.ts", import.meta.url).href;

for (const initial of ["missing", "existing"]) test(`SDK ${initial} settings are locked before the callback and merge with an independent Resources writer`, { timeout: 15000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-settings-lock-")), agent = join(root, "pi");
  const path = join(agent, "settings.json"), ready = join(root, "ready"), release = join(root, "release"), script = join(root, "writer.mjs");
  mkdirSync(agent, { recursive: true });
  if (initial === "existing") writeFileSync(path, JSON.stringify({ preserved: "original" }));
  writeFileSync(script, `
import fs from 'node:fs';
await import(${JSON.stringify(bridge)});
const { FileSettingsStorage } = await import(${JSON.stringify(sdk)});
const storage = new FileSettingsStorage(${JSON.stringify(root)}, ${JSON.stringify(agent)});
storage.withLock('global', raw => {
  fs.writeFileSync(${JSON.stringify(ready)}, JSON.stringify({ existed: raw !== undefined }));
  const end = Date.now() + 10000, sleep = new Int32Array(new SharedArrayBuffer(4));
  while (!fs.existsSync(${JSON.stringify(release)})) {
    if (Date.now() >= end) throw Error('release barrier timed out');
    Atomics.wait(sleep, 0, 0, 10);
  }
  return JSON.stringify({ ...(raw ? JSON.parse(raw) : {}), packages: ['npm:fixture-from-sdk'] });
});
`);
  const store = new Store(root), resources = new Resources(store, join(root, "shared-pi"), () => {}, async () => {});
  const child = fork(script, [], { execArgv: ["--import", import.meta.resolve("tsx")], stdio: ["ignore", "ignore", "pipe", "ipc"] });
  let diagnostics = ""; child.stderr!.on("data", data => { diagnostics += data; });
  const exited = new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
  try {
    const deadline = Date.now() + 10000;
    while (!existsSync(ready) && child.exitCode === null && Date.now() < deadline) await delay(10);
    assert.ok(existsSync(ready), diagnostics);
    assert.equal(JSON.parse(readFileSync(ready, "utf8")).existed, initial === "existing");
    assert.throws(() => (resources as any).editSettings(path, (current: Record<string, unknown>) => { current.skills = ["must-not-overwrite"]; }), { code: "RESOURCE_BUSY" });
    assert.equal(existsSync(path), initial === "existing");
    writeFileSync(release, "go");
    assert.equal(await exited, 0, diagnostics);
    (resources as any).editSettings(path, (current: Record<string, unknown>) => { current.skills = ["resource-skill"]; });
    const result = JSON.parse(readFileSync(path, "utf8"));
    assert.deepEqual(result.packages, ["npm:fixture-from-sdk"]); assert.deepEqual(result.skills, ["resource-skill"]);
    if (initial === "existing") assert.equal(result.preserved, "original");
    assert.equal(existsSync(path + ".lock"), false);
  } finally {
    writeFileSync(release, "go"); await exited;
    await resources.close(); store.close(); rmSync(root, { recursive: true, force: true });
  }
});

test("a missing-file SDK read runs the callback once without inventing a settings file", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-settings-read-"));
  try {
    const { FileSettingsStorage } = await import(sdk);
    const storage = new FileSettingsStorage(root, join(root, "pi"));
    let count = 0;
    storage.withLock("global", (raw: string | undefined) => { count++; assert.equal(raw, undefined); return undefined; });
    assert.equal(count, 1); assert.equal(existsSync(join(root, "pi", "settings.json")), false);
    assert.equal(existsSync(join(root, "pi", "settings.json.lock")), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

for (const alias of ["directory", "hardlink"]) test(`SDK discovery reads ${alias} aliases but flush rejects writes without changing configuration`, async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-settings-alias-"));
  try {
    const actual = join(root, "actual"), agent = join(root, "pi");
    mkdirSync(actual); writeFileSync(join(actual, "settings.json"), '{"defaultProvider":"original"}\n');
    if (alias === "directory") symlinkSync(actual, agent, process.platform === "win32" ? "junction" : "dir");
    else { mkdirSync(agent); linkSync(join(actual, "settings.json"), join(agent, "settings.json")); }
    const settings = SettingsManager.create(root, agent);
    assert.deepEqual(settings.drainErrors(), []); assert.equal(settings.getDefaultProvider(), "original");
    settings.setDefaultProvider("replacement"); await settings.flush();
    const errors = settings.drainErrors(); assert.equal(errors.length, 1);
    assert.match(String(errors[0].error), /链接/);
    assert.equal(readFileSync(join(actual, "settings.json"), "utf8"), '{"defaultProvider":"original"}\n');
    assert.equal(readFileSync(join(agent, "settings.json"), "utf8"), '{"defaultProvider":"original"}\n');
    assert.deepEqual(settings.drainErrors(), []);
    assert.equal(existsSync(join(actual, "settings.json.lock")), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("SDK failed callbacks release the lock and a later atomic write preserves unrelated settings", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-settings-failure-")), agent = join(root, "pi"), path = join(agent, "settings.json");
  mkdirSync(agent); writeFileSync(path, '{"preserved":true}\n');
  try {
    const { FileSettingsStorage } = await import(sdk), storage = new FileSettingsStorage(root, agent);
    let callbacks = 0;
    assert.throws(() => storage.withLock("global", () => { callbacks++; throw Error("callback failed"); }), /callback failed/);
    assert.equal(callbacks, 1); assert.equal(readFileSync(path, "utf8"), '{"preserved":true}\n');
    assert.throws(() => storage.withLock("global", () => 42), /无效内容/);
    const settings = SettingsManager.create(root, agent);
    settings.setDefaultProvider("saved"); await settings.flush(); assert.deepEqual(settings.drainErrors(), []);
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { preserved: true, defaultProvider: "saved" });
    assert.deepEqual(readdirSync(agent), ["settings.json"]);
    if (process.platform !== "win32") assert.equal(lstatSync(path).mode & 0o777, 0o600);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
