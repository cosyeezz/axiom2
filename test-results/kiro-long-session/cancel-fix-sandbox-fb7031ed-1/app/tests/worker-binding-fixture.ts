import { EventEmitter } from "node:events";

// Test-only transport scheduling: preserve real IPC contents and delivery order,
// but dispatch a batch before any promise continuation can run between messages.
process.on("message", (event: any) => {
  if (event.type === "fixture-ipc-batch")
    for (const message of event.messages) EventEmitter.prototype.emit.call(process, "message", message);
});
await import(process.env.AXIOM_TEST_COMPILED ? "../dist/server/agent-worker.js" : "../src/server/agent-worker.js");
export {};
