import { test } from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createProcessOwner, recoverProcessOwner } from "../src/server/process-owner-record.js";
import { forkLinuxOwned, monotonicMilliseconds } from "../src/server/owned-process-linux.js";
import { runRtk } from "../src/server/integrations/rtk-process.js";

test("owner journal persists intent and armed; changed records are never removed", () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-journal-")), path = join(root, "owner.json");
  try {
    const journal = createProcessOwner(path);
    const intent = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(intent.state, "intent");
    assert.equal(recoverProcessOwner(path), false);
    journal.arm({ platform: "win32", workerPid: process.pid });
    assert.equal(JSON.parse(readFileSync(path, "utf8")).state, "armed");
    assert.deepEqual(readdirSync(root), ["owner.json"]);
    assert.throws(() => journal.arm({ platform: "win32", workerPid: process.pid }));
    const armed = readFileSync(path, "utf8");
    writeFileSync(path, JSON.stringify({ ...intent, id: "replacement" }));
    assert.throws(() => journal.confirmed()); assert.ok(existsSync(path));
    writeFileSync(path, armed); journal.confirmed();
    assert.ok(!existsSync(path));
    assert.throws(() => journal.arm({ platform: "win32", workerPid: process.pid }));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("business commands only observe a persisted armed owner", { skip: !["win32", "linux"].includes(process.platform), timeout: 15000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-journal-command-"));
  try {
    const command = "const fs=require('node:fs'); const file=fs.readdirSync('.').find(x=>x.startsWith('.axiom-command-')); process.stdout.write(fs.readFileSync(file,'utf8'));";
    const record = JSON.parse((await runRtk(process.execPath, ["-e", command], { root, timeout: 10000 })).toString());
    assert.equal(record.state, "armed"); assert.equal(record.identity.platform, process.platform);
    assert.deepEqual(readdirSync(root).filter(name => name.startsWith(".axiom-command-")), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

for (const scenario of ["write-failure", "close-before-ready", "close-during-arm"]) {
  test(`Linux admission ${scenario} never starts business`, { skip: process.platform !== "linux", timeout: 15000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), "axiom-journal-gate-")), entry = join(root, "worker.cjs"), marker = join(root, "business");
    writeFileSync(entry, `require('node:fs').writeFileSync(${JSON.stringify(marker)},'started'); setInterval(()=>{},1000);`);
    let entered!: () => void, release!: () => void;
    const entering = new Promise<void>(resolve => { entered = resolve; });
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const journal = createProcessOwner(join(root, "owner.json"));
    const owner = forkLinuxOwned(entry, {}, monotonicMilliseconds() + 7000, undefined, async identity => {
      entered();
      if (scenario === "write-failure") throw Error("disk failed");
      if (scenario === "close-during-arm") await barrier;
      journal.arm(identity);
    });
    try {
      if (scenario === "close-before-ready") await owner.close();
      else if (scenario === "close-during-arm") {
        await entering;
        const closing = owner.close(); release(); await closing;
      }
      await assert.rejects(owner.ready);
      await owner.close();
      assert.ok(!existsSync(marker));
      if (scenario === "write-failure") assert.match(String(owner.failure()), /disk failed/);
      journal.confirmed();
    } finally { release(); await owner.close().catch(() => {}); rmSync(root, { recursive: true, force: true }); }
  });
}

for (const phase of ["intent", "armed"]) test(`Linux restart recovery after host dies in ${phase}`, { skip: process.platform !== "linux", timeout: 20000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-journal-recovery-")), record = join(root, "owner.json"), driver = join(root, "host.mjs"), worker = join(root, "worker.cjs");
  writeFileSync(worker, `process.send('business'); setInterval(()=>{},1000);`);
  writeFileSync(driver, `
import {createProcessOwner} from ${JSON.stringify(new URL("../src/server/process-owner-record.ts", import.meta.url).href)};
import {forkLinuxOwned,monotonicMilliseconds} from ${JSON.stringify(new URL("../src/server/owned-process-linux.ts", import.meta.url).href)};
const journal=createProcessOwner(${JSON.stringify(record)});
${phase === "armed" ? `const owner=forkLinuxOwned(${JSON.stringify(worker)}, {}, monotonicMilliseconds()+15000, undefined, identity=>journal.arm(identity));
owner.child.on('message',()=>process.send('ready')); await owner.ready;` : "process.send('ready');"}
setInterval(()=>{},1000);
`);
  const host = fork(driver, [], { execArgv: ["--import", import.meta.resolve("tsx")], stdio: ["ignore", "ignore", "inherit", "ipc"] });
  const exited = once(host, "exit");
  try {
    const event = await Promise.race([once(host, "message"), exited.then(() => { throw Error("Host fixture exited before readiness"); })]);
    assert.equal(event[0], "ready");
    const live = JSON.parse(readFileSync(record, "utf8"));
    assert.ok(live.host?.view, "fixture requires a verified proc view");
    if (phase === "armed") assert.ok(live.identity?.view);
    assert.equal(recoverProcessOwner(record), false, "an alive host may still commit");
    host.kill("SIGKILL"); await exited;
    const until = Date.now() + 5000;
    while (!recoverProcessOwner(record) && Date.now() < until) await delay(20);
    assert.ok(!existsSync(record), "original host and namespace init must be confirmed absent");
  } finally {
    if (host.exitCode === null && host.signalCode === null) { host.kill("SIGKILL"); await exited; }
    rmSync(root, { recursive: true, force: true });
  }
});
