import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { rewriteFixture, until } from "./rewrite-fixture.js";
import { SessionDrafts } from "../src/server/session-drafts.js";
import { TaskRecords, target } from "../src/server/tasks/records.js";
import type { Compression } from "../src/shared/compression.js";
import type { Session } from "../src/shared/protocol.js";

test("fork preserves source and drafts, selects message context, survives reopening and deduplicates", { timeout: 90000 }, async () => {
  const f = await rewriteFixture();
  try {
    await f.call("prompt", { text: "FIRST [file1]", attachments: [{ id: "file1", name: "notes.txt", kind: "file", path: join(f.project, "notes.txt"), text: "" }] }); await f.idle();
    await f.call("prompt", { text: "SECOND" }); await f.idle();
    await f.call("prompt", { text: "THIRD" }); await f.idle();
    const messages = f.app.agents.messages(f.scope).filter(m => m !== null);
    const first = messages.find(m => m.role === "user" && m.text.startsWith("FIRST"))!;
    const second = messages.find(m => m.role === "user" && m.text === "SECOND")!;
    const reply = messages.find(m => m.text === "REWRITE_ANSWER_2")!;
    const file = (id: string) => String(f.app.store.db.prepare("SELECT file FROM agent_sessions WHERE sessionId=?").get(id)!.file);
    const original = readFileSync(file(f.scope.sessionId), "utf8");
    const drafts = new SessionDrafts(f.app.store);
    const sourceDraft = { text: "SOURCE_DRAFT", attachment: null };
    drafts.save(f.scope, { draft: sourceDraft, writer: "fixture", sequence: 1, revision: 0 });
    const requestId = randomUUID();
    const branch = await f.call("agent.fork", { messageId: second.id }, f.scope, requestId) as Session;
    const branchScope = { ...f.scope, sessionId: branch.id };
    assert.notEqual(branch.id, f.scope.sessionId);
    assert.equal(branch.forkParentSessionId, f.scope.sessionId);
    assert.equal(f.app.store.db.prepare("SELECT forkParentSessionId FROM sessions WHERE id=?").get(branch.id)!.forkParentSessionId, f.scope.sessionId);
    assert.deepEqual(await f.call("agent.fork", { messageId: second.id }, f.scope, requestId), branch);
    assert.equal(drafts.read(branchScope).draft.text, "SECOND");
    assert.equal(drafts.read(f.scope).draft.text, "SOURCE_DRAFT");
    assert.equal(readFileSync(file(f.scope.sessionId), "utf8"), original);
    const context = (id: string) => JSON.stringify(SessionManager.open(file(id)).buildSessionContext().messages);
    assert.match(context(branch.id), /FIRST|REWRITE_ANSWER_1/);
    assert.doesNotMatch(context(branch.id), /SECOND|THIRD|REWRITE_ANSWER_2|REWRITE_ANSWER_3/);
    assert.equal(SessionManager.open(file(branch.id)).getHeader()!.parentSession, file(f.scope.sessionId));
    assert.deepEqual(f.app.agents.info(branchScope).selection, f.app.agents.info(f.scope).selection);
    assert.deepEqual(f.app.store.db.prepare("SELECT selection,catalog FROM session_capabilities WHERE sessionId=?").get(branch.id),
      f.app.store.db.prepare("SELECT selection,catalog FROM session_capabilities WHERE sessionId=?").get(f.scope.sessionId));
    await f.call("prompt", { text: "BRANCH_SECOND" }, branchScope); await f.idle(branchScope);
    assert.match(JSON.stringify(f.requests.at(-1).messages), /FIRST/);
    assert.doesNotMatch(JSON.stringify(f.requests.at(-1).messages), /THIRD|REWRITE_ANSWER_2|REWRITE_ANSWER_3/);
    assert.equal(readFileSync(file(f.scope.sessionId), "utf8"), original);
    const replyBranch = await f.call("agent.fork", { messageId: reply.id }) as Session;
    assert.match(context(replyBranch.id), /SECOND/);
    assert.match(context(replyBranch.id), /REWRITE_ANSWER_2/);
    assert.doesNotMatch(context(replyBranch.id), /THIRD|REWRITE_ANSWER_3/);
    assert.equal(drafts.read({ ...f.scope, sessionId: replyBranch.id }).draft.text, "");
    const startBranch = await f.call("agent.fork", { messageId: first.id }) as Session;
    const startScope = { ...f.scope, sessionId: startBranch.id };
    assert.doesNotMatch(context(startBranch.id), /FIRST|SECOND|THIRD|REWRITE_ANSWER_/);
    assert.equal(drafts.read(startScope).draft.text, "FIRST [file1]");
    assert.equal(drafts.read(startScope).draft.attachments?.[0].name, "notes.txt");
    await f.call("prompt", { text: "FRESH_START" }, startScope); await f.idle(startScope);
    assert.doesNotMatch(JSON.stringify(f.requests.at(-1).messages), /FIRST|SECOND|THIRD|REWRITE_ANSWER_1/);
    const composer = await f.call("agent.fork", { draft: { text: "UNSAVED_DRAFT", attachment: null } }) as Session;
    assert.match(context(composer.id), /THIRD/);
    assert.equal(drafts.read({ ...f.scope, sessionId: composer.id }).draft.text, "UNSAVED_DRAFT");
    assert.equal(drafts.read(f.scope).draft.text, "SOURCE_DRAFT");
    assert.equal(readFileSync(file(f.scope.sessionId), "utf8"), original);
    const count = f.app.store.db.prepare("SELECT count(*) AS n FROM sessions").get()!.n;
    const files = readdirSync(join(f.root, "sessions"), { recursive: true }).sort();
    await assert.rejects(f.call("agent.fork", { messageId: "missing" }), { code: "NOT_FORKABLE" });
    await assert.rejects(f.call("agent.fork", { draft: { text: 42 } }), { code: "INVALID_INPUT" });
    assert.equal(f.app.store.db.prepare("SELECT count(*) AS n FROM sessions").get()!.n, count);
    assert.deepEqual(readdirSync(join(f.root, "sessions"), { recursive: true }).sort(), files);
  } finally { await f.close(); }
});

