import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "./temporary.js";
import { PathActions } from "../src/server/path-actions.js";
import { FileManager, FileManagerError } from "../src/server/file-manager.js";
import { Terminal, TerminalError } from "../src/server/terminal.js";
import { Store } from "../src/server/storage.js";
import { Memories } from "../src/server/memories.js";
import { memoryDirectory } from "../src/server/memory-files.js";
import { isLocalPath, jsonLocalPaths, pathRelativeToFile } from "../src/shared/local-paths.js";
import type { Command, Session, Workspace } from "../src/shared/protocol.js";
const command = (path: string, op = "paths.resolve"): Command => ({ requestId: crypto.randomUUID(), op, workspaceId: "project", params: { path } });

test("path navigation preserves filenames, rejects URLs and decoded control characters, and requires authority for relative paths", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-path-actions-"));
  let authorized = true;
  const store = { workspace: () => ({ path: root, authorized }) } as unknown as Store;
  const paths = new PathActions(store, { open: async () => {} });
  try {
    const file = join(root, "中文 # & trailing ");
    assert.equal(paths.resolve(command(file)), file);
    assert.equal(paths.resolve(command(pathToFileURL(file).href)), file);
    assert.equal(paths.resolve(command("./a/../b.md")), join(root, "b.md"));
    assert.equal(paths.resolve(command("~/file.md")), join(homedir(), "file.md"));
    assert.equal(paths.resolve(command("../shared.md")), resolve(root, "../shared.md"));
    for (const input of ["", "https://example.com/file", "javascript:alert(1)", "file:///tmp/a%00b", "file:///tmp/a%0Ab", "file:///tmp/a#L2", "file:///tmp/a?x=1", "a\nb", "a".repeat(4097)])
      assert.throws(() => paths.resolve(command(input)), { code: "INVALID_INPUT" });
    assert.throws(() => paths.resolve({ ...command(file), params: { path: file, command: "anything" } }), { code: "INVALID_INPUT" });
    authorized = false;
    assert.throws(() => paths.resolve(command("relative.md")), { code: "AUTHORIZATION_REQUIRED" });
    assert.equal(paths.resolve(command(file)), file, "application-level absolute navigation remains available outside workspaces");
    await assert.rejects(paths.command(command(file), AbortSignal.abort()));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("reveal selects existing files, opens directories, handles an absent file, and preserves errors/cancellation", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-path-reveal-")), directory = join(root, "目录 with spaces");
  mkdirSync(directory); const file = join(directory, "run.sh"); writeFileSync(file, "never execute me");
  const calls: { directory: string; selection?: string }[] = [];
  const manager = new FileManager(async (directory, _signal, selection) => { calls.push({ directory, selection }); });
  const paths = new PathActions({} as Store, manager), signal = new AbortController().signal;
  try {
    for (const path of [directory, file, join(directory, "not-created.json")]) await paths.command(command(path, "paths.reveal"), signal);
    assert.deepEqual(calls, [{ directory, selection: undefined }, { directory, selection: file }, { directory, selection: undefined }]);
    await assert.rejects(paths.command(command(join(root, "missing", "file"), "paths.reveal"), signal), error => !!error && (error as any).code === "PATH_UNAVAILABLE" && !(error as Error).message.includes("数据未确认"));
    await assert.rejects(paths.command(command(file, "paths.reveal"), AbortSignal.abort()));
    assert.equal(calls.length, 3);
    const failure = new PathActions({} as Store, { open: async () => { throw new FileManagerError("正在打开文件夹，请稍候", 409); } });
    await assert.rejects(failure.command(command(file, "paths.reveal"), signal), { code: "PATH_UNAVAILABLE", message: "正在打开文件夹，请稍候" });
  } finally { await manager.close(); rmSync(root, { recursive: true, force: true }); }
});

test("terminal navigation uses the requested directory without executing path contents and preserves errors/cancellation", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-path-terminal-")), directory = join(root, "终端 路径 # & ' $(echo never)");
  mkdirSync(directory);
  const calls: string[] = [], terminal = new Terminal(async path => { calls.push(path); });
  const store = { workspace: () => ({ path: root, authorized: true }) } as unknown as Store;
  const paths = new PathActions(store, { open: async () => { throw Error("must not open file manager"); } }, terminal);
  const signal = new AbortController().signal;
  try {
    assert.equal(await paths.command(command(directory, "paths.terminal"), signal), directory);
    assert.equal(await paths.command(command(pathToFileURL(directory).href, "paths.terminal"), signal), directory);
    assert.equal(await paths.command(command("./" + directory.slice(root.length + 1), "paths.terminal"), signal), directory);
    assert.deepEqual(calls, [directory, directory, directory]);
    const file = join(root, "file.txt"); writeFileSync(file, "never execute");
    for (const path of [file, join(root, "missing")])
      await assert.rejects(paths.command(command(path, "paths.terminal"), signal), { code: "TERMINAL_UNAVAILABLE" });
    await assert.rejects(paths.command({ ...command(directory, "paths.terminal"), params: { path: directory, command: "echo not allowed" } }, signal), { code: "INVALID_INPUT" });
    await assert.rejects(paths.command(command(directory, "paths.terminal"), AbortSignal.abort()));
    assert.equal(calls.length, 3);
    const failure = new PathActions(store, { open: async () => {} }, { open: async () => { throw new TerminalError("正在打开终端，请稍候", 409); } });
    await assert.rejects(failure.command(command(directory, "paths.terminal"), signal), { code: "TERMINAL_UNAVAILABLE", message: "正在打开终端，请稍候" });
  } finally { await terminal.close(); rmSync(root, { recursive: true, force: true }); }
});

