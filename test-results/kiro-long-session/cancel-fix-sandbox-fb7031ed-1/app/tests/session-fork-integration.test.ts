import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { rewriteFixture } from "./rewrite-fixture.js";
import { SessionDrafts } from "../src/server/session-drafts.js";
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
    const files = readdirSync(join(f.root, "sessions")).sort();
    await assert.rejects(f.call("agent.fork", { messageId: "missing" }), { code: "NOT_FORKABLE" });
    await assert.rejects(f.call("agent.fork", { draft: { text: 42 } }), { code: "INVALID_INPUT" });
    assert.equal(f.app.store.db.prepare("SELECT count(*) AS n FROM sessions").get()!.n, count);
    assert.deepEqual(readdirSync(join(f.root, "sessions")).sort(), files);
    f.stall(true); await f.call("prompt", { text: "BUSY" });
    await assert.rejects(f.call("agent.fork", {}), { code: "FORK_BUSY" });
    await f.app.tasks.stopParent(f.scope); await f.idle();
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
