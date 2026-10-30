import assert from "node:assert/strict";
import test from "node:test";
import { SessionManager, type AgentSession, type AgentSessionEvent, type AgentSessionEventListener } from "@earendil-works/pi-coding-agent";
import { prepareCanonicalLiveSource } from "../src/server/canonical-live-source.js";
import { chatMessage, toolKey } from "../src/server/transcript.js";
import { createCanonicalToolDisplay } from "../src/server/canonical-tool-display.js";
import type { RunOrigin } from "../src/shared/agent.js";
import { CanonicalWindow } from "../src/server/canonical-window.js";

// Own publisher with the installed Pi 1.4 public dispatch -> append ordering.
// Does not instantiate an AgentSession, runtime, resource loader or model.
class Publisher implements Pick<AgentSession, "sessionManager" | "subscribe" | "dispose"> {
  private listeners: AgentSessionEventListener[] = [];
  constructor(readonly sessionManager: SessionManager) {}
  subscribe(listener: AgentSessionEventListener) {
    this.listeners.push(listener);
    return () => { const index = this.listeners.indexOf(listener); if (index >= 0) this.listeners.splice(index, 1); };
  }
  emit(event: AgentSessionEvent) { for (const listener of this.listeners) listener(event); }
  end(message: Extract<AgentSessionEvent, { type: "message_end" }>["message"]) {
    this.emit({ type: "message_end", message });
    if (["system", "user", "assistant", "toolResult"].includes(message.role))
      this.sessionManager.appendMessage(message as Parameters<SessionManager["appendMessage"]>[0]);
    else if (message.role === "custom")
      this.sessionManager.appendCustomMessageEntry(message.customType, message.content, message.display, message.details);
  }
  dispose() { this.listeners = []; }
}
const user = (id: string, content = id) => ({ role: "user" as const, axiomId: id, axiomRunId: "run", content, timestamp: 1 });
const assistant = (id: string, text: string) => ({ role: "assistant" as const, axiomId: id, axiomRunId: "run",
  content: [{ type: "text" as const, text }], api: "openai-completions" as const, provider: "fixture", model: "fixture",
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  stopReason: "stop" as const, timestamp: 2 });
function setup() {
  const manager = SessionManager.inMemory(process.env.TMPDIR!);
  const source = prepareCanonicalLiveSource(manager), publisher = new Publisher(manager);
  source.attach(publisher);
  const run = source.begin();
  publisher.subscribe(event => {
    if (event.type !== "message_start" && event.type !== "message_end" && event.type !== "message_update") return;
    const raw = event.message as typeof event.message & { axiomId: string };
    const display = chatMessage(event.message, raw.axiomId, event.type !== "message_end" && event.message.role === "assistant");
    if (display) run.observe(event.message, display);
  });
  return { manager, source, publisher, run };
}

test("native acknowledgement retires terminal overlay before a current capture", () => {
  const { publisher, run } = setup();
  let pending = false;
  publisher.subscribe(event => { if (event.type === "message_end") pending = run.capture() === undefined; });
  publisher.end(user("u", "native"));
  assert.equal(pending, true);
  const captured = run.capture()!;
  assert.equal(captured.message("u")?.text, "native");
  assert.equal(captured.sources.length, 1);
});

test("stream copies replace one owned display value and finalized native wins", () => {
  const { publisher, run } = setup();
  publisher.end(user("u"));
  const first = assistant("a", "one");
  publisher.emit({ type: "message_start", message: first });
  const captured = run.capture()!;
  first.content[0].text = "mutated caller";
  assert.equal(captured.message("a")?.text, "one");
  for (let n = 0; n < 100; n++) publisher.emit({ type: "message_start", message: assistant("a", `delta ${n}`) });
  assert.equal(run.capture()!.message("a")?.text, "delta 99");
  publisher.end(assistant("a", "final"));
  assert.equal(run.capture()!.message("a")?.text, "final");
  assert.equal(run.capture()!.message("a")?.streaming, false);
});

