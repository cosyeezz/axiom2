import { setImmediate } from "node:timers/promises";
import { KiroChatError, kiroObject, type KiroJson } from "./kiro-chat-protocol.js";

// AWS event-stream framing, independently implemented from the published wire format.
const table = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let i = 0; i < 8; i++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
export function kiroCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
const invalid = () => new KiroChatError("Kiro AWS event-stream 帧无效、损坏或被截断。");
const utf8 = new TextDecoder("utf-8", { fatal: true });
export type KiroEvent = { headers: Record<string, string>; data: KiroJson };
function decode(frame: Buffer): KiroEvent {
  if (kiroCrc32(frame.subarray(0, frame.length - 4)) !== frame.readUInt32BE(frame.length - 4)) throw invalid();
  const end = 12 + frame.readUInt32BE(4), headers: Record<string, string> = Object.create(null);
  let offset = 12;
  const take = (count: number) => {
    if (offset + count > end) throw invalid();
    const value = frame.subarray(offset, offset + count); offset += count; return value;
  };
  while (offset < end) {
    const nameLength = take(1)[0];
    if (!nameLength) throw invalid();
    const name = utf8.decode(take(nameLength)), type = take(1)[0];
    let value: string | undefined;
    if (type === 0 || type === 1) { /* Boolean, no bytes. */ }
    else if (type >= 2 && type <= 5) take([1, 2, 4, 8][type - 2]);
    else if (type === 6 || type === 7) {
      const bytes = take(take(2).readUInt16BE(0));
      if (type === 7) value = utf8.decode(bytes);
    } else if (type === 8) take(8);
    else if (type === 9) take(16);
    else throw invalid();
    if (name.startsWith(":")) {
      if (value === undefined || Object.hasOwn(headers, name)) throw invalid();
      headers[name] = value;
    }
  }
  let data: KiroJson;
  try { data = kiroObject(JSON.parse(utf8.decode(frame.subarray(end, frame.length - 4)))); }
  catch { throw invalid(); }
  if (!["event", "exception", "error"].includes(headers[":message-type"]) ||
      headers[":message-type"] === "event" && !headers[":event-type"]) throw invalid();
  return { headers, data };
}

/** Bounded, incremental decoder: a single frame allocation, never repeated whole-buffer concatenation. */
export async function* readKiroEvents(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncGenerator<KiroEvent> {
  const reader = body.getReader();
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  let frame = Buffer.alloc(12), offset = 0, total = 0, frames = 0;
  let budgetReads = 0, budgetFrames = 0, budgetBytes = 0, lastYield = performance.now();
  const budgetExceeded = () => budgetReads >= 256 || budgetFrames >= 256 || budgetBytes >= 64 * 1024 || performance.now() - lastYield >= 8;
  const yieldBudget = async () => {
    await setImmediate(undefined, { signal });
    signal.throwIfAborted();
    budgetReads = 0; budgetFrames = 0; budgetBytes = 0; lastYield = performance.now();
  };
  try {
    signal.throwIfAborted();
    for (;;) {
      const item = await reader.read(); signal.throwIfAborted();
      if (item.done) break;
      total += item.value.byteLength;
      if (total > 64 * 1024 * 1024) throw new KiroChatError("Kiro 流式响应超过本地 64 MiB 限制。");
      // Include reads and incomplete-frame copies: immediately resolved one-byte
      // reads can starve timers just as a single buffered chunk of full frames can.
      budgetReads++;
      if (budgetExceeded()) await yieldBudget();
      let cursor = 0;
      while (cursor < item.value.length) {
        const count = Math.min(frame.length - offset, item.value.length - cursor);
        frame.set(item.value.subarray(cursor, cursor + count), offset); offset += count; cursor += count;
        budgetBytes += count;
        if (budgetExceeded()) await yieldBudget();
        if (offset < frame.length) continue;
        if (frame.length === 12) {
          const size = frame.readUInt32BE(0), headerSize = frame.readUInt32BE(4);
          if (size < 16 || size > 16 * 1024 * 1024 || headerSize > size - 16 ||
              kiroCrc32(frame.subarray(0, 8)) !== frame.readUInt32BE(8)) throw invalid();
          const full = Buffer.allocUnsafe(size); full.set(frame); frame = full;
        } else {
          if (++frames > 100000) throw new KiroChatError("Kiro 流式事件数量超过本地限制。");
          budgetFrames++;
          if (budgetExceeded()) await yieldBudget();
          signal.throwIfAborted();
          yield decode(frame);
          frame = Buffer.alloc(12); offset = 0;
        }
      }
    }
    if (offset || !frames) throw invalid();
  } finally {
    signal.removeEventListener("abort", abort);
    void reader.cancel().catch(() => {}); reader.releaseLock();
  }
}
