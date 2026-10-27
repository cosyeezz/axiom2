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
  text: activity ? "" : `Body ${id}`,
  ...(activity ? { calls: [{ id: `call-${id}`, name: "read", input: "{}" }] } : {}),
});
const group = (activity: boolean, ...ids: string[]) => ({
  id: activity ? `process:${ids[0]}` : ids[0],
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

test("AgentViews: cache reload must compare the previous stream before applying new calls", (t) => {
  const { views, scope, events } = fixture(t);
  const first = { ...message("first", "assistant", true), streaming: true };
  const reply = { ...thought("reply"), text: "继续检查" };
  views.messageChanged(scope, first);
  views.messageChanged(scope, reply);
  views.flush(scope);
  views.messages.delete(scope.sessionId);
  events.length = 0;
  const withCalls = { ...reply, calls: message("reply", "assistant", true).calls };
  views.messageChanged(scope, withCalls);
  assert.deepEqual(events.filter(e => e.scope === threadScope(scope)).map(e => e.data), [
    { ids: ["first", "reply"], groups: [
      { ...group(true, "first", "reply"), thinkingOnlyIds: ["reply"] },
      { ...group(false, "reply"), hideThinking: true },
      { ...group(true, "reply"), id: "calls:reply", callsOnlyIds: ["reply"] },
    ] },
  ], "the first call publishes a new process after the existing body even after cache eviction");
  views.flush(scope);

  views.messages.delete(scope.sessionId);
  events.length = 0;
  views.messageChanged(scope, { ...thought("new"), thinking: undefined, thinkingActive: false });
  assert.equal(events.filter(e => e.scope === threadScope(scope)).length, 1, "a new streaming message publishes its ID after cache eviction");
});

test("AgentViews: appended input ownership changes invalidate the cached layout", t => {
  const process = message("earlier", "assistant", true);
  const input = message("append", "user");
  const final: ChatMessage = { ...message("final"), phase: "final_answer", status: "completed" };
  const { views, scope, events } = fixture(t, [process, input, final]);
  assert.ok(!views.thread(scope).groups?.find(g => g.ids.includes(process.id))?.folded);
  for (const inputContinuation of [true, undefined]) {
    events.length = 0;
    views.messageChanged(scope, { ...input, inputContinuation });
    assert.equal(events.some(e => e.scope === threadScope(scope)), true);
    assert.equal(!!views.thread(scope).groups?.find(g => g.ids.includes(process.id))?.folded, !!inputContinuation);
    views.flush(scope);
  }
});

test("threadGroups: invisible assistant placeholders do not split a process", () => {
  for (const text of ["", " ", "\n\t"]) {
    const empty: ChatMessage = { id: "empty", role: "assistant", text, streaming: true };
    assert.deepEqual(threadGroups([message("first", "assistant", true), empty, message("next", "assistant", true)]),
      [group(true, "first", "next")]);
    assert.deepEqual(threadGroups([empty]), []);
    for (const visible of [
      { images: [{ id: "image", name: "image", mimeType: "image/png" }] },
      { compression: { number: 1, title: "压缩", before: 100, after: 50 } },
      { text: "实际正文" },
    ]) assert.deepEqual(threadGroups([message("first", "assistant", true), { ...empty, ...visible }, message("next", "assistant", true)]),
      [group(true, "first"), group(false, "empty"), group(true, "next")]);
  }
});

test("AgentViews: placeholder visibility republishes layout, subsequent text deltas do not", (t) => {
  const first = message("first", "assistant", true), next = message("next", "assistant", true);
  const empty: ChatMessage = { id: "empty", role: "assistant", text: "", streaming: true };
  const { views, scope, events } = fixture(t, [first, empty, next]);
  for (const [text, changed] of [["正文", true], ["正文增量", false], [" \n", true]] as const) {
    events.length = 0;
    views.messageChanged(scope, { ...empty, text });
    assert.equal(events.some(e => e.scope === threadScope(scope)), changed);
    assert.deepEqual(views.thread(scope).groups, threadGroups([first, { ...empty, text }, next]));
    views.flush(scope);
  }
});

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
  ]), [{ ...group(true, "first", "task", "second"), hasTasks: true }]);
  assert.deepEqual(threadGroups([
    { ...delegated, calls: delegated.calls!.slice(1) },
    { ...delegated, id: "another-task" },
  ]), [{ ...group(true, "task", "another-task"), hasTasks: true }]);
});