test("run rollover rejects old writers, captures and late end", () => {
  const { publisher, source, run } = setup();
  publisher.end(user("u"));
  const next = source.begin();
  run.observe(assistant("stale", "stale"), { id: "stale", role: "assistant", text: "stale", streaming: true });
  run.end();
  assert.equal(run.capture(), undefined);
  assert.equal(next.capture()!.message("stale"), undefined);
  assert.equal(next.capture()!.message("u")?.text, "u");
  next.end();
  assert.equal(next.capture(), undefined);
});

test("custom messages come only from native projection, never ordinary overlay", () => {
  const { publisher, run } = setup();
  const raw = { role: "custom" as const, customType: "axiom-append", content: "custom native", display: true,
    details: { axiomInput: "input" }, timestamp: 1 };
  run.observe(raw, { id: "invented", role: "user", text: "uncommitted" });
  assert.equal(run.capture()!.message("invented"), undefined);
  publisher.end(raw);
  assert.equal(run.capture()!.message("input-input")?.text, "custom native");
});

test("unacknowledged terminal and scope replacement fail closed", () => {
  const { manager, run } = setup();
  const raw = user("missing");
  run.observe(raw, chatMessage(raw, raw.axiomId)!);
  assert.equal(run.capture(), undefined);
  manager.newSession();
  assert.equal(run.capture(), undefined);
});

test("dispose revokes source without owning SDK disposal", () => {
  const { source, run, publisher } = setup();
  source.dispose();
  assert.equal(run.capture(), undefined);
  publisher.end(user("still-writable"));
  assert.equal(publisher.sessionManager.getBranch().at(-1)?.type, "message");
});

test("publisher disposal revokes all run captures", () => {
  const { publisher, run } = setup();
  publisher.dispose();
  assert.equal(run.capture(), undefined);
});

test("active guards revoke existing window references on rollover, end and native scope replacement", () => {
  const { publisher, source, run } = setup();
  publisher.end(user("guard-user"));
  const window = new CanonicalWindow(() => run.capture(), () => run.active());
  const opened = window.read("r", { op: "open" });
  assert.equal(opened.ok, true); assert.equal(run.active(), true);
  if (!opened.ok) throw Error("fixture open failed");
  const revision = (opened.data as { revision: string }).revision;
  const next = source.begin();
  assert.equal(run.active(), false); assert.equal(next.active(), true);
  const stale = window.read("r", { op: "sources", revision });
  assert.equal(stale.ok, false); if (!stale.ok) assert.equal(stale.error.code, "STALE");
  next.end(); assert.equal(next.active(), false);
  const replaced = setup(); replaced.manager.newSession(); assert.equal(replaced.run.active(), false);
  const disposed = setup(); disposed.publisher.dispose(); assert.equal(disposed.run.active(), false);
  source.dispose(); replaced.source.dispose(); disposed.source.dispose();
});

const toolEvent = { toolCallId: "call", toolName: "bash", args: {} };
const toolId = `tool-${toolKey("run", toolEvent.toolCallId)}`;
const toolResult = (text: string) => ({ role: "toolResult" as const, toolCallId: toolEvent.toolCallId,
  toolName: toolEvent.toolName, content: [{ type: "text" as const, text }], isError: false,
  axiomId: toolId, axiomRunId: "run", timestamp: 3 });

test("tool display captures full immutable partials and preserves the legacy IPC projection", () => {
  const f = setup(), display = createCanonicalToolDisplay("run", f.run.observeTool, () => 42);
  f.publisher.end(user("u"));
  f.publisher.end({ ...assistant("a", ""), content: [{ type: "toolCall", id: "call", name: "bash", arguments: {} }] });
  const start = display({ ...toolEvent, type: "tool_execution_start" });
  assert.equal(start.id, toolKey("run", "call")); assert.equal(start.output.content, undefined);
  assert.equal(f.run.capture()!.message(toolId)?.toolStartedAt, 42);
  const text = "full🙂\n".repeat(20_000);
  const update = display({ ...toolEvent, type: "tool_execution_update", partialResult: {
    content: [{ type: "text", text }, { type: "image", data: "not-display-body" }] } });
  assert.deepEqual(update.output.content, [{ type: "text", text }]);
  const captured = f.run.capture()!;
  assert.equal(captured.message(toolId)?.text, text);
  assert.equal(captured.message(toolId)?.streaming, true);
  display({ ...toolEvent, type: "tool_execution_update", partialResult: { details: {} } });
  assert.equal(f.run.capture()!.message(toolId)?.text, text, "missing content retains last complete partial");
  display({ ...toolEvent, type: "tool_execution_update", partialResult: { content: [] } });
  assert.equal(f.run.capture()!.message(toolId)?.text, "", "explicit empty content replaces it");
  assert.equal(captured.message(toolId)?.text, text, "earlier source cut never changes");
  f.source.dispose();
});

