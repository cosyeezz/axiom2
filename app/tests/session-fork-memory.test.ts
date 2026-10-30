import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { rewriteFixture, until } from "./rewrite-fixture.js";
import { memoryDirectory } from "../src/server/memory-files.js";
import { memoryInstruction } from "../src/shared/memory.js";
import type { SessionEnvironment } from "../src/shared/agent.js";
import type { Session } from "../src/shared/protocol.js";

test("fork inherits current memory at any message cut and uses independent paths in preview, worker and reload", { timeout: 90000 }, async () => {
  const f = await rewriteFixture();
  try {
    await f.call("prompt", { text: "SOURCE_MESSAGE" }); await f.idle();
    const first = f.app.agents.messages(f.scope).find(message => message.role === "user")!;
    const source = memoryDirectory(f.root, f.scope.sessionId);
    const main = "# [In progress] 目标\n## [Completed] 核验\n";
    mkdirSync(join(source, "details", "目标"), { recursive: true });
    writeFileSync(join(source, "MEMORY.md"), main);
    writeFileSync(join(source, "details", "目标.md"), `当前证据 [子步骤](<${source}/details/目标/核验.md>)`);
    writeFileSync(join(source, "details", "目标", "核验.md"), "VERIFIED");
    const requestId = randomUUID(), params = { messageId: first.id };
    const branch = await f.call("agent.fork", params, f.scope, requestId) as Session;
    const scope = { ...f.scope, sessionId: branch.id }, target = memoryDirectory(f.root, branch.id);
    assert.notEqual(target, source);
    assert.equal(readFileSync(join(target, "MEMORY.md"), "utf8"), main);
    assert.equal(f.app.agents.memories.read(scope).content, main);
    assert.equal(f.app.agents.memories.read(scope, "details/目标/核验.md").content, "VERIFIED");
    assert.equal(readFileSync(join(target, "details", "目标.md"), "utf8"), `当前证据 [子步骤](<${target}/details/目标/核验.md>)`);
    assert.equal(f.app.agents.info(scope).memoryDirectory, target);
    const preview = await f.call("agent.environment", {}, scope) as SessionEnvironment;
    assert.ok(preview.systemPrompt!.includes(memoryInstruction(join(target, "MEMORY.md"))));
    assert.ok(!preview.systemPrompt!.includes(source));
    writeFileSync(join(source, "details", "目标", "核验.md"), "SOURCE_LATER");
    writeFileSync(join(target, "MEMORY.md"), main.replace("In progress", "Completed"));
    assert.deepEqual(await f.call("agent.fork", params, f.scope, requestId), branch);
    assert.equal(readFileSync(join(target, "MEMORY.md"), "utf8"), main.replace("In progress", "Completed"));
    assert.equal(readFileSync(join(source, "MEMORY.md"), "utf8"), main);
    assert.equal(readFileSync(join(target, "details", "目标", "核验.md"), "utf8"), "VERIFIED");
    for (const text of ["BRANCH_FIRST", "BRANCH_REOPENED"]) {
      await f.call("prompt", { text }, scope); await f.idle(scope);
      const system = f.requests.at(-1).messages.filter((message: { role: string }) => ["system", "developer"].includes(message.role));
      assert.ok(JSON.stringify(system).includes(target));
      assert.ok(!JSON.stringify(system).includes(source));
      assert.ok(f.app.agents.info(scope).environment!.systemPrompt!.includes(memoryInstruction(join(target, "MEMORY.md"))));
      await f.app.agents.releaseIdle(scope);
    }
    await f.call("agent.reload", {}, scope);
    await until(() => !f.app.agents.reloads.active(scope), "branch reload did not settle");
    assert.equal(f.app.agents.reloads.state(scope)?.status, "completed");
    const reloaded = await f.call("agent.environment", {}, scope) as SessionEnvironment;
    assert.ok(reloaded.systemPrompt!.includes(memoryInstruction(join(target, "MEMORY.md"))));
    assert.ok(!reloaded.systemPrompt!.includes(source));
    // A fork of a fork must inherit the branch's latest memory, never its ancestor's.
    const nested = await f.call("agent.fork", {}, scope) as Session;
    const nestedRoot = memoryDirectory(f.root, nested.id);
    assert.equal(readFileSync(join(nestedRoot, "MEMORY.md"), "utf8"), main.replace("In progress", "Completed"));
    assert.equal(readFileSync(join(nestedRoot, "details", "目标.md"), "utf8"), `当前证据 [子步骤](<${nestedRoot}/details/目标/核验.md>)`);
  } finally { await f.close(); }
});

