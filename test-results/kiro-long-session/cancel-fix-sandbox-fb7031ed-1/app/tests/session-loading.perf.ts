// Structural performance samples only; no old-build or desktop latency claim.
import { performance } from "node:perf_hooks";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { subscribeScope } from "../src/client/transport.js";
import { messageFacts } from "../src/client/chat/ActivityFacts.js";
import { emptyTasks } from "../src/shared/tasks.js";
import type { ChatMessage } from "../src/shared/agent.js";

const report: unknown[] = [];
function measure(name: string, count: number, action: () => void) {
  for (let i = 0; i < 3; i++) action();
  const samples = Array.from({ length: 30 }, () => { const start = performance.now(); action(); return performance.now() - start; }).sort((a, b) => a - b);
  report.push({ name, count, samples: samples.length, p50Ms: samples[14], p95Ms: samples[28], maxMs: samples[29] });
}
for (const count of [100, 1000, 5000]) {
  measure("subscribe/unsubscribe", count, () => {
    const stops = Array.from({ length: count }, (_, i) => subscribeScope(`message:structural:session:m${i}`, () => {}));
    for (const stop of stops) stop();
  });
  const message: ChatMessage = { id: "m", role: "assistant", text: "", status: "completed", calls:
    Array.from({ length: count }, (_, i) => ({ id: `call${i}`, name: "read", input: '{}' })) };
  let lookups = 0;
  measure("bulk facts", count, () => {
    lookups = 0;
    messageFacts(message, 0, () => { lookups++; return null; }, emptyTasks);
    if (lookups !== count) throw Error(`nonlinear result lookups: ${lookups}`);
  });
  report.push({ name: "fact result lookups", count, lookups });
  await Promise.resolve();
}
const dir = resolve("test-results/session-loading"); mkdirSync(dir, { recursive: true });
const output = { runtime: process.version, platform: process.platform, mode: "tsx / Node; pure initialization, no browser or provider", report };
writeFileSync(resolve(dir, "structural-performance.json"), JSON.stringify(output, null, 2));
console.log(JSON.stringify(output, null, 2));
