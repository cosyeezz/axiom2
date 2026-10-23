import { LatencyBuffer, type DeliveryTiming, type LatencyRecord } from "../shared/latency.js";

export const browserLatency = new LatencyBuffer();
const deliveries = new WeakMap<object, { record: LatencyRecord; received: number; committed: boolean }>();
export function receiveDelivery(data: unknown, timing: DeliveryTiming, streamId: string, seq: number, received = performance.now(), parseMs = 0) {
  if (!data || typeof data !== "object") return;
  const record = { runId: timing.runId, requestId: timing.requestId, updateId: timing.updateId, streamId, seq,
    connectionId: timing.connectionId, stage: "browser.receive", at: Date.now(), durationMs: parseMs };
  browserLatency.add(record);
  deliveries.set(data, { record, received, committed: false });
}
/** Called from React's layout effect, after this exact message object commits. */
export function commitDelivery(data: unknown) {
  if (!data || typeof data !== "object") return;
  const delivery = deliveries.get(data);
  if (!delivery || delivery.committed) return;
  delivery.committed = true;
  browserLatency.add({ ...delivery.record, stage: "browser.commit", at: Date.now(), durationMs: performance.now() - delivery.received });
}

declare global {
  interface Window {
    /** Bounded diagnostics only; does not send prompts or collect conversation text. */
    axiomLatency: (runId?: string) => Promise<{ server: unknown; browser: LatencyRecord[] }>;
  }
}
