import { setPriority } from "node:os";
import { UsageSidecarEngine } from "./usage-sidecar-engine.js";

// This process has its own event loop, read-only source connection and disposable derived writer.
try { setPriority(0, 19); } catch { /* Unsupported platforms still retain bounded slices and sleeps. */ }
let engine: UsageSidecarEngine | undefined;
let closing = false;
function send(value: unknown) { if (process.connected) process.send?.(value as any, () => {}); }
async function close() {
  if (closing) return;
  closing = true;
  const force = setTimeout(() => process.exit(0), 1200); force.unref();
  try { await engine?.close(); } finally { process.exit(0); }
}
process.on("disconnect", () => void close());
process.on("SIGTERM", () => void close());
process.on("message", (message: any) => {
  if (closing || !message || typeof message !== "object") return;
  if (message.type === "close") { void close(); return; }
  if (message.type === "init") {
    if (engine) return;
    try {
      engine = new UsageSidecarEngine(message.root, message.modelsDir, message.options);
      engine.start(); send({ type: "ready" });
    } catch { void close(); }
    return;
  }
  if (message.type !== "read" || !engine) return;
  try { send({ type: "result", id: message.id, value: engine.read(message.params, message.kind) }); }
  catch (error) {
    const value = error as { code?: string; message?: string };
    send({ type: "result", id: message.id, error: { code: value.code ?? "INVALID_INPUT", message: value.code ? value.message : "后台统计暂不可用，请稍后重试。" } });
  }
});
