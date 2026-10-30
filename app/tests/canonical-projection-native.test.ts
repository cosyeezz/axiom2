import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager, parseSessionEntries, type CompactionEntry, type ContextEditEntry,
  type CustomMessageEntry, type FileEntry, type SessionEntry, type SessionMessageEntry } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage, UserMessage } from "@earendil-works/pi-ai";
import type { RunOrigin, SelectionChange } from "../src/shared/agent.js";
import { threadGroups } from "../src/shared/thread-layout.js";
import { unarchivedGroups } from "../src/shared/history.js";
import { captureNativeCanonicalSources } from "../src/server/canonical-projection-coordinator.js";
import { transcriptMessages } from "../src/server/transcript.js";

const cwd = mkdtempSync(join(tmpdir(), "axiom-canonical-manager-"));
after(() => rmSync(cwd, { recursive: true, force: true }));
const timestamp = "2025-01-01T00:00:00.000Z";
type AxiomMetadata = { axiomId?: string; axiomRunId?: string; axiomInputIds?: string[]; axiomSelectionChange?: SelectionChange };
const change: SelectionChange = { from: { provider: "old", id: "old", thinking: "low" }, to: { provider: "new", id: "new", thinking: "high" } };
function assistant(content: AssistantMessage["content"], extra: Partial<AssistantMessage & AxiomMetadata> = {}): AssistantMessage & AxiomMetadata {
  return { role: "assistant", content, api: "openai-responses", provider: "openai", model: "fixture",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop", timestamp: 1, ...extra };
}
const user = (content: string, extra: AxiomMetadata = {}): UserMessage & AxiomMetadata => ({ role: "user", content, timestamp: 1, ...extra });
const message = (id: string, parentId: string | null, value: SessionMessageEntry["message"] & AxiomMetadata): SessionMessageEntry =>
  ({ type: "message", id, parentId, timestamp, message: value });
const checkpoint = (id: string, parentId: string, firstKeptEntryId = id): CompactionEntry =>
  ({ type: "compaction", id, parentId, timestamp, summary: `summary-${id}`, firstKeptEntryId, tokensBefore: 1000 });
const edit = (id: string, parentId: string, targetId: string, content: string | null): ContextEditEntry =>
  ({ type: "context_edit", id, parentId, timestamp, targetId, replacement: content === null ? null : { content } });
function fixture(entries: SessionEntry[]) {
  const file: FileEntry[] = [{ type: "session", version: 3, id: "canonical-native-fixture", cwd, timestamp }, ...entries];
  const serialized = file.map(entry => JSON.stringify(entry)).join("\n") + "\n";
  // One real public parse and one hydration per fixture; no append/open/branch or mock manager.
  return SessionManager.inMemory(cwd, undefined, parseSessionEntries(serialized));
}
const sourceState = (manager: SessionManager) => JSON.stringify({ header: manager.getHeader(), leaf: manager.getLeafId(), entries: manager.getEntries() });
function capture(manager: SessionManager, origins?: ReadonlyMap<string, RunOrigin>) {
  const before = sourceState(manager);
  let result!: ReturnType<typeof captureNativeCanonicalSources>;
  assert.doesNotThrow(() => { result = captureNativeCanonicalSources({ manager, origins }); });
  assert.equal(sourceState(manager), before, "reading does not mutate native records, header or leaf");
  assert.equal(manager.getSessionFile(), undefined);
  return result;
}

test("native-only coordinator preserves a valid empty parsed manager", () => {
  const result = capture(fixture([]));
  assert.deepEqual(result.archive.segments, []);
  assert.deepEqual(result.sources, []);
  assert.equal(result.message("missing"), undefined);
  assert.equal(Object.isFrozen(result), true);
});

test("real native U/C/A retains separate archive and current selection anchors", () => {
  const manager = fixture([
    message("u", null, user("question", { axiomId: "display-u", axiomRunId: "R" })),
    checkpoint("c", "u"),
    message("a", "c", assistant([{ type: "text", text: "answer" }], { axiomId: "display-a", axiomRunId: "R", axiomSelectionChange: change })),
  ]);
  assert.deepEqual(transcriptMessages(manager, true).map(m => m.id), ["display-u", "display-a"]);
  assert.deepEqual(transcriptMessages(manager).map(m => m.id), ["c", "display-a"]);
  const result = capture(manager);
  assert.deepEqual(result.archive.segments[0].messageIds, ["display-u"]);
  const archivedUser = result.sources.find(s => s.storage.kind === "archive" && s.group.ids.includes("display-u"));
  const liveAnswer = result.sources.find(s => s.storage.kind === "live" && s.group.ids.includes("display-a"));
  assert.deepEqual(archivedUser?.group.selectionChange, change);
  assert.deepEqual(liveAnswer?.group.selectionChange, change);
  const wrong = unarchivedGroups(threadGroups(transcriptMessages(manager, true)), new Set(["c", "display-u"]));
  assert.equal(wrong.find(g => g.ids.includes("display-a"))?.selectionChange, undefined, "original-global crop is not the current-context contract");
  assert.equal(result.message("display-a")?.phase, "final_answer");
  assert.equal(result.message("c")?.compression?.number, 1);
});

test("active native branch, context edits and two physical buckets remain distinct from keep ranges", () => {
  const manager = fixture([
    message("u", null, user("first", { axiomId: "display-u" })),
    message("e", "u", assistant([{ type: "text", text: "old-edit" }], { axiomId: "display-e" })),
    message("d", "e", assistant([{ type: "text", text: "HIDDEN-EDIT" }], { axiomId: "display-d" })),
    checkpoint("c1", "d", "u"),
    message("k", "c1", user("retained", { axiomId: "display-k" })),
    checkpoint("c2", "k", "k"),
    edit("replace", "c2", "e", "edited-full"),
    edit("remove", "replace", "d", null),
    message("foreign", "u", assistant([{ type: "text", text: "OFF-BRANCH" }], { axiomId: "display-foreign" })),
    message("l", "remove", assistant([{ type: "text", text: "latest" }], { axiomId: "display-l" })),
  ]);
  assert.equal(manager.getLeafId(), "l");
  assert.ok(!manager.getBranch().some(e => e.id === "foreign"));
  const result = capture(manager);
  assert.deepEqual(result.archive.segments.map(s => [s.id, s.messageIds]), [["c1", ["display-u", "display-e"]], ["c2", ["display-k"]]]);
  assert.equal(result.message("display-e")?.text, "edited-full");
  assert.equal(result.message("display-d"), undefined);
  assert.equal(result.message("display-foreign"), undefined);
  assert.equal(result.message("display-l")?.text, "latest");
  assert.deepEqual(result.sources.filter(s => s.storage.kind === "live").flatMap(s => s.group.ids), ["display-l"]);
  assert.equal(result.message("c1")?.compression?.number, 1);
  assert.equal(result.message("c2")?.compression?.number, 2);
  assert.deepEqual(transcriptMessages(manager).map(m => m.id), ["c2", "display-k", "display-l"]);
});

test("native same-bucket thinking, body and calls keep three distinct occurrences", () => {
  const manager = fixture([
    message("m", null, assistant([{ type: "thinking", thinking: "reasoning" }, { type: "text", text: "narration" },
      { type: "toolCall", id: "call", name: "read", arguments: { path: "file.ts" } }], { axiomId: "display-m", stopReason: "toolUse" })),
    checkpoint("c", "m"),
  ]);
  const result = capture(manager), sources = result.sources.filter(s => s.group.ids.includes("display-m"));
  assert.equal(sources.length, 3);
  assert.equal(new Set(sources.map(s => s.sourceKey)).size, 3);
  assert.ok(sources.every(s => s.storage.kind === "archive" && s.storage.segmentId === "c"));
  assert.deepEqual(sources.map(s => result.occurrences.get(s.sourceKey, 0)?.shape), [
    { thinking: true, body: "none", outcome: false, callsCount: 0 },
    { thinking: false, body: "body", outcome: false, callsCount: 0 },
    { thinking: false, body: "none", outcome: false, callsCount: 1 },
  ]);
  assert.deepEqual(sources.map(s => result.occurrences.get(s.sourceKey, 0)?.isLastForMessage), [false, false, true]);
  assert.ok(sources.every(s => result.occurrences.get(s.sourceKey, 0)?.ownerRunId === null));
});

test("native display identities, hidden custom records and cross-boundary legacy result use actual adapters", () => {
  const displayId = "显示:😀".repeat(700);
  const append: CustomMessageEntry<{ axiomInput: string }> = { type: "custom_message", id: "append", parentId: "c", timestamp,
    customType: "axiom-append", content: "followup", details: { axiomInput: "queue-😀" }, display: true };
  const hidden: CustomMessageEntry = { type: "custom_message", id: "hidden", parentId: "append", timestamp,
    customType: "private", content: "PRIVATE-NOT-DISPLAYED", display: false };
  const notice: CustomMessageEntry = { type: "custom_message", id: "notice", parentId: "hidden", timestamp,
    customType: "axiom-result", content: "INTERNAL-RESULT", display: true };
  const manager = fixture([
    message("m", null, assistant([{ type: "toolCall", id: "late", name: "read", arguments: { path: "late.ts" } }], { axiomId: displayId, stopReason: "toolUse" })),
    checkpoint("c", "m"), append, hidden, notice,
    message("r", "notice", { role: "toolResult", toolCallId: "late", toolName: "read", content: [{ type: "text", text: "cross-boundary-output" }], isError: false, timestamp: 1 }),
  ]);
  const result = capture(manager);
  assert.deepEqual(result.archive.segments[0].messageIds, [displayId]);
  assert.equal(result.message(displayId)?.calls?.[0].id, "late");
  assert.equal(result.message("m"), undefined);
  assert.equal(result.message("input-queue-😀")?.role, "user");
  assert.equal(result.message("input-queue-😀")?.inputContinuation, true);
  assert.equal(result.message("hidden"), undefined);
  assert.equal(result.message("notice"), undefined);
  assert.equal(result.message("tool-late")?.text, "cross-boundary-output");
  assert.ok(result.sources.every(s => !s.group.ids.includes("tool-late")));
  assert.ok(result.archive.segments[0].groups.some(g => g.process?.succeeded === 1));
});

test("run-scoped native tool identity and actual per-message ownership are not inferred from neighboring groups", () => {
  const callId = "R-" + createHash("sha256").update("raw-call").digest("hex").slice(0, 24);
  const manager = fixture([
    message("m", null, assistant([{ type: "toolCall", id: "raw-call", name: "read", arguments: { path: "x.ts" } }], { axiomId: "display-m", axiomRunId: "R", stopReason: "toolUse" })),
    checkpoint("c", "m"),
    message("r", "c", { role: "toolResult", toolCallId: "raw-call", toolName: "read", content: [{ type: "text", text: "saved" }],
      isError: false, timestamp: 1, axiomId: `tool-${callId}`, axiomRunId: "R" }),
  ]);
  const result = capture(manager);
  assert.equal(result.message("display-m")?.calls?.[0].id, callId);
  assert.equal(result.message(`tool-${callId}`)?.toolCallId, callId);
  assert.equal(result.message(`tool-${callId}`)?.runId, "R");
  assert.equal(result.message("tool-raw-call"), undefined);
  const source = result.sources.find(s => s.group.ids.includes("display-m"))!;
  assert.equal(result.occurrences.get(source.sourceKey, 0)?.ownerRunId, "R");
});

test("one origins snapshot enriches archive and live values without retaining the caller map", () => {
  const manager = fixture([
    message("u", null, user("question", { axiomId: "display-u", axiomRunId: "R" })), checkpoint("c", "u"),
    message("a", "c", assistant([{ type: "text", text: "answer" }], { axiomId: "display-a", axiomRunId: "R" })),
  ]);
  const origins = new Map<string, RunOrigin>([["R", "manual_resume"]]);
  const first = capture(manager, origins);
  assert.equal(first.message("display-u")?.runOrigin, "manual_resume");
  assert.equal(first.message("display-a")?.runOrigin, "manual_resume");
  origins.set("R", "memory_continuation");
  assert.equal(first.message("display-a")?.runOrigin, "manual_resume");
  const next = capture(manager, origins);
  assert.equal(next.message("display-u")?.runOrigin, "memory_continuation");
  assert.equal(next.message("display-a")?.runOrigin, "memory_continuation");
});

test("fresh native managers retain full same-length suffix changes and old captures never consult later records", () => {
  const text = "α".repeat(17000), thinking = "think".repeat(300), payload = "p".repeat(20000);
  const make = (suffix: string) => fixture([
    message("u", null, user("question", { axiomRunId: "R" })), checkpoint("c", "u"),
    message("m", "c", assistant([{ type: "thinking", thinking: thinking + suffix }, { type: "text", text: text + suffix },
      { type: "toolCall", id: "read", name: "read", arguments: { payload: payload + suffix } }], { axiomId: "display-m", axiomRunId: "R", stopReason: "toolUse" })),
  ]);
  const manager = make("A"), first = capture(manager), second = capture(make("B"));
  assert.equal(first.archive.revision, second.archive.revision, "archive revision is not a live-body version");
  assert.equal(first.message("display-m")?.text, text + "A");
  assert.equal(second.message("display-m")?.text, text + "B");
  assert.equal(first.message("display-m")?.thinking, thinking + "A");
  assert.equal(second.message("display-m")?.thinking, thinking + "B");
  assert.equal(first.message("display-m")?.calls?.[0].input, JSON.stringify({ payload: payload + "A" }, null, 2));
  assert.equal(second.message("display-m")?.calls?.[0].input, JSON.stringify({ payload: payload + "B" }, null, 2));
  assert.deepEqual(first.sources.map(s => s.sourceKey), second.sources.map(s => s.sourceKey));
  const raw = manager.getEntry("m");
  assert.ok(raw?.type === "message" && raw.message.role === "assistant");
  const block = raw.message.content.find(c => c.type === "text");
  assert.ok(block?.type === "text");
  block.text = "changed-after-capture";
  assert.equal(first.message("display-m")?.text, text + "A");
  assert.equal(Object.isFrozen(first.message("display-m")?.calls?.[0]), true);
});

test("separate parsed branches do not reuse an earlier capture or expose abandoned native body", () => {
  const manager = fixture([
    message("u", null, user("root")),
    message("old", "u", assistant([{ type: "text", text: "OLD-BRANCH" }], { axiomId: "old-display" })),
    message("active", "u", assistant([{ type: "text", text: "ACTIVE-BRANCH" }], { axiomId: "active-display" })),
  ]);
  const first = capture(manager);
  assert.equal(first.message("old-display"), undefined);
  assert.equal(first.message("active-display")?.text, "ACTIVE-BRANCH");
  const other = capture(fixture([
    message("u", null, user("root")),
    message("active", "u", assistant([{ type: "text", text: "ACTIVE-BRANCH" }], { axiomId: "active-display" })),
    message("old", "u", assistant([{ type: "text", text: "OLD-BRANCH" }], { axiomId: "old-display" })),
  ]));
  assert.equal(other.message("active-display"), undefined);
  assert.equal(other.message("old-display")?.text, "OLD-BRANCH");
  assert.equal(first.message("active-display")?.text, "ACTIVE-BRANCH");
});