test("tool execution end is not native completion; ordinary handoff fences late partials", () => {
  const f = setup(), display = createCanonicalToolDisplay("run", f.run.observeTool);
  display({ ...toolEvent, type: "tool_execution_start" });
  const end = display({ ...toolEvent, type: "tool_execution_end", result: { content: [{ type: "text", text: "execution only" }] }, isError: true, durationMs: 80 });
  assert.equal(end.status, "failed"); assert.equal(end.durationMs, 80);
  assert.equal(f.run.capture(), undefined);
  display({ ...toolEvent, type: "tool_execution_update", partialResult: { content: [{ type: "text", text: "late before ordinary" }] } });
  assert.equal(f.run.capture(), undefined, "late update cannot reopen an execution-end fence");
  const raw = toolResult("native result");
  f.publisher.emit({ type: "message_start", message: raw });
  display({ ...toolEvent, type: "tool_execution_update", partialResult: { content: [{ type: "text", text: "late before append" }] } });
  assert.equal(f.run.capture(), undefined, "late update cannot bypass pending ordinary terminal");
  f.publisher.end(raw);
  assert.equal(f.run.capture()!.message(toolId)?.text, "native result");
  display({ ...toolEvent, type: "tool_execution_end", result: { content: [{ type: "text", text: "late after append" }] }, isError: true });
  assert.equal(f.run.capture()!.message(toolId)?.text, "native result");
  assert.equal(f.run.capture()!.message(toolId)?.status, "completed");
  f.source.dispose();
});

test("tool partials cannot cross run, end, native context or publisher ownership", () => {
  const f = setup(), display = createCanonicalToolDisplay("run", f.run.observeTool);
  display({ ...toolEvent, type: "tool_execution_start" });
  const next = f.source.begin();
  display({ ...toolEvent, type: "tool_execution_update", partialResult: { content: [{ type: "text", text: "old" }] } });
  assert.equal(next.capture()!.message(toolId), undefined);
  const fresh = createCanonicalToolDisplay("new-run", next.observeTool);
  fresh({ ...toolEvent, type: "tool_execution_start" });
  assert.ok(next.capture()!.message(`tool-${toolKey("new-run", "call")}`));
  next.end(); fresh({ ...toolEvent, type: "tool_execution_start" }); assert.equal(next.capture(), undefined);
  const reset = f.source.begin(); f.manager.newSession();
  reset.observeTool({ id: "late", role: "toolResult", text: "late", streaming: true });
  assert.equal(reset.capture(), undefined); f.source.dispose();
  const other = setup(); other.publisher.dispose();
  other.run.observeTool({ id: "late", role: "toolResult", text: "late", streaming: true });
  assert.equal(other.run.capture(), undefined); other.source.dispose();
});

