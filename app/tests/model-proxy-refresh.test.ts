import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { ModelProxyService } from "../src/server/integrations/model-proxy.js";
import { ProxyProcess } from "../src/server/integrations/model-proxy-process.js";
import { atomicProxyJson, proxyConfigPath, proxyRuntimePath, type ProxyConfig } from "../src/server/integrations/model-proxy-config.js";
import { MaintenanceService } from "../src/server/maintenance.js";
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
async function settle(s: ModelProxyService) { const deadline = Date.now() + 5000; await turn(); while (s.snapshot().job?.running) { assert.ok(Date.now() < deadline); await turn(); } }
function fixture() {
  const root = fs.mkdtempSync(join(tmpdir(), "axiom-proxy-refresh-")), id = randomUUID();
  const config: ProxyConfig = { revision: randomUUID(), installations: { mihomo: { directory: `mihomo-1.0.0-${randomUUID()}`, version: "1.0.0" } }, profiles: [{ id, name: "fixture", kernel: "mihomo", node: "node", source: "https://fixture.invalid/subscription", enabled: true }], bindings: {} };
  atomicProxyJson(proxyConfigPath(root), config);
  return { root, id, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
for (const failure of ["candidate", "publication"]) test(`mihomo refresh ${failure} failure preserves previous running entry`, async t => {
  const f = fixture(), instances: ProxyProcess[] = [], stopped: ProxyProcess[] = [];
  let fail = false, content = "initial";
  t.mock.method(ProxyProcess.prototype, "start", async function(this: ProxyProcess) { instances.push(this); if (fail && failure === "candidate") throw Error("candidate failed"); Object.assign(this.endpoint, { status: "running", port: 12345, token: "fixture" }); });
  t.mock.method(ProxyProcess.prototype, "stop", async function(this: ProxyProcess) { stopped.push(this); this.endpoint.status = "stopped"; });
  const s = new ModelProxyService(f.root, () => {}, { readSource: async () => content, inspectSource: async () => [{ name: "node", type: "fixture" }] });
  const rename = fs.renameSync;
  const mock = t.mock.method(fs, "renameSync", ((source, target) => {
    if (fail && failure === "publication" && String(target) === proxyRuntimePath(f.root)) { fail = false; throw Error("publication failed"); }
    return rename(source, target);
  }) as typeof fs.renameSync); syncBuiltinESMExports();
  try {
    await s.initialize(); const before = fs.readFileSync(proxyRuntimePath(f.root), "utf8");
    fail = true; content = "updated";
    await s.command({ op: "modelProxy.start", requestId: randomUUID(), params: { id: f.id, revision: s.snapshot().revision } }); await settle(s);
    assert.ok(s.snapshot().job?.error); assert.equal(instances.length, 2);
    assert.equal(s.snapshot().profiles[0].status, "running"); assert.equal(stopped.includes(instances[0]), false); assert.ok(stopped.includes(instances[1]));
    assert.equal(fs.readFileSync(proxyRuntimePath(f.root), "utf8"), before);
  } finally { mock.mock.restore(); syncBuiltinESMExports(); await s.close(); f.cleanup(); }
});
test("mihomo periodic refresh skips unchanged bytes, switches verified candidates and cancels on close", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(), instances: ProxyProcess[] = [], stopped: ProxyProcess[] = [];
  let content = "initial", downloads = 0, hold = false, aborted = false;
  t.mock.method(ProxyProcess.prototype, "start", async function(this: ProxyProcess) { instances.push(this); Object.assign(this.endpoint, { status: "running", port: 12345, token: "fixture" }); });
  t.mock.method(ProxyProcess.prototype, "stop", async function(this: ProxyProcess) { stopped.push(this); this.endpoint.status = "stopped"; });
  const history = new MaintenanceService(f.root);
  const s = new ModelProxyService(f.root, () => {}, {
    readSource: async (_url, signal) => { downloads++; if (hold) await new Promise<void>((_done, reject) => signal.addEventListener("abort", () => { aborted = true; reject(signal.reason); }, { once: true })); return content; },
    inspectSource: async () => [{ name: "node", type: "fixture" }],
  });
  try {
    await s.initialize(); assert.equal(instances.length, 1);
    t.mock.timers.tick(3_600_000); await settle(s); assert.equal(downloads, 2); assert.equal(instances.length, 1);
    content = "changed"; t.mock.timers.tick(3_600_000); await settle(s);
    assert.equal(instances.length, 2); assert.deepEqual(stopped, [instances[0]]); assert.equal(s.snapshot().profiles[0].status, "running");
    // Component standard: no history; each refresh replaces the previous record for this resource.
    const tasks = history.snapshot().tasks; assert.equal(tasks.length, 1); assert.equal(tasks[0].status, "succeeded");
    hold = true; t.mock.timers.tick(3_600_000); await turn(); assert.equal(downloads, 4);
    await s.close(); assert.equal(aborted, true); assert.equal(history.snapshot().tasks.at(-1)!.status, "cancelled");
    t.mock.timers.tick(7_200_000); await turn(); assert.equal(downloads, 4); assert.equal(instances.length, 2);
  } finally { await s.close(); history.close(); f.cleanup(); }
});