test("threadGroups: all task tools join activity, including namespaced and mixed calls", () => {
  for (const name of ["delegate", "read_result", "append", "cancel_task"]) {
    for (const prefix of ["", "functions."]) {
      const special = { ...message("task", "assistant", true), calls: [{ id: "special", name: prefix + name, input: "{}" }] };
      for (const calls of [special.calls, [...special.calls, ...message("other", "assistant", true).calls!]]) {
        assert.deepEqual(threadGroups([message("before", "assistant", true), { ...special, calls }, message("after", "assistant", true)]),
          [{ ...group(true, "before", "task", "after"), hasTasks: true }]);
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
          { ...group(true, "before", "between", "task", "after"), hasTasks: true },
        ]);
      }
      assert.deepEqual(threadGroups([task, after]), [{ ...group(true, "task", "after"), hasTasks: true }]);
      assert.deepEqual(threadGroups([thought("leading"), task]), [{ ...group(true, "leading", "task"), hasTasks: true }]);
      for (const boundary of [
        { error: "出错" }, { status: "failed" as const }, { status: "cancelled" as const },
      ]) {
        assert.deepEqual(threadGroups([before, { ...task, ...boundary }, after]), [{ ...group(true, "before", "task", "after"), hasTasks: true }]);
      }
      assert.deepEqual(threadGroups([before, message("user", "user"), task]), [group(true, "before"), group(false, "user"), { ...group(true, "task"), hasTasks: true }]);
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
    [{ ...withThinking, text: "正文出现" }, true],
    [withThinking, true], [{ ...withThinking, status: "cancelled" }, false],
    [withThinking, false], [task, false],
  ];
  for (const [updated, layoutChanged] of updates) {
    events.length = 0;
    views.messageChanged(scope, updated);
    assert.equal(events.some((event) => event.scope === threadScope(scope)), layoutChanged);
    assert.deepEqual(views.thread(scope).groups, threadGroups([before, updated]));
    views.flush(scope);
  }
});

test("threadGroups: reply thinking stays with preceding activity while its body remains a boundary", () => {
  const first = message("first", "assistant", true);
  const second = message("second", "assistant", true);
  for (const body of [
    { text: "普通正文" },
    { images: [{ id: "image", name: "image", mimeType: "image/png" }] },
  ]) {
    const reply = { ...thought("reply"), ...body };
    for (const preceding of [first, thought("first")]) {
      assert.deepEqual(threadGroups([preceding, message("result", "toolResult"), reply, second]), [
        { ...group(true, "first", "reply"), thinkingOnlyIds: ["reply"] },
        { ...group(false, "reply"), hideThinking: true },
        group(true, "second"),
      ]);
    }
    const isolated = [{ ...group(true, "reply"), thinkingOnlyIds: ["reply"] }, { ...group(false, "reply"), hideThinking: true }];
    assert.deepEqual(threadGroups([reply, second]), [...isolated, group(true, "second")]);
    assert.deepEqual(threadGroups([first, message("user", "user"), reply]), [
      group(true, "first"), group(false, "user"), ...isolated,
    ]);
  }
});

test("threadGroups: failed replies attach thinking to the previous process without another card before their body", () => {
  for (const status of ["failed", "cancelled"] as const) {
    const reply: ChatMessage = { ...thought("reply"), text: "保留的回复正文", status, error: status === "failed" ? "请求失败" : undefined };
    assert.deepEqual(threadGroups([message("first", "assistant", true), reply, message("next", "assistant", true)]), [
      { ...group(true, "first", "reply"), thinkingOnlyIds: ["reply"] },
      { ...group(false, "reply"), hideThinking: true },
      group(true, "next"),
    ]);
  }
});

test("AgentViews: reply thinking added or removed republishes layout, subsequent deltas do not", (t) => {
  const first = message("first", "assistant", true);
  const reply = message("reply");
  const { views, scope, events } = fixture(t, [first, reply]);
  const updates: [ChatMessage, boolean][] = [
    [{ ...reply, thinking: "复核" }, true],
    [{ ...reply, thinking: "继续复核", text: "正文增量" }, false],
    [reply, true],
  ];
  for (const [updated, changed] of updates) {
    events.length = 0;
    views.messageChanged(scope, updated);
    assert.equal(events.some(event => event.scope === threadScope(scope)), changed);
    assert.deepEqual(views.thread(scope).groups, threadGroups([first, updated]));
    views.flush(scope);
  }
});