test("fork during streaming snapshots saved history without stopping or following the source", { timeout: 90000 }, async () => {
  const f = await rewriteFixture();
  try {
    await f.call("prompt", { text: "SAVED_INPUT" }); await f.idle();
    const reply = f.app.agents.messages(f.scope).find(m => m.text === "REWRITE_ANSWER_1")!;
    const drafts = new SessionDrafts(f.app.store);
    drafts.save(f.scope, { draft: { text: "SOURCE_DRAFT", attachment: null }, writer: "fixture", sequence: 1, revision: 0 });
    f.stall(true, "UNFINISHED_");
    const accepted = await f.call("prompt", { text: "IN_FLIGHT_INPUT" }) as { runId: string };
    await until(() => f.app.agents.messages(f.scope).some(m => m.streaming && m.text === "UNFINISHED_"), "source did not stream partial text");
    const live = f.app.agents.messages(f.scope);
    const input = live.find(m => m.role === "user" && m.text === "IN_FLIGHT_INPUT")!;
    const partial = live.find(m => m.streaming && m.text === "UNFINISHED_")!;
    const file = (id: string) => String(f.app.store.db.prepare("SELECT file FROM agent_sessions WHERE sessionId=?").get(id)!.file);
    const original = readFileSync(file(f.scope.sessionId), "utf8");
    const requestId = randomUUID();
    const branch = await f.call("agent.fork", {}, f.scope, requestId) as Session;
    const branchScope = { ...f.scope, sessionId: branch.id };
    assert.deepEqual(await f.call("agent.fork", {}, f.scope, requestId), branch);
    const snapshot = readFileSync(file(branch.id), "utf8");
    const context = (id: string) => JSON.stringify(SessionManager.open(file(id)).buildSessionContext().messages);
    assert.match(context(branch.id), /SAVED_INPUT/);
    assert.match(context(branch.id), /IN_FLIGHT_INPUT/);
    assert.doesNotMatch(snapshot, /UNFINISHED_|REWRITE_ANSWER_2/);
    const answerBranch = await f.call("agent.fork", { messageId: reply.id }) as Session;
    assert.match(context(answerBranch.id), /REWRITE_ANSWER_1/);
    assert.doesNotMatch(context(answerBranch.id), /IN_FLIGHT_INPUT/);
    const inputBranch = await f.call("agent.fork", { messageId: input.id }) as Session;
    assert.doesNotMatch(context(inputBranch.id), /IN_FLIGHT_INPUT/);
    assert.equal(drafts.read({ ...f.scope, sessionId: inputBranch.id }).draft.text, "IN_FLIGHT_INPUT");
    await assert.rejects(f.call("agent.fork", { messageId: partial.id }), { code: "NOT_FORKABLE" });
    assert.equal(readFileSync(file(f.scope.sessionId), "utf8"), original, "Fork never appends to or repairs the source");
    assert.equal(readFileSync(file(branch.id), "utf8"), snapshot);
    assert.equal(f.app.agents.info(f.scope).run?.id, accepted.runId);
    assert.equal(f.app.agents.active(f.scope), true);
    assert.equal(f.app.agents.info(branchScope).run, null);
    assert.equal(f.app.agents.info(branchScope).task, undefined);
    assert.deepEqual(f.app.agents.info(branchScope).queue, []);
    assert.equal(f.app.agents.info(branchScope).activeTaskCount, 0);
    // A new branch can run independently while the original response is still open.
    f.stall(false);
    await f.call("prompt", { text: "BRANCH_ONLY" }, branchScope); await f.idle(branchScope);
    assert.match(JSON.stringify(f.requests.at(-1).messages), /IN_FLIGHT_INPUT/);
    assert.doesNotMatch(JSON.stringify(f.requests.at(-1).messages), /UNFINISHED_|REWRITE_ANSWER_2/);
    assert.equal(f.app.agents.active(f.scope), true);
    const branchAfterRun = readFileSync(file(branch.id), "utf8");
    f.release(); await f.idle();
    assert.equal(f.app.agents.info(f.scope).run?.id, accepted.runId);
    assert.equal(f.app.agents.info(f.scope).run?.status, "completed");
    assert.ok(f.app.agents.messages(f.scope).some(m => m.text === "UNFINISHED_REWRITE_ANSWER_2"));
    assert.ok(readFileSync(file(f.scope.sessionId), "utf8").startsWith(original));
    assert.doesNotMatch(readFileSync(file(f.scope.sessionId), "utf8"), /BRANCH_ONLY/);
    assert.equal(readFileSync(file(branch.id), "utf8"), branchAfterRun, "later source output cannot join a branch");
    assert.equal(drafts.read(f.scope).draft.text, "SOURCE_DRAFT");
    assert.equal(f.requests.length, 3);
  } finally { await f.close(); }
});