test("memory.resolve uses the memory directory and retains session/workspace authorization", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-memory-resolve-"));
  const store = new Store(root), memories = new Memories(store, () => {});
  try {
    const project = join(root, "project"); mkdirSync(project);
    const workspace = store.execute({ requestId: crypto.randomUUID(), op: "workspace.open", params: { path: project, authorized: true } }) as Workspace;
    const session = store.execute({ requestId: crypto.randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
    const c = { requestId: crypto.randomUUID(), op: "memory.resolve", workspaceId: workspace.id, sessionId: session.id, params: { path: "MEMORY.md" } };
    assert.equal(await memories.command(c), join(memoryDirectory(root, session.id), "MEMORY.md"));
    await assert.rejects(memories.command({ ...c, sessionId: "foreign-session" }));
    await assert.rejects(memories.command(c, AbortSignal.abort()));
    store.db.prepare("UPDATE workspaces SET authorized=0 WHERE id=?").run(workspace.id);
    await assert.rejects(memories.command(c), { code: "AUTHORIZATION_REQUIRED" });
  } finally { await memories.close(); store.close(); rmSync(root, { recursive: true, force: true }); }
});

test("structured path discovery excludes remote sources and resolves document-relative references", () => {
  for (const path of ["/tmp/a b.md", "C:\\Users\\a", "\\\\host\\share", "~/a", "./a", "../a", "file:///tmp/a"]) assert.equal(isLocalPath(path), true);
  for (const value of ["https://example.com", "npm:package", "历史会话环境", "/tmp/a\nb"]) assert.equal(isLocalPath(value), false);
  assert.deepEqual(jsonLocalPaths(JSON.stringify({ path: "src/a.ts", url: "https://example.com", env: { ROOT: "/tmp/root" }, args: ["--help"], duplicate: "/tmp/root" })), ["src/a.ts", "/tmp/root"]);
  assert.deepEqual(jsonLocalPaths('{"path":"/truncated'), []);
  assert.equal(pathRelativeToFile("../a.md", "/project/docs/guide.md"), "/project/docs/../a.md");
  assert.equal(pathRelativeToFile("/external/a.md", "/project/docs/guide.md"), "/external/a.md");
  assert.equal(pathRelativeToFile("child.md", "C:\\project\\guide.md"), "C:\\project\\child.md");
});