test("fork rolls back memory, transcript, session and receipt together on copy or later validation failure", { timeout: 30000 }, async () => {
  const f = await rewriteFixture();
  try {
    const source = memoryDirectory(f.root, f.scope.sessionId), parent = dirname(source);
    writeFileSync(join(source, "MEMORY.md"), "# [Completed] 原记忆\n");
    const before = readdirSync(parent).sort();
    const sessions = () => f.app.store.db.prepare("SELECT id FROM sessions ORDER BY id").all();
    const original = sessions();
    const transcriptFiles = () => existsSync(join(f.root, "sessions")) ? readdirSync(join(f.root, "sessions"), { recursive: true }).filter(path => String(path).endsWith(".jsonl")).sort() : [];
    const files = transcriptFiles();
    const invalidDraftRequest = randomUUID();
    await assert.rejects(f.call("agent.fork", { draft: { text: 42 } }, f.scope, invalidDraftRequest), { code: "INVALID_INPUT" });
    assert.deepEqual(readdirSync(parent).sort(), before);
    assert.deepEqual(sessions(), original);
    assert.deepEqual(transcriptFiles(), files);
    assert.equal(f.app.store.db.prepare("SELECT 1 FROM requests WHERE id=?").get(invalidDraftRequest), undefined);
    const bad = join(source, "alias.md"), outside = join(f.root, "outside.md");
    writeFileSync(outside, "PRIVATE"); symlinkSync(outside, bad);
    const failedRequest = randomUUID();
    await assert.rejects(f.call("agent.fork", {}, f.scope, failedRequest), { code: "MEMORY_PATH" });
    assert.deepEqual(readdirSync(parent).sort(), before);
    assert.deepEqual(sessions(), original);
    assert.deepEqual(transcriptFiles(), files);
    assert.equal(f.app.store.db.prepare("SELECT 1 FROM requests WHERE id=?").get(failedRequest), undefined);
    rmSync(bad);
    const branch = await f.call("agent.fork", {}, f.scope, failedRequest) as Session;
    assert.equal(readFileSync(join(memoryDirectory(f.root, branch.id), "MEMORY.md"), "utf8"), "# [Completed] 原记忆\n");
    assert.equal(readFileSync(outside, "utf8"), "PRIVATE");
  } finally { await f.close(); }
});

test("notification failure and receipt replay preserve the committed memory without recopying or repairing it", { timeout: 30000 }, async () => {
  const f = await rewriteFixture();
  try {
    const source = memoryDirectory(f.root, f.scope.sessionId);
    writeFileSync(join(source, "MEMORY.md"), "# [In progress] 原目标\n");
    const requestId = randomUUID();
    const publish = mock.method(f.app.agents, "publish", () => { throw Error("fixture notification failure"); });
    try { await assert.rejects(f.call("agent.fork", {}, f.scope, requestId), /fixture notification failure/); }
    finally { publish.mock.restore(); }
    const row = f.app.store.db.prepare("SELECT id FROM sessions WHERE forkParentSessionId=?").get(f.scope.sessionId)!;
    const target = memoryDirectory(f.root, String(row.id)), entry = join(target, "MEMORY.md");
    assert.equal(readFileSync(entry, "utf8"), "# [In progress] 原目标\n");
    writeFileSync(entry, "# [Completed] 原目标\n");
    rmSync(source, { recursive: true });
    const branch = await f.call("agent.fork", {}, f.scope, requestId) as Session;
    assert.equal(branch.id, row.id);
    assert.equal(readFileSync(entry, "utf8"), "# [Completed] 原目标\n");
    rmSync(entry);
    await f.call("agent.fork", {}, f.scope, requestId);
    assert.equal(existsSync(entry), false, "receipt replay is not memory initialization");
  } finally { await f.close(); }
});