test("fork never repairs a partial tail or migrates the source file", { timeout: 30000 }, async () => {
  const f = await rewriteFixture();
  try {
    await f.call("prompt", { text: "SAVED_INPUT" }); await f.idle();
    await f.app.agents.releaseIdle(f.scope);
    const file = String(f.app.store.db.prepare("SELECT file FROM agent_sessions WHERE sessionId=?").get(f.scope.sessionId)!.file);
    const lines = readFileSync(file, "utf8").trimEnd().split("\n");
    const header = { ...JSON.parse(lines[0]), version: 2 };
    const saved = [JSON.stringify(header), ...lines.slice(1)].join("\n");
    for (const tail of ["", '\n{"type":"message","id":"partial"']) {
      const original = saved + tail;
      writeFileSync(file, original);
      const branch = await f.call("agent.fork", {}) as Session;
      const branchFile = String(f.app.store.db.prepare("SELECT file FROM agent_sessions WHERE sessionId=?").get(branch.id)!.file);
      assert.equal(readFileSync(file, "utf8"), original, "source migration and trailing-newline repair are forbidden");
      const reopened = SessionManager.open(branchFile);
      assert.equal(reopened.getHeader()!.version, 3);
      assert.equal(reopened.getHeader()!.parentSession, file);
      assert.match(JSON.stringify(reopened.buildSessionContext().messages), /SAVED_INPUT/);
      assert.match(JSON.stringify(reopened.buildSessionContext().messages), /REWRITE_ANSWER_1/);
      assert.doesNotMatch(readFileSync(branchFile, "utf8"), /"id":"partial"/);
    }
  } finally { await f.close(); }
});