test("tool display keeps task details and parallel calls separate", () => {
  const f = setup(), display = createCanonicalToolDisplay("run", f.run.observeTool, () => 40);
  const task = { ...toolEvent, toolName: "delegate", toolCallId: "task" };
  const details = { tasks: [{ id: "t", title: "result" }] };
  display({ ...toolEvent, type: "tool_execution_start" });
  display({ ...task, type: "tool_execution_update", partialResult: { details, content: [{ type: "text", text: "model only" }] } });
  const capture = f.run.capture()!;
  assert.equal(capture.message(`tool-${toolKey("run", "task")}`)?.text, JSON.stringify(details));
  assert.equal(capture.message(toolId)?.text, "");
  details.tasks[0].title = "mutated";
  assert.equal(capture.message(`tool-${toolKey("run", "task")}`)?.text, '{"tasks":[{"id":"t","title":"result"}]}');
  const failed = display({ ...task, type: "tool_execution_end", result: { details, content: [{ type: "text", text: "actual failure" }] }, isError: true });
  assert.deepEqual(failed.output.content, [{ type: "text", text: "actual failure" }], "failed task keeps its real output, not success metadata");
  f.source.dispose();
});

test("nested tool events keep legacy IPC without awaiting a nonexistent independent native result", () => {
  const f = setup(), display = createCanonicalToolDisplay("run", f.run.observeTool);
  const child = { ...toolEvent, toolCallId: "call/1", parentToolCallId: "call" };
  const childId = `tool-${toolKey("run", child.toolCallId)}`;
  display({ ...toolEvent, type: "tool_execution_start" });
  display({ ...child, type: "tool_execution_start" });
  assert.equal(f.run.capture()!.message(childId), undefined);
  const update = display({ ...child, type: "tool_execution_update", partialResult: { content: [{ type: "text", text: "nested partial" }] } });
  assert.deepEqual(update.output.content, [{ type: "text", text: "nested partial" }]);
  assert.equal(f.run.capture()!.message(childId), undefined);
  const end = display({ ...child, type: "tool_execution_end", result: { content: [{ type: "text", text: "nested end" }] }, isError: false });
  assert.equal(end.id, toolKey("run", child.toolCallId)); assert.equal(end.status, "completed");
  assert.ok(f.run.capture(), "nested terminal must not block the parent window");
  display({ ...toolEvent, type: "tool_execution_end", result: { content: [{ type: "text", text: "parent end" }] }, isError: false });
  assert.equal(f.run.capture(), undefined, "only the parent needs native handoff");
  f.publisher.end(toolResult("native parent"));
  const capture = f.run.capture()!;
  assert.equal(capture.message(toolId)?.text, "native parent");
  assert.equal(capture.message(childId), undefined);
  assert.equal(new CanonicalWindow(() => f.run.capture(), () => f.run.active()).read("nested", { op: "open" }).ok, true);
  f.source.dispose();
});

test("host origins survive archive, current and transient winner projection without changing prior cuts", () => {
  const f = setup();
  f.publisher.end(user("origin-user")); f.publisher.end(assistant("origin-archived", "archived"));
  f.publisher.end(user("keep")); const keep = f.manager.getLeafId()!;
  f.manager.appendCompaction("summary", keep, 12);
  f.publisher.emit({ type: "message_start", message: assistant("stream", "partial") });
  const origins = new Map<string, RunOrigin>([["run", "memory_continuation"]]);
  const capture = f.run.capture(origins)!;
  for (const id of ["origin-archived", "keep", "stream"]) assert.equal(capture.message(id)?.runOrigin, "memory_continuation", id);
  origins.set("run", "manual_resume");
  assert.equal(capture.message("stream")?.runOrigin, "memory_continuation");
  assert.equal(f.run.capture(origins)!.message("stream")?.runOrigin, "manual_resume");
  assert.equal(f.run.capture()!.message("stream")?.runOrigin, undefined, "unknown provenance is not inferred");
  f.source.dispose();
});

test("compaction rebuild uses original and current groups from the same native manager", () => {
  const { manager, publisher, run } = setup();
  publisher.end(user("u1"));
  publisher.end(assistant("a1", "first"));
  publisher.end(user("u2"));
  const keep = manager.getLeafId()!;
  manager.appendCompaction("summary", keep, 12);
  publisher.end(user("u3"));
  const capture = run.capture()!;
  assert.equal(capture.archive.segments.length, 1);
  assert.equal(capture.message("a1")?.text, "first");
  assert.ok(capture.sources.some(source => source.storage.kind === "archive"));
  assert.ok(capture.sources.some(source => source.storage.kind === "live"));
});
