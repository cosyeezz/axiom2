import assert from "node:assert/strict";
import { compressionMemoryPrompt } from "../src/server/compression-memory.js";

/** A loopback model checks memory when the host reminder reaches its tail. */
export function compressionMemoryRead(body: any) {
  const text = (message: any) => typeof message.content === "string" ? message.content :
    (message.content ?? []).map((part: any) => part.text ?? "").join("\n");
  if (!body.tools?.length || !text(body.messages.at(-1)).includes(compressionMemoryPrompt)) return;
  const path = body.messages.map(text).join("\n").match(/你需要主动维护会话记忆文件 (.+?MEMORY\.md)，/)?.[1];
  assert.ok(path, "the existing system instruction supplies the memory path");
  return { role: "assistant", tool_calls: [{ index: 0, id: "check-compression-memory", type: "function",
    function: { name: "read", arguments: JSON.stringify({ path }) } }] };
}

export function afterCompressionMemoryRead(body: any) {
  return body.messages.at(-1)?.role === "tool" && body.messages.at(-1)?.tool_call_id === "check-compression-memory";
}