test("fork ignores pending task, queue and compression state without copying scheduling state", { timeout: 30000 }, async () => {
  const f = await rewriteFixture();
  try {
    await f.call("prompt", { text: "SAVED_INPUT" }); await f.idle();
    const records = new TaskRecords(f.app.store);
    records.freeze(f.scope);
    const { taskIds: [id] } = records.create(f.scope, "fixture", "context", [{ task: "PENDING_CHILD" }], f.selection);
    const child = target(records.rows("WHERE id=?", id)[0]);
    const queue = [{ id: randomUUID(), text: "PENDING_INPUT", mode: "followUp" as const }];
    f.app.agents.setQueue(f.scope, queue);
    const compression: Compression = { id: randomUUID(), requestId: randomUUID(), state: "running", phase: "summarizing",
      startedAt: Date.now(), endedAt: null, messageCount: 2, before: 100, after: null, summary: "", error: null,
      selection: f.selection, usage: null };
    f.app.store.db.prepare("INSERT INTO compressions(id,sessionId,body) VALUES(?,?,?)").run(compression.id, f.scope.sessionId, JSON.stringify(compression));
    // Admission coverage uses durable pending states, not a simulated running worker.
    for (const status of ["queued", "starting", "running", "stopping"]) {
      f.app.store.db.prepare("UPDATE tasks SET status=? WHERE id=?").run(status, id);
      const task = records.rows("WHERE id=?", id)[0];
      for (const source of [f.scope, child]) {
        const branch = await f.call("agent.fork", {}, source) as Session;
        const scope = { ...source, sessionId: branch.id };
        const info = f.app.agents.info(scope);
        assert.equal(branch.forkParentSessionId, source.sessionId);
        assert.equal(info.run, null); assert.equal(info.task, undefined);
        assert.equal(info.activeTaskCount, 0); assert.deepEqual(info.queue, []);
        assert.deepEqual(records.list(scope).tasks, []);
        assert.equal(f.app.agents.compressions.info(scope), null);
      }
      assert.deepEqual(records.rows("WHERE id=?", id)[0], task);
      assert.deepEqual(f.app.agents.info(f.scope).queue, queue);
      assert.deepEqual(f.app.agents.compressions.info(f.scope), compression);
    }
    f.app.store.db.prepare("UPDATE tasks SET status='completed' WHERE id=?").run(id);
    f.app.agents.setQueue(f.scope, []);
    f.app.store.db.prepare("DELETE FROM compressions WHERE id=?").run(compression.id);
    assert.equal(f.requests.length, 1, "Fork never dispatches queued source work");
  } finally { await f.close(); }
});

test("fork an unused conversation persists an independent empty transcript and draft", { timeout: 30000 }, async () => {
  const f = await rewriteFixture();
  try {
    const requestId = randomUUID();
    const publish = mock.method(f.app.agents, "publish", () => { throw new Error("fixture notification failure"); });
    try { await assert.rejects(f.call("agent.fork", { draft: { text: "NEW_DRAFT", attachment: null } }, f.scope, requestId), /fixture notification failure/); }
    finally { publish.mock.restore(); }
    // A committed fork remains usable even if its notification could not be sent.
    const fork = await f.call("agent.fork", { draft: { text: "NEW_DRAFT", attachment: null } }, f.scope, requestId) as Session;
    const scope = { ...f.scope, sessionId: fork.id };
    const row = f.app.store.db.prepare("SELECT file FROM agent_sessions WHERE sessionId=?").get(fork.id)!;
    assert.equal(SessionManager.open(String(row.file)).buildSessionContext().messages.length, 0);
    assert.equal(new SessionDrafts(f.app.store).read(scope).draft.text, "NEW_DRAFT");
    await f.call("prompt", { text: "FIRST_BRANCH_MESSAGE" }, scope); await f.idle(scope);
    assert.match(JSON.stringify(f.requests.at(-1).messages), /FIRST_BRANCH_MESSAGE/);
    assert.equal(f.app.agents.messages(f.scope).length, 0);
  } finally { await f.close(); }
});
