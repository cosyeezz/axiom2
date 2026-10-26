// Test-only SDK fault injection. The production worker is imported unchanged.
import { AgentSession } from "@earendil-works/pi-coding-agent";
import { Worker } from "node:worker_threads";
const original = AgentSession.prototype.sendCustomMessage;
const postImage = Worker.prototype.postMessage;
const releases = new Map<string, () => void>();
let imageBarrier: string | undefined;
process.on("message", (event: any) => {
  if (event.type === "fixture-hold-images") imageBarrier = event.id;
  if (event.type === "fixture-release") releases.get(event.id)?.();
});
Worker.prototype.postMessage = function (value, transfer) {
  if (!imageBarrier || !value?.inputBytes || !value?.mimeType) return postImage.call(this, value, transfer);
  const id = imageBarrier; imageBarrier = undefined;
  releases.set(id, () => {
    releases.delete(id);
    this.once("message", () => process.send?.({ type: "fixture-image-prepared", id }));
    postImage.call(this, value, transfer);
  });
  process.send?.({ type: "fixture-preparing-image", id });
};
AgentSession.prototype.sendCustomMessage = async function (message, options) {
  if (message.customType !== "axiom-append") return original.call(this, message, options);
  const text = typeof message.content === "string" ? message.content : JSON.stringify(message.content);
  if (text.includes("WAIT-REJECT")) {
    const id = (message.details as any).axiomInput;
    process.send?.({ type: "fixture-submitting", id });
    await new Promise<void>(resolve => releases.set(id, resolve));
    releases.delete(id);
    throw Error("fixture rejected before submission");
  }
  if (text.includes("UNKNOWN-SUBMISSION")) {
    const agent = this.agent as any, descriptor = Object.getOwnPropertyDescriptor(agent, "steeringQueue")!;
    Object.defineProperty(agent, "steeringQueue", { configurable: true, get() {
      Object.defineProperty(agent, "steeringQueue", descriptor);
      throw Error("fixture cannot inspect queue retention");
    } });
    throw Error("fixture submission outcome unknown");
  }
  if (text.includes("REJECT-BEFORE")) throw Error("fixture rejected before submission");
  await original.call(this, message, options);
  if (text.includes("THROW-AFTER")) throw Error("fixture threw after successful submission");
};
await import(process.env.AXIOM_TEST_COMPILED ? "../dist/server/agent-worker.js" : "../src/server/agent-worker.js");
