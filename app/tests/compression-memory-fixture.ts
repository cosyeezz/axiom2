import assert from "node:assert/strict";
import { compressionMemoryPrompt } from "../src/server/compression-memory.js";

/** Summary requests retain chat tools for cache-prefix parity, but never execute them. */
export function isCompressionRequest(body: any) {
  const content = body.messages?.at(-1)?.content;
  const text = typeof content === "string" ? content : (content ?? []).map((part: any) => part.text ?? "").join("\n");
  return text.startsWith("[Axiom native compaction request]");
}

/** A loopback model checks memory when the host reminder reaches its tail. */
export function compressionMemoryRead(body: any) {
  const text = (message: any) => typeof message.content === "string" ? message.content :
    (message.content ?? []).map((part: any) => part.text ?? "").join("\n");
  if (isCompressionRequest(body) || !body.tools?.length || !text(body.messages.at(-1)).includes(compressionMemoryPrompt)) return;
  const instructions = body.messages.map(text).join("\n");
  const path = instructions.match(/^Session memory file: (.+?MEMORY\.md)\r?$/m)?.[1]
    ?? instructions.match(/你需要主动维护(?:本)?会话记忆文件 (.+?MEMORY\.md)[，。]/)?.[1];
  assert.ok(path, "the existing system instruction supplies the memory path");
  return { role: "assistant", tool_calls: [{ index: 0, id: "check-compression-memory", type: "function",
    function: { name: "read", arguments: JSON.stringify({ path }) } }] };
}

export function afterCompressionMemoryRead(body: any) {
  return body.messages.at(-1)?.role === "tool" && body.messages.at(-1)?.tool_call_id === "check-compression-memory";
}
