import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { startServer } from "../src/server/index.js";
import type { Scope, Session, Workspace } from "../src/shared/protocol.js";
import { tmpdir } from "./temporary.js";

const root = mkdtempSync(join(tmpdir(), "axiom-git-branch-ui-"));
const artifacts = process.env.AXIOM_GIT_ARTIFACTS || mkdtempSync(join(tmpdir(), "axiom-git-branch-evidence-")); mkdirSync(artifacts, { recursive: true });
const previous = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = join(root, "pi"); mkdirSync(process.env.AXIOM_PI_DIR);
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "init.templateDir=", "-c", "core.hooksPath=", "-c", "commit.gpgsign=false", "-c", "user.name=Axiom Test", "-c", "user.email=test@example.invalid", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const app = await startServer({ root: join(root, "data"), port: 0, dev: true });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
try {
  const create = (title: string, branch?: string) => {
    const path = join(root, title); mkdirSync(path);
    if (branch) git(path, "init", "-b", branch);
    const workspace = app.store.execute({ requestId: crypto.randomUUID(), op: "workspace.open", params: { path, authorized: true } }) as Workspace;
    const session = app.store.execute({ requestId: crypto.randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
    const scope = { workspaceId: workspace.id, sessionId: session.id };
    for (const [op, params] of [["session.rename", { title }], ["session.pin", { pinned: true }]] as const)
      app.store.execute({ requestId: crypto.randomUUID(), op, params, ...scope });
    return { path, scope };
  };
  const a = create("Git 项目 A", "feature/title-badge"), b = create("Git 项目 B", "fix/another-project"), plain = create("普通项目");
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
  await context.addInitScript(scope => { if (!sessionStorage.getItem("view")) sessionStorage.setItem("view", JSON.stringify(scope)); }, a.scope);
  let failReads = false, holdA = false;
  const held: { release?: () => void; reads: number } = { reads: 0 };
  await context.routeWebSocket("**/ws", socket => {
    const server = socket.connectToServer();
    socket.onMessage(raw => {
      const c = JSON.parse(String(raw));
      if (c.op === "git.branch") {
        held.reads++;
        if (holdA && c.workspaceId === a.scope.workspaceId) {
          holdA = false;
          held.release = () => socket.send(JSON.stringify({ type: "receipt", requestId: c.requestId, ok: true, data: { name: "stale/old-project", detached: false } }));
          return;
        }
        if (failReads) {
          socket.send(JSON.stringify({ type: "receipt", requestId: c.requestId, ok: false, error: { code: "UNAVAILABLE", message: "fixture unavailable" } }));
          return;
        }
      }
      server.send(raw);
    });
    server.onMessage(raw => socket.send(raw));
  });
  const page = await context.newPage(), errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const badge = page.locator(".title-heading .git-branch-badge");
  const waitBranch = async (name: string) => {
    await page.waitForFunction(expected => document.querySelector(".title-heading .git-branch-name")?.textContent === expected, name, { timeout: 10000 });
    assert.equal(await badge.count(), 1);
    assert.equal(await page.locator(".sidebar .git-branch-badge").count(), 0, "never add branch badges to the left sidebar");
  };
  const select = async (scope: Scope) => {
    await page.locator(`.history-row[data-session-id="${scope.sessionId}"] .history-item`).click();
    await page.waitForFunction(expected => JSON.parse(sessionStorage.getItem("view") || "null")?.sessionId === expected, scope.sessionId);
  };
  const focus = () => page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.goto(app.origin); await waitBranch("feature/title-badge");
  assert.equal(await badge.getAttribute("aria-label"), "当前 Git 分支：feature/title-badge");
  assert.equal(await badge.locator('use[href="#i-git-branch"]').count(), 1);
  await page.getByRole("button", { name: "复制会话标题", exact: true }).click();
  await page.locator(".title-heading [role=status]").filter({ hasText: "已复制标题" }).waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "Git 项目 A", "branch badge does not contaminate copied titles");
  await page.screenshot({ path: join(artifacts, "branch-desktop.png") });

  git(a.path, "symbolic-ref", "HEAD", "refs/heads/feature/auto-refresh");
  await waitBranch("feature/auto-refresh"); // No focus event: visible-only polling detects external changes.
  await select(b.scope); await waitBranch("fix/another-project");
  holdA = true; await select(a.scope);
  for (let i = 0; !held.release && i < 100; i++) await page.waitForTimeout(20);
  assert.ok(held.release, "workspace A read held to exercise a late response");
  assert.equal(await badge.count(), 0, "workspace switch clears previous branch before a new read finishes");
  await select(plain.scope); held.release();
  await page.waitForTimeout(150);
  assert.equal(await badge.count(), 0, "non-Git workspace ignores old Git responses");
  await select(a.scope); await waitBranch("feature/auto-refresh");
  failReads = true; await focus(); await badge.waitFor({ state: "detached" });
  assert.equal(await page.locator(".execution-alert").count(), 0, "optional Git metadata errors do not interrupt the conversation");
  failReads = false; await focus(); await waitBranch("feature/auto-refresh");

  await page.evaluate(() => Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }));
  const readsBeforeHidden = held.reads; await focus(); await page.waitForTimeout(150);
  assert.equal(held.reads, readsBeforeHidden, "hidden views do not request Git metadata");
  git(a.path, "symbolic-ref", "HEAD", "refs/heads/feature/resumed");
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }); document.dispatchEvent(new Event("visibilitychange")); });
  await waitBranch("feature/resumed");
  await page.reload(); await waitBranch("feature/resumed");

  git(a.path, "commit", "--allow-empty", "-m", "fixture"); git(a.path, "checkout", "--detach", "HEAD");
  await focus(); await waitBranch(`游离 · ${git(a.path, "rev-parse", "--short", "HEAD")}`);
  const longBranch = "feature/" + "long-title-branch-".repeat(9);
  git(a.path, "checkout", "-b", longBranch); await focus(); await waitBranch(longBranch);
  const longTitle = "长会话标题与分支标记在顶部并排且不挤占复制按钮".repeat(4);
  await page.locator(`.history-row[data-session-id="${a.scope.sessionId}"] .history-item`).press("F2");
  const titleInput = page.getByRole("textbox", { name: "会话标题", exact: true }); await titleInput.fill(longTitle); await titleInput.press("Enter");
  await page.waitForFunction(expected => document.querySelector("#chat-title")?.textContent === expected, longTitle);
  for (const width of [320, 360, 390, 820, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `page overflow at ${width}`);
    const bounds = await badge.boundingBox(), heading = await page.locator(".title-heading").boundingBox();
    assert.ok(bounds && heading && bounds.x >= heading.x - 1 && bounds.x + bounds.width <= heading.x + heading.width + 1, `badge stays inside top title at ${width}`);
    assert.ok(await page.getByRole("button", { name: "复制会话标题", exact: true }).isVisible());
    assert.equal(await badge.getAttribute("data-tooltip"), `当前 Git 分支：${longBranch}`);
  }
  const name = badge.locator(".git-branch-name");
  assert.ok(await name.evaluate(node => node.scrollWidth > node.clientWidth), "long branch names are ellipsized");
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: join(artifacts, "branch-long-mobile.png") });

  const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await touch.addInitScript(scope => sessionStorage.setItem("view", JSON.stringify(scope)), a.scope);
  const mobile = await touch.newPage(); mobile.on("pageerror", error => errors.push(error.message)); await mobile.goto(app.origin);
  await mobile.locator(".git-branch-badge").waitFor();
  const copy = await mobile.getByRole("button", { name: "复制会话标题", exact: true }).boundingBox();
  assert.ok(copy && copy.width >= 44 && copy.height >= 44, "title copy keeps its touch target");
  assert.equal(await mobile.locator(".sidebar .git-branch-badge").count(), 0);
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await mobile.screenshot({ path: join(artifacts, "branch-touch.png") });
  assert.deepEqual(errors, []);
  await touch.close(); await context.close();
  console.log(`PASS Git branch header: real Git + WS, top-only badge, exact name/icon, clean title copy, auto/focus/visibility refresh, cross-workspace late-response guard, non-Git/error hiding, reload, detached HEAD, long-name ellipsis, 320–1440px layout and touch target. Artifacts: ${resolve(artifacts)}`);
} finally {
  await browser.close(); await app.close();
  if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  rmSync(root, { recursive: true, force: true });
}
