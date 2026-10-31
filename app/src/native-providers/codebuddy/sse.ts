import { waitForNative } from "../abort.js";
import { CodeBuddyProtocolError } from "./failure.js";
export interface CodeBuddySseFrame { event: string; data: string }

/** Bounded UTF-8/SSE framing only; semantic completion belongs to the vendor state machine. */
export async function* readCodeBuddySse(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncGenerator<CodeBuddySseFrame> {
  const reader = body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "", data: string[] = [], event = "", bytes = 0, frameBytes = 0, events = 0;
  function line(value: string): CodeBuddySseFrame | undefined {
    if (!value) {
      const frame = data.length ? { data: data.join("\n"), event } : undefined;
      data = []; event = ""; frameBytes = 0;
      if (frame && ++events > 20000) throw new CodeBuddyProtocolError("stream");
      return frame;
    }
    frameBytes += value.length;
    if (frameBytes > 1024 * 1024) throw new CodeBuddyProtocolError("stream");
    const colon = value.indexOf(":"), field = colon < 0 ? value : value.slice(0, colon);
    let text = colon < 0 ? "" : value.slice(colon + 1);
    if (text.startsWith(" ")) text = text.slice(1);
    if (field === "data") data.push(text);
    if (field === "event") event = text;
    return undefined;
  }
  try {
    for (;;) {
      signal.throwIfAborted();
      const chunk = await waitForNative(reader.read(), signal);
      if (!chunk.done) {
        bytes += chunk.value.byteLength;
        if (bytes > 10 * 1024 * 1024) throw new CodeBuddyProtocolError("stream");
      }
      try { buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true }); }
      catch { throw new CodeBuddyProtocolError("stream"); }
      for (;;) {
        const at = buffer.search(/[\r\n]/);
        if (at < 0 || !chunk.done && buffer[at] === "\r" && at === buffer.length - 1) break;
        const end = at + (buffer[at] === "\r" && buffer[at + 1] === "\n" ? 2 : 1);
        const frame = line(buffer.slice(0, at)); buffer = buffer.slice(end);
        if (frame) { yield frame; signal.throwIfAborted(); }
      }
      if (buffer.length > 1024 * 1024) throw new CodeBuddyProtocolError("stream");
      if (chunk.done) {
        // Never infer a successful DONE from an unfinished SSE record at EOF.
        if (buffer || data.length) throw new CodeBuddyProtocolError("terminal");
        return;
      }
    }
  } finally {
    void reader.cancel().catch(() => {});
    try { reader.releaseLock(); } catch { /* A noncooperative source may still own its pending read. */ }
  }
}
