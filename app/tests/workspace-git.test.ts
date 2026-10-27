import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { WorkspaceGit, readGitBranch } from "../src/server/workspace-git.js";
import { Store } from "../src/server/storage.js";
import type { Command, Workspace } from "../src/shared/protocol.js";
import { tmpdir } from "./temporary.js";

const signal = () => new AbortController().signal;
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "init.templateDir=", "-c", "core.hooksPath=", "-c", "commit.gpgsign=false", "-c", "user.name=Axiom Test", "-c", "user.email=test@example.invalid", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const command = (workspaceId?: string, params = {}): Command => ({ requestId: crypto.randomUUID(), op: "git.branch", workspaceId, params });

test("current branch handles unborn repos, exact names, nested cwd, worktrees, checkout and detached HEAD without writes", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-git-")), project = join(root, "项目 # with spaces"); mkdirSync(project);
  try {
    git(project, "init", "-b", "feature/title-badge");
    assert.deepEqual(await readGitBranch(project, signal()), { name: "feature/title-badge", detached: false });
    const nested = join(project, "src"); mkdirSync(nested);
    assert.deepEqual(await readGitBranch(nested, signal()), { name: "feature/title-badge", detached: false });
    git(project, "commit", "--allow-empty", "-m", "fixture");
    git(project, "tag", "feature/title-badge");
    assert.deepEqual(await readGitBranch(project, signal()), { name: "feature/title-badge", detached: false }, "matching tag does not add a heads/ prefix");
    const worktree = join(root, "linked"); git(project, "worktree", "add", "-b", "worktree/header", worktree);
    assert.deepEqual(await readGitBranch(worktree, signal()), { name: "worktree/header", detached: false });
    git(project, "checkout", "-b", "修复/标题分支");
    assert.deepEqual(await readGitBranch(project, signal()), { name: "修复/标题分支", detached: false });
    const unicodeSpace = "feature/unicode-space\u00a0";
    git(project, "checkout", "-b", unicodeSpace);
    assert.deepEqual(await readGitBranch(project, signal()), { name: unicodeSpace, detached: false }, "legal Unicode whitespace in branch names is preserved");
    git(project, "checkout", "--detach", "HEAD");
    const before = git(project, "status", "--porcelain=v1");
    assert.deepEqual(await readGitBranch(project, signal()), { name: git(project, "rev-parse", "--short", "HEAD"), detached: true });
    assert.equal(git(project, "status", "--porcelain=v1"), before, "metadata read leaves the working tree unchanged");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("non-Git, deleted directories and unavailable Git produce no badge data", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-no-git-"));
  const previous = process.env.PATH;
  try {
    assert.equal(await readGitBranch(root, signal()), null);
    assert.equal(await readGitBranch(join(root, "missing"), signal()), null);
    process.env.PATH = join(root, "not-installed");
    assert.equal(await readGitBranch(root, signal()), null);
    writeFileSync(join(root, process.platform === "win32" ? "git.exe" : "git"), "never execute a relative project binary");
    process.env.PATH = ".";
    assert.equal(await readGitBranch(root, signal()), null, "relative and implicit current-directory PATH entries are excluded");
    await assert.rejects(readGitBranch(root, AbortSignal.abort()));
  } finally {
    if (previous === undefined) delete process.env.PATH; else process.env.PATH = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("inherited Git environment cannot redirect the authorized workspace to another checkout", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-git-env-"));
  const a = join(root, "a"), b = join(root, "b"); mkdirSync(a); mkdirSync(b);
  const keys = ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_NAMESPACE", "GIT_CONFIG_COUNT"] as const;
  const previous = keys.map(key => process.env[key]);
  try {
    git(a, "init", "-b", "authorized"); git(b, "init", "-b", "wrong-project");
    process.env.GIT_DIR = join(b, ".git"); process.env.GIT_WORK_TREE = b; process.env.GIT_COMMON_DIR = join(b, ".git");
    process.env.GIT_NAMESPACE = "unrelated"; process.env.GIT_CONFIG_COUNT = "invalid";
    assert.deepEqual(await readGitBranch(a, signal()), { name: "authorized", detached: false });
  } finally {
    keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; });
    rmSync(root, { recursive: true, force: true });
  }
});

test("Git reads are bounded and cancellable", { skip: process.platform === "win32" }, async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-git-timeout-")), previous = process.env.PATH;
  try {
    const executable = join(root, "git"); writeFileSync(executable, "#!/bin/sh\nexec /bin/sleep 10\n"); chmodSync(executable, 0o755);
    process.env.PATH = root;
    const started = Date.now();
    assert.equal(await readGitBranch(root, signal()), null);
    assert.ok(Date.now() - started < 6000, "Git timeout must not block a conversation indefinitely");
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30);
    try { await assert.rejects(readGitBranch(root, controller.signal), { name: "AbortError" }); }
    finally { clearTimeout(timer); }
  } finally {
    if (previous === undefined) delete process.env.PATH; else process.env.PATH = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("branch command is workspace-only, read-only, rejects arbitrary paths and requires authorization", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-git-authority-")), project = join(root, "project"); mkdirSync(project);
  const store = new Store(join(root, "data")), service = new WorkspaceGit(store);
  try {
    git(project, "init", "-b", "safe");
    const workspace = store.execute({ requestId: crypto.randomUUID(), op: "workspace.open", params: { path: project, authorized: true } }) as Workspace;
    const c = command(workspace.id), receipts = store.db.prepare("SELECT count(*) AS n FROM requests").get();
    assert.deepEqual(await service.command(c, signal()), { name: "safe", detached: false });
    git(project, "symbolic-ref", "HEAD", "refs/heads/updated");
    assert.deepEqual(await service.command(c, signal()), { name: "updated", detached: false }, "read must not replay a cached mutation receipt");
    assert.deepEqual(store.db.prepare("SELECT count(*) AS n FROM requests").get(), receipts);
    for (const invalid of [command(workspace.id, { path: root }), { ...c, sessionId: "foreign" }, { ...c, op: "git.exec" }, command()])
      await assert.rejects(service.command(invalid, signal()), { code: "INVALID_INPUT" });
    await assert.rejects(service.command(command("missing"), signal()), { code: "NOT_FOUND" });
    store.db.prepare("UPDATE workspaces SET authorized=0 WHERE id=?").run(workspace.id);
    await assert.rejects(service.command(c, signal()), { code: "AUTHORIZATION_REQUIRED" });
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});
