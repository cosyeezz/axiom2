import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { AgentViews } from "../src/server/agents/views.js";
import { Store } from "../src/server/storage.js";
import {
  messageScope,
  threadScope,
  type ChatMessage,
  type ThreadIndex,
} from "../src/shared/agent.js";
import type { Scope, Session, Workspace } from "../src/shared/protocol.js";
import { threadGroups } from "../src/shared/thread-layout.js";

const message = (
  id: string,
  role: ChatMessage["role"] = "assistant",
  activity = false,
): ChatMessage => ({
  id,
  role,
  text: `Body ${id}`,
  ...(activity ? { calls: [{ id: `call-${id}`, name: "read", input: "{}" }] } : {}),
});
const group = (activity: boolean, ...ids: string[]) => ({
  id: ids[0],
  ids,
  activity,
});

// This suite checks layout independently of read watermarks and run metadata.
const layout = ({ ids, groups }: ThreadIndex) => ({ ids, groups });

function fixture(t: TestContext, messages: ChatMessage[] = []) {
  const root = mkdtempSync(join(tmpdir(), "axiom-thread-layout-"));
  const store = new Store(root);
  const workspace = store.execute({
    requestId: randomUUID(),
    op: "workspace.open",
    params: { path: root, authorized: true },
  }) as Workspace;
  const session = store.execute({
    requestId: randomUUID(),
    op: "session.create",
    workspaceId: workspace.id,
  }) as Session;
  const scope: Scope = { workspaceId: workspace.id, sessionId: session.id };
  const events: { scope: string; data: unknown }[] = [];
  const views = new AgentViews(store, (scope, data) => events.push({
    scope, data: scope.startsWith("thread:") ? layout(data as ThreadIndex) : data,
  }));
  views.messages.set(scope.sessionId, new Map(messages.map((item) => [item.id, item])));
  t.after(() => {
    views.flush(scope);
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
  return { views, scope, events };
}

test("threadGroups: empty and tool-only transcripts have no visible groups", () => {
  assert.deepEqual(threadGroups([]), []);
  assert.deepEqual(threadGroups([message("tool", "toolResult")]), []);
});

test("threadGroups: tool results are omitted without breaking adjacent activity", () => {
  assert.deepEqual(
    threadGroups([
      message("leading", "toolResult"),
      message("first", "assistant", true),
      message("tool-1", "toolResult"),
      message("second", "assistant", true),
      message("tool-2", "toolResult"),
      message("answer"),
    ]),
    [group(true, "first", "second"), group(false, "answer")],
  );
});

test("threadGroups: user, notice and assistants without calls are boundaries", () => {
  for (const boundary of [
    message("boundary", "user", true),
    message("boundary", "notice", true),
    message("boundary"),
    { ...message("boundary"), calls: [] },
  ]) {
    assert.deepEqual(
      threadGroups([
        message("first", "assistant", true),
        boundary,
        message("second", "assistant", true),
      ]),
      [group(true, "first"), group(false, "boundary"), group(true, "second")],
    );
  }
  assert.deepEqual(
    threadGroups([message("one"), message("two"), message("three", "notice")]),
    [group(false, "one"), group(false, "two"), group(false, "three")],
  );
});

test("threadGroups: delegate and mixed calls share the process block", () => {
  const delegated = message("task", "assistant", true);
  delegated.calls!.push({ id: "delegate-task", name: "delegate", input: "{}" });
  assert.deepEqual(threadGroups([
    message("first", "assistant", true),
    delegated,
    message("tool-task", "toolResult"),
    message("second", "assistant", true),
  ]), [group(true, "first", "task", "second")]);
  assert.deepEqual(threadGroups([
    { ...delegated, calls: delegated.calls!.slice(1) },
    { ...delegated, id: "another-task" },
  ]), [group(true, "task", "another-task")]);
});

test("threadGroups: all task tools join activity, including namespaced and mixed calls", () => {
  for (const name of ["delegate", "read_result", "append", "cancel_task"]) {
    for (const prefix of ["", "functions."]) {
      const special = { ...message("task"), calls: [{ id: "special", name: prefix + name, input: "{}" }] };
      for (const calls of [special.calls, [...special.calls, ...message("other", "assistant", true).calls!]]) {
        assert.deepEqual(threadGroups([message("before", "assistant", true), { ...special, calls }, message("after", "assistant", true)]),
          [group(true, "before", "task", "after")]);
      }
    }
  }
});

const thought = (id: string): ChatMessage => ({ id, role: "assistant", text: "", thinking: "检查中", thinkingActive: true, streaming: true });

test("threadGroups: pure thinking joins tools before, after and across thinking chains", () => {
  const tool = message("tool", "assistant", true);
  assert.deepEqual(threadGroups([thought("t")]), [group(true, "t")]);
  assert.deepEqual(threadGroups([thought("t"), thought("t2")]), [group(true, "t", "t2")]);
  assert.deepEqual(threadGroups([thought("t"), tool]), [group(true, "t", "tool")]);
  assert.deepEqual(threadGroups([tool, thought("t")]), [group(true, "tool", "t")]);
  assert.deepEqual(threadGroups([tool, message("result", "toolResult"), thought("t"), thought("t2"), message("next", "assistant", true)]), [group(true, "tool", "t", "t2", "next")]);
  assert.deepEqual(threadGroups([tool, { ...thought("t"), thinking: undefined }]), [group(true, "tool", "t")], "active thinking can precede its first text delta");
  assert.deepEqual(threadGroups([tool, { ...thought("t"), thinkingActive: false, streaming: false }]), [group(true, "tool", "t")], "finishing thinking does not split the block");
});

test("threadGroups: task thinking and task calls stay together inside activity", () => {
  const before = message("before", "assistant", true);
  const after = message("after", "assistant", true);
  for (const name of ["delegate", "read_result", "append", "cancel_task"]) {
    for (const prefix of ["", "functions."]) {
      const task: ChatMessage = { ...thought("task"), calls: [{ id: "task-call", name: prefix + name, input: "{}" }] };
      for (const calls of [task.calls, [...before.calls!, ...task.calls!, ...after.calls!]]) {
        assert.deepEqual(threadGroups([before, message("result", "toolResult"), thought("between"), { ...task, calls }, after]), [
          group(true, "before", "between", "task", "after"),
        ]);
      }
      assert.deepEqual(threadGroups([task, after]), [group(true, "task", "after")]);
      assert.deepEqual(threadGroups([thought("leading"), task]), [group(true, "leading", "task")]);
      for (const boundary of [
        { error: "出错" }, { status: "failed" as const }, { status: "cancelled" as const },
      ]) {
        assert.deepEqual(threadGroups([before, { ...task, ...boundary }, after]), [group(true, "before"), group(false, "task"), group(true, "after")]);
      }
      assert.deepEqual(threadGroups([before, message("user", "user"), task]), [group(true, "before"), group(false, "user"), group(true, "task")]);
    }
  }
});

test("AgentViews: task thinking eligibility republishes layout but its deltas do not", (t) => {
  const before = message("before", "assistant", true);
  const task: ChatMessage = { id: "task", role: "assistant", text: "", calls: [{ id: "task-call", name: "delegate", input: "{}" }] };
  const { views, scope, events } = fixture(t, [before, task]);
  const withThinking = { ...task, thinking: "检查中" };
  const updates: [ChatMessage, boolean][] = [
    [withThinking, false], [{ ...withThinking, thinking: "继续检查" }, false],
    [{ ...withThinking, text: "正文出现" }, false],
    [withThinking, false], [{ ...withThinking, status: "cancelled" }, true],
    [withThinking, true], [task, false],
  ];
  for (const [updated, layoutChanged] of updates) {
    events.length = 0;
    views.messageChanged(scope, updated);
    assert.equal(events.some((event) => event.scope === threadScope(scope)), layoutChanged);
    assert.deepEqual(views.thread(scope).groups, threadGroups([before, updated]));
    views.flush(scope);
  }
});

test("threadGroups: pure thinking never crosses visible boundaries", () => {
  const first = message("first", "assistant", true);
  const second = message("second", "assistant", true);
  for (const boundary of [
    { ...thought("boundary"), text: "普通正文" },
    { ...thought("boundary"), error: "出错" },
    { ...thought("boundary"), status: "failed" as const },
    { ...thought("boundary"), status: "cancelled" as const },
    { ...thought("boundary"), images: [{ id: "image", name: "image", mimeType: "image/png" }] },
    { ...thought("boundary"), compression: { number: 1, title: "压缩", before: 100, after: 50 } },
    message("boundary", "user"), message("boundary", "notice"),
  ]) {
    assert.deepEqual(threadGroups([first, boundary, thought("t"), second]), [group(true, "first"), group(false, "boundary"), group(true, "t", "second")]);
    assert.deepEqual(threadGroups([thought("t"), boundary, second]), [group(true, "t"), group(false, "boundary"), group(true, "second")]);
  }
});

const failures: Partial<ChatMessage>[] = [
  { error: "Model request failed" },
  { status: "failed" },
  { status: "cancelled" },
];

test("threadGroups: assistant errors, failures and cancellations remain standalone boundaries", () => {
  for (const failure of failures) {
    assert.deepEqual(threadGroups([
      message("first", "assistant", true),
      { ...message("boundary", "assistant", true), ...failure },
      message("second", "assistant", true),
    ]), [group(true, "first"), group(false, "boundary"), group(true, "second")]);
  }
});

test("threadGroups: failed tool results remain omitted and do not split activity", () => {
  for (const failure of failures) {
    assert.deepEqual(threadGroups([
      message("first", "assistant", true),
      { ...message("tool", "toolResult"), ...failure },
      message("second", "assistant", true),
    ]), [group(true, "first", "second")]);
  }
});

test("threadGroups: IDs stay anchored to the first message, with no body data or mutation", () => {
  const first = message("first", "assistant", true);
  const original = structuredClone(first);
  Object.freeze(first);
  const initial = threadGroups([first]);
  assert.deepEqual(
    threadGroups([first, message("second", "assistant", true)]),
    [group(true, "first", "second")],
  );
  assert.deepEqual(initial, [group(true, "first")]);
  assert.deepEqual(first, original);
  assert.deepEqual(
    threadGroups([{ ...first, text: "streamed body", thinking: "reasoning" }]),
    initial,
  );
});

test("threadGroups: the last message joins preceding activity when its first call arrives", () => {
  const first = message("first", "assistant", true);
  const last = message("last");
  assert.deepEqual(threadGroups([first, last]), [group(true, "first"), group(false, "last")]);
  assert.deepEqual(
    threadGroups([first, { ...last, calls: first.calls }]),
    [group(true, "first", "last")],
  );
});

test("threadGroups: sliced pages contain only their own IDs and have local anchors", () => {
  const messages = [
    message("first", "assistant", true),
    message("tool", "toolResult"),
    message("second", "assistant", true),
    message("third", "assistant", true),
  ];
  assert.deepEqual(threadGroups(messages.slice(0, 2)), [group(true, "first")]);
  assert.deepEqual(threadGroups(messages.slice(1)), [group(true, "second", "third")]);
});

test("AgentViews: returns the complete selected context without pagination", (t) => {
  const messages = Array.from({ length: 125 }, (_, i) =>
    message(`m-${i}`, i % 2 ? "toolResult" : "assistant", i % 2 === 0));
  const { views, scope } = fixture(t, messages);
  assert.deepEqual(layout(views.thread(scope)), {
    ids: messages.map((item) => item.id), groups: threadGroups(messages),
  });
});

test("AgentViews: empty and populated contexts have no pagination cursor", (t) => {
  const { views, scope } = fixture(t);
  assert.deepEqual(layout(views.thread(scope)), { ids: [], groups: [] });
  const messages = Array.from({ length: 60 }, (_, i) => message(`m-${i}`, "user"));
  views.messages.set(scope.sessionId, new Map(messages.map((item) => [item.id, item])));
  assert.deepEqual(layout(views.thread(scope)), {
    ids: messages.map((item) => item.id),
    groups: threadGroups(messages),
  });
});

test("AgentViews: first calls on an existing last message publish a new group index", (t) => {
  const first = message("first", "assistant", true);
  const last = message("last");
  const { views, scope, events } = fixture(t, [first, last]);
  const updated = { ...last, calls: first.calls };
  views.messageChanged(scope, updated);
  assert.deepEqual(events.slice(), [{
    scope: threadScope(scope),
    data: { ids: ["first", "last"], groups: [group(true, "first", "last")] },
  }]);
  views.flush(scope);
  assert.equal(events[1].scope, messageScope(scope, "last"));
  assert.deepEqual((events[1].data as ChatMessage).calls, updated.calls);
});

test("AgentViews: text, thinking, call input/count and tool progress do not republish layout", (t) => {
  const first = message("first", "assistant", true);
  const plain = { ...message("plain"), calls: [] };
  const tool = message("tool", "toolResult");
  const { views, scope, events } = fixture(t, [first, plain, tool]);
  views.messageChanged(scope, { ...first, text: "delta", thinking: "reasoning", streaming: true });
  views.messageChanged(scope, {
    ...first,
    calls: [
      { ...first.calls![0], input: '{"path":"file"}' },
      { id: "extra", name: "write", input: "{}" },
    ],
    status: "completed",
  });
  views.messageChanged(scope, { ...plain, calls: undefined, text: "plain delta" });
  views.messageChanged(scope, { ...tool, text: "tool delta", status: "completed" });
  assert.deepEqual(events.slice(), []);
  views.flush(scope);
  assert.deepEqual(events.map((event) => event.scope), [
    messageScope(scope, "first"), messageScope(scope, "plain"), messageScope(scope, "tool"),
  ]);
});

test("AgentViews: removed calls and role changes republish structure", (t) => {
  const first = message("first", "assistant", true);
  const last = message("last", "assistant", true);
  const { views, scope, events } = fixture(t, [first, last]);
  for (const updated of [
    { ...last, calls: [] },
    message("last", "toolResult"),
    message("last", "user"),
    message("last", "notice"),
    message("last", "assistant", true),
  ]) {
    events.length = 0;
    views.messageChanged(scope, updated);
    assert.deepEqual(events, [{
      scope: threadScope(scope),
      data: {
        ids: ["first", "last"],
        groups: threadGroups([first, updated]),
      },
    }]);
    views.flush(scope);
  }
});

test("AgentViews: the first delegate call publishes its process group", (t) => {
  const last = message("last");
  const { views, scope, events } = fixture(t, [last]);
  views.messageChanged(scope, {
    ...last,
    calls: [{ id: "task", name: "delegate", input: "{}" }],
  });
  assert.deepEqual(events, [{
    scope: threadScope(scope),
    data: { ids: ["last"], groups: [group(true, "last")] },
  }]);
});

test("AgentViews: changing a regular call to delegate preserves the group index", (t) => {
  const first = message("first", "assistant", true);
  const last = message("last", "assistant", true);
  const { views, scope, events } = fixture(t, [first, last]);
  const delegated = { ...last, calls: [{ ...last.calls![0], name: "delegate" }] };
  views.messageChanged(scope, delegated);
  assert.deepEqual(events, []);
  views.flush(scope);
  events.length = 0;
  views.messageChanged(scope, { ...delegated, text: "task progress" });
  assert.deepEqual(events, []);
  views.messageChanged(scope, last);
  assert.deepEqual(events, []);
});

test("AgentViews: assistant failures publish split groups and recovery restores grouping", (t) => {
  const first = message("first", "assistant", true);
  const middle = message("middle", "assistant", true);
  const last = message("last", "assistant", true);
  const { views, scope, events } = fixture(t, [first, middle, last]);
  for (const failure of failures) {
    events.length = 0;
    const failed = { ...middle, ...failure };
    views.messageChanged(scope, failed);
    assert.deepEqual(events.slice(), [{
      scope: threadScope(scope),
      data: {
        ids: ["first", "middle", "last"],
        groups: [group(true, "first"), group(false, "middle"), group(true, "last")],
      },
    }]);
    views.flush(scope);
    events.length = 0;
    views.messageChanged(scope, { ...failed, text: "Updated failure details" });
    assert.deepEqual(events.slice(), []);
    views.flush(scope);
    events.length = 0;
    views.messageChanged(scope, middle);
    assert.deepEqual(events.slice(), [{
      scope: threadScope(scope),
      data: {
        ids: ["first", "middle", "last"],
        groups: [group(true, "first", "middle", "last")],
      },
    }]);
    views.flush(scope);
  }
});

test("AgentViews: failed tool updates publish only the message, not the layout", (t) => {
  const first = message("first", "assistant", true);
  const tool = message("tool", "toolResult");
  const last = message("last", "assistant", true);
  const { views, scope, events } = fixture(t, [first, tool, last]);
  for (const failure of failures) {
    events.length = 0;
    views.messageChanged(scope, { ...tool, ...failure });
    assert.deepEqual(events.slice(), []);
    views.flush(scope);
    assert.deepEqual(events.map((event) => event.scope), [messageScope(scope, "tool")]);
    assert.deepEqual(views.thread(scope).groups, [group(true, "first", "last")]);
  }
});

test("AgentViews: pure thinking classification changes publish layout, content deltas do not", (t) => {
  const first = message("first", "assistant", true);
  const last: ChatMessage = { id: "last", role: "assistant", text: "", streaming: true };
  const { views, scope, events } = fixture(t, [first, last]);
  const updates = [
    { ...last, thinkingActive: true },
    { ...thought("last"), thinking: "第一段" },
    { ...thought("last"), thinking: "更多思考" },
    { ...thought("last"), thinkingActive: false, streaming: false },
    { ...thought("last"), text: "现在是最终答复" },
    { ...thought("last"), text: "现在是最终答复的增量" },
    { ...thought("last"), status: "cancelled" as const },
    thought("last"),
  ];
  const expected = [true, false, false, false, true, false, false, true];
  for (const [i, updated] of updates.entries()) {
    events.length = 0;
    views.messageChanged(scope, updated);
    assert.equal(events.some((event) => event.scope === threadScope(scope)), expected[i], `update ${i}`);
    assert.deepEqual(views.thread(scope).groups, threadGroups([first, updated]));
    views.flush(scope);
  }
});

test("AgentViews: fresh messages still publish the index, including new tool results", (t) => {
  const { views, scope, events } = fixture(t);
  for (const item of [message("first", "assistant", true), message("tool", "toolResult")]) {
    events.length = 0;
    views.messageChanged(scope, item);
    assert.equal(events.length, 1);
    assert.equal(events[0].scope, threadScope(scope));
    assert.deepEqual(events[0].data, layout(views.thread(scope)));
    views.flush(scope);
  }
  assert.deepEqual(layout(views.thread(scope)), {
    ids: ["first", "tool"], groups: [group(true, "first")],
  });
});
