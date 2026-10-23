import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../src/server/storage.js";
import type { Scope, Session, Workspace } from "../src/shared/protocol.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "axiom-title-storage-"));
  const project = join(root, "project");
  mkdirSync(project);
  let store = new Store(root);
  const w = store.execute({ op: "workspace.open", requestId: randomUUID(), params: { path: project, authorized: true } }) as Workspace;
  const create = (): Scope => {
    const s = store.execute({ op: "session.create", requestId: randomUUID(), workspaceId: w.id }) as Session;
    return { workspaceId: w.id, sessionId: s.id };
  };
  return {
    get store() { return store; }, create,
    restart() { store.close(); store = new Store(root); },
    close() { store.close(); rmSync(root, { recursive: true, force: true }); },
  };
}

test("title state: fallback, validation, manual CAS, restart and scope isolation", () => {
  const f = fixture();
  try {
    const a = f.create(), b = f.create();
    assert.equal(f.store.requestTitle(a, "  修复\n登录问题 [imag1]  "), true);
    assert.equal(f.store.session(a.workspaceId, a.sessionId).title, "修复 登录问题");
    assert.equal(f.store.requestTitle(b, "[img1]"), true);
    assert.equal(f.store.session(b.workspaceId, b.sessionId).title, "[图片]");
    assert.equal(f.store.generatedTitle(a, "超过十个字符的标题应拒绝保存"), false);
    assert.equal(f.store.requestTitle(a), true);
    assert.equal(f.store.generatedTitle(a, "登录修复"), true);
    assert.equal(f.store.generatedTitle(a, "不应覆盖"), false);
    assert.equal(f.store.requestTitle(a, "不应覆盖"), false);
    f.store.execute({ ...b, op: "session.rename", requestId: randomUUID(), params: { title: "新对话" } });
    assert.equal(f.store.generatedTitle(b, "迟到标题"), false, "manual placeholder is also authoritative");
    assert.equal(f.store.requestTitle(b, "输入兜底"), false);
    assert.throws(() => f.store.generatedTitle({ ...a, workspaceId: "foreign" }, "越界"));
    f.restart();
    assert.equal(f.store.requestTitle(a), false);
    assert.equal(f.store.session(a.workspaceId, a.sessionId).title, "登录修复");
    assert.equal(f.store.requestTitle(b), false);
    assert.equal(f.store.session(b.workspaceId, b.sessionId).title, "新对话");
  } finally { f.close(); }
});

test("fallback is Unicode bounded, stable after first run, and child sessions never generate titles", () => {
  const f = fixture();
  try {
    const a = f.create(), b = f.create();
    f.store.requestTitle(a, "😀".repeat(80));
    assert.equal([...f.store.session(a.workspaceId, a.sessionId).title].length, 60);
    f.store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt) VALUES(?,?,'completed','{}',?)").run(randomUUID(), a.sessionId, Date.now());
    f.store.requestTitle(a, "second message");
    assert.equal(f.store.session(a.workspaceId, a.sessionId).title, "😀".repeat(60));
    f.store.db.prepare("INSERT INTO tasks(id,workspaceId,parentSessionId,sessionId,anchor,description,status,budgets,createdAt) VALUES(?,?,?,?,'anchor','task','completed','{}',?)").run(randomUUID(), a.workspaceId, a.sessionId, b.sessionId, Date.now());
    assert.equal(f.store.requestTitle(b, "child input"), false);
    assert.equal(f.store.generatedTitle(b, "子任务标题"), false);
    assert.equal(f.store.session(b.workspaceId, b.sessionId).title, "新对话");
  } finally { f.close(); }
});

test("legacy title migration preserves named sessions and allows default names to generate", () => {
  const f = fixture();
  try {
    const a = f.create(), b = f.create();
    f.store.execute({ ...a, op: "session.rename", requestId: randomUUID(), params: { title: "已有手动名称" } });
    f.store.db.exec("ALTER TABLE sessions DROP COLUMN titleState");
    f.restart();
    assert.equal(f.store.requestTitle(a), false);
    assert.equal(f.store.generatedTitle(a, "不可覆盖"), false);
    assert.equal(f.store.session(a.workspaceId, a.sessionId).title, "已有手动名称");
    assert.equal(f.store.requestTitle(b), true);
    assert.equal(f.store.generatedTitle(b, "新标题"), true);
    f.restart();
    assert.equal(f.store.requestTitle(b), false);
  } finally { f.close(); }
});
