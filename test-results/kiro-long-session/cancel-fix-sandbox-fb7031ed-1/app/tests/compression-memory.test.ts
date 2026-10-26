import assert from "node:assert/strict";
import { test } from "node:test";
import { SessionManager, type AgentSession, type BoundaryState } from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { CompressionMemory, compressionMemoryPrompt } from "../src/server/compression-memory.js";
import { memoryInstruction } from "../src/shared/memory-instruction.js";
import { compressionMemoryRead } from "./compression-memory-fixture.js";

test("loopback memory reader locates current and historical memory instructions", () => {
  const path = "/tmp/session with spaces/MEMORY.md";
  for (const instruction of [memoryInstruction(path), `你需要主动维护本会话记忆文件 ${path}，保留进展。`]) {
    const response = compressionMemoryRead({ tools: [{}], messages: [
      { role: "system", content: instruction }, { role: "system", content: compressionMemoryPrompt },
    ] });
    assert.deepEqual(JSON.parse(response!.tool_calls[0].function.arguments), { path });
  }
});

function fixture() {
  const memory = new CompressionMemory(), manager = SessionManager.inMemory();
  const session = { sessionManager: manager, refreshContext() {} } as unknown as AgentSession;
  const event = (outcome = "completed") => ({ entries: [], continue: false, outcome,
    context: { contextMessages: manager.buildSessionContext().messages, contextEntries: [], llmMessages: [], pendingMessages: [], canContinue: true } }) as BoundaryState;
  return { memory, manager, session, event };
}

test("reminder appends once after all existing system sections and persists its position", () => {
  const f = fixture();
  f.memory.request("job");
  const prefix = [{ role: "system", content: "first system" }, { role: "user", content: "history", timestamp: 1 },
    { role: "system", content: "later system" }] as AgentMessage[];
  const injected = f.memory.context(f.session, prefix);
  assert.deepEqual(injected.slice(0, -1), prefix);
  prefix.forEach((message, index) => assert.equal(injected[index], message));
  assert.equal((injected.at(-1) as any).content, compressionMemoryPrompt);
  assert.equal(f.memory.sent("job"), true);
  f.memory.request("job");
  const next = [...injected, { role: "user", content: "later input", timestamp: 2 } as AgentMessage];
  assert.equal(f.memory.context(f.session, next), next);
  assert.equal(f.manager.getBranch().filter(entry => entry.type === "custom_message").length, 1);
  assert.equal(f.memory.boundary("job", f.event()), undefined);
  f.memory.delete("job");
  assert.equal(f.memory.context(f.session, next), next);
});

test("a request arriving after dispatch schedules the reminder for the next request", () => {
  const f = fixture();
  f.memory.request("job");
  const boundary = f.memory.boundary("job", f.event())!;
  assert.equal(boundary.continue, true);
  assert.equal(boundary.entries?.at(-1)?.type, "custom_message");
  assert.equal(f.memory.sent("job"), false);
  assert.equal(f.memory.boundary("job", f.event("error")), undefined);
  f.memory.context(f.session, []);
  assert.equal(f.memory.sent("job"), true);
  assert.equal(f.memory.boundary("job", f.event()), undefined);
});

test("cancellation clears the pending reminder and delivery does not transfer between jobs", () => {
  const f = fixture();
  f.memory.request("cancelled");
  f.memory.delete("cancelled");
  assert.deepEqual(f.memory.context(f.session, []), []);
  assert.equal(f.memory.boundary("cancelled", f.event()), undefined);
  f.memory.request("job");
  f.memory.context(f.session, []);
  f.memory.request("next");
  assert.equal(f.memory.sent("next"), false);
  f.memory.clear();
  assert.equal(f.memory.sent("job"), false);
  assert.equal(f.memory.boundary("next", f.event()), undefined);
});