test("threadGroups: pure thinking never crosses visible boundaries", () => {
  const first = message("first", "assistant", true);
  const second = message("second", "assistant", true);
  for (const boundary of [
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

test("threadGroups: failed/cancelled tools, thinking and error-only attempts join one process", () => {
  for (const failure of failures) {
    for (const attempt of [
      message("attempt", "assistant", true),
      thought("attempt"),
      { id: "attempt", role: "assistant" as const, text: "" },
    ]) {
      assert.deepEqual(threadGroups([
        message("first", "assistant", true),
        { ...attempt, ...failure },
        message("second", "assistant", true),
      ]), [group(true, "first", "attempt", "second")]);
    }
    assert.deepEqual(threadGroups([
      message("first", "assistant", true),
      { ...message("reply"), ...failure },
      message("second", "assistant", true),
    ]), [group(true, "first"), group(false, "reply"), group(true, "second")], "independent reply text remains a boundary");
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
    [{ ...group(true, "first"), thinkingOnlyIds: ["first"] }, { ...group(false, "first"), hideThinking: true },
      { ...group(true, "first"), id: "calls:first", callsOnlyIds: ["first"] }],
  );
});

test("threadGroups: a first call stays after the body instead of merging across it", () => {
  const first = message("first", "assistant", true);
  const last = message("last");
  assert.deepEqual(threadGroups([first, last]), [group(true, "first"), group(false, "last")]);
  assert.deepEqual(
    threadGroups([first, { ...last, calls: first.calls }]),
    [group(true, "first"), { ...group(false, "last"), hideThinking: true },
      { ...group(true, "last"), id: "calls:last", callsOnlyIds: ["last"] }],
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
    data: { ids: ["first", "last"], groups: [group(true, "first"), { ...group(false, "last"), hideThinking: true },
      { ...group(true, "last"), id: "calls:last", callsOnlyIds: ["last"] }] },
  }]);
  views.flush(scope);
  assert.equal(events[1].scope, messageScope(scope, "last"));
  // The wire projection also carries input revisions and summaries; this layout
  // regression checks that the original calls reach the newly grouped message.
  assert.deepEqual((events[1].data as ChatMessage).calls?.map(({ id, name, input }) => ({ id, name, input })), updated.calls);
});

test("AgentViews: text, thinking, call input/count and tool progress do not republish layout", (t) => {
  const first = { ...message("first", "assistant", true), text: "initial", thinking: "initial thought" };
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
    data: { ids: ["last"], groups: [{ ...group(false, "last"), hideThinking: true },
      { ...group(true, "last"), id: "calls:last", callsOnlyIds: ["last"], hasTasks: true }] },
  }]);
  views.flush(scope);
  assert.equal(events[1]?.scope, messageScope(scope, "last"), "task hydration receives the queued message delta");
});

test("AgentViews: changing a regular call to delegate republishes task hydration metadata", (t) => {
  const first = message("first", "assistant", true);
  const last = { ...message("last", "assistant", true), text: "initial task progress" };
  const { views, scope, events } = fixture(t, [first, last]);
  const delegated = { ...last, calls: [{ ...last.calls![0], name: "delegate" }] };
  views.messageChanged(scope, delegated);
  assert.deepEqual(events, [{ scope: threadScope(scope), data: { ids: ["first", "last"], groups: threadGroups([first, delegated]) } }]);
  views.flush(scope);
  events.length = 0;
  views.messageChanged(scope, { ...delegated, text: "task progress" });
  assert.deepEqual(events, []);
  views.messageChanged(scope, last);
  assert.deepEqual(events, [{ scope: threadScope(scope), data: { ids: ["first", "last"], groups: threadGroups([first, last]) } }]);
});

test("AgentViews: assistant tool failures and recovery retain the group and publish only message updates", (t) => {
  const first = message("first", "assistant", true);
  const middle = message("middle", "assistant", true);
  const last = message("last", "assistant", true);
  const { views, scope, events } = fixture(t, [first, middle, last]);
  for (const failure of failures) {
    for (const updated of [{ ...middle, ...failure }, { ...middle, ...failure, error: "Updated failure details" }, middle]) {
      events.length = 0;
      views.messageChanged(scope, updated);
      assert.deepEqual(events.slice(), []);
      assert.deepEqual(views.thread(scope).groups, [group(true, "first", "middle", "last")]);
      views.flush(scope);
      assert.deepEqual(events.map(event => event.scope), [messageScope(scope, "middle")]);
    }
  }
});

test("AgentViews: error-only attempts join activity and independent body text restores a boundary", (t) => {
  const first = message("first", "assistant", true);
  const last: ChatMessage = { id: "last", role: "assistant", text: "" };
  const { views, scope, events } = fixture(t, [first, last]);
  for (const updated of [
    { ...last, error: "请求失败", status: "failed" as const },
    { ...last, text: "独立说明", error: "请求失败", status: "failed" as const },
    { ...last, status: "cancelled" as const },
    { ...last, compression: { number: 1, title: "压缩", before: 100, after: 50 } },
  ]) {
    events.length = 0;
    views.messageChanged(scope, updated);
    assert.equal(events.some(event => event.scope === threadScope(scope)), true);
    assert.deepEqual(views.thread(scope).groups, threadGroups([first, updated]));
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
  const expected = [true, false, false, false, true, false, true, false];
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
