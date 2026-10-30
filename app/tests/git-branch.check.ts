import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, type Page } from "playwright";
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
  let failReads = false, holdA = false, heldName = "stale/old-project";
  const held: { release?: () => void; reads: number } = { reads: 0 };
  const heldRelease = (): (() => void) | undefined => held.release;
  await context.routeWebSocket("**/ws", socket => {
    const server = socket.connectToServer();
    socket.onMessage(raw => {
      const c = JSON.parse(String(raw));
      if (c.op === "git.branch") {
        held.reads++;
        if (holdA && c.workspaceId === a.scope.workspaceId) {
          holdA = false;
          const name = heldName;
          held.release = () => socket.send(JSON.stringify({ type: "receipt", requestId: c.requestId, ok: true, data: { name, detached: false } }));
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
  const badge = page.locator(".title-meta .git-branch-badge");
  const assertHeaderLayout = async (target: Page, scale = 1) => {
    // Sample one layout atomically: separate protocol round trips can straddle
    // a viewport breakpoint and compare boxes from different rendered frames.
    const [branch, path, row, branchName, directory, pathLabel, icon, title, heading] = await target.evaluate(() => [
      '.title-meta .git-branch-badge', '.title-meta .local-path', '.title-meta',
      '.git-branch-name', '.workspace-directory-icon', '.workspace-path-label', '.git-branch-badge > svg', '#chat-title', '.title-heading',
    ].map(selector => {
      const node = document.querySelector(selector);
      if (!node?.getClientRects().length) return null;
      const { x, y, width, height } = node.getBoundingClientRect();
      return { x, y, width, height };
    }));
    assert.ok(branch && path && row && title && heading, "branch, title and workspace path are visible");
    assert.ok(branch.x + branch.width <= path.x + 1, `branch sits to the left of the workspace path: ${JSON.stringify({ branch, path, viewport: target.viewportSize() })}`);
    assert.ok(Math.abs(branch.y + branch.height / 2 - path.y - path.height / 2) <= 1, "branch and path share the same row");
    assert.ok(branch.x >= row.x - 1 && path.x + path.width <= row.x + row.width + 1, "branch and path stay within the metadata row");
    assert.ok(row.y >= heading.y + heading.height - 1, "branch and path remain below the independent title row");
    assert.ok(await target.locator("#title-path").evaluate(node => node.clientWidth > 0), "workspace path retains visible space");
    const directoryIcon = target.locator("#title-path .workspace-directory-icon");
    assert.equal(await directoryIcon.locator('use[href="#i-folder-tree"]').count(), 1, "workspace path uses selected candidate 11 (Lucide folder-tree)");
    assert.equal(await target.locator('.git-branch-badge .path-actions, .git-branch-badge use[href="#i-copy"]').count(), 0, "branch is the copy target, with no separate copy icon or hidden spacer");
    assert.ok(branchName, "branch label is visible");
    assert.ok(directory && pathLabel && directory.width === 13 * scale && directory.height === 13 * scale, "directory icon retains its balanced scaled size");
    assert.ok(Math.abs(directory.x - branchName.x - branchName.width - 8 * scale) <= 1, "only the 8px group gap separates the branch text and directory icon");
    assert.ok(directory.x + directory.width <= pathLabel.x + 1 && pathLabel.width > 0, `selected icon precedes visible path text: ${JSON.stringify({ directory, pathLabel, row, viewport: target.viewportSize() })}`);
    assert.ok(Math.abs(directory.y + directory.height / 2 - pathLabel.y - pathLabel.height / 2) <= 1, "directory icon is vertically centered with the path");
    assert.ok(await target.evaluate(scale => {
      const nodes = [".git-branch-name", ".workspace-path-label", ".git-branch-badge > svg", ".workspace-directory-icon"].map(selector => document.querySelector(selector)!);
      const styles = nodes.map(node => getComputedStyle(node));
      const rowStyle = getComputedStyle(document.querySelector(".title-meta")!);
      return styles.every(style => style.color === rowStyle.color && style.fontFamily === rowStyle.fontFamily && style.fontSize === rowStyle.fontSize && style.fontSize === `${12 * scale}px` && style.fontWeight === "400" && style.lineHeight === rowStyle.lineHeight)
        && styles.slice(2).every(style => style.width === `${13 * scale}px` && style.height === `${13 * scale}px` && style.getPropertyValue("--icon-stroke").trim() === "1.25px")
        && nodes.slice(2).every(node => getComputedStyle(node).backgroundColor === "rgba(0, 0, 0, 0)");
    }, scale), "branch, path and icons share typography, color, line height and balanced icon weight");
    assert.equal(await target.locator(".title-heading .git-branch-badge").count(), 0, "branch does not occupy the title row");
    assert.ok(icon && Math.abs(icon.x - title.x) <= 1, "left branch icon aligns with the title edge");
    assert.ok(await target.locator(".git-branch-badge").evaluate(node => {
      const style = getComputedStyle(node);
      return style.backgroundColor === "rgba(0, 0, 0, 0)" && style.borderLeftWidth === "0px" && style.paddingLeft === "0px" && style.cursor === "pointer";
    }), "branch has no background, border or left inset");
  };
  const assertFeedback = async (target: Page, text: string) => {
    const feedback = target.locator('.git-branch-badge .branch-copy-feedback').filter({ hasText: text });
    await feedback.waitFor({ state: 'visible' });
    assert.ok(await feedback.evaluate(node => {
      const rect = node.getBoundingClientRect();
      if (rect.left < 0 || rect.top < 0 || rect.right > innerWidth || rect.bottom > innerHeight) return false;
      if (rect.top < document.querySelector('.title-meta')!.getBoundingClientRect().bottom) return false;
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
        if (/(hidden|clip|scroll|auto)/.test(style.overflowX) && (rect.left < bounds.left - 1 || rect.right > bounds.right + 1)) return false;
        if (/(hidden|clip|scroll|auto)/.test(style.overflowY) && (rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1)) return false;
      }
      return true;
    }), 'copy feedback fits the viewport and is not clipped by any overflow ancestor');
  };
  const waitBranch = async (name: string) => {
    await page.waitForFunction(expected => document.querySelector(".title-meta .git-branch-name")?.textContent === expected, name, { timeout: 10000 });
    assert.equal(await badge.count(), 1);
    assert.equal(await page.locator(".sidebar .git-branch-badge").count(), 0, "never add branch badges to the left sidebar");
  };
  const select = async (scope: Scope) => {
    await page.locator(`.history-row[data-session-id="${scope.sessionId}"] .history-item`).click();
    await page.waitForFunction(expected => JSON.parse(sessionStorage.getItem("view") || "null")?.sessionId === expected, scope.sessionId);
  };
  const focus = () => page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.goto(app.origin); await waitBranch("feature/title-badge");
  assert.equal(await badge.getAttribute("aria-description"), "当前 Git 分支：feature/title-badge");
  assert.equal(await badge.locator('use[href="#i-git-branch"]').count(), 1);
  await page.getByRole("button", { name: "复制会话标题", exact: true }).click();
  await page.locator(".title-heading [role=status]").filter({ hasText: "已复制标题" }).waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "Git 项目 A", "branch badge does not contaminate copied titles");
  const copyBranch = page.getByRole("button", { name: "复制分支名", exact: true });
  await badge.locator('.git-branch-name').click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "feature/title-badge", "clicking the branch text copies only its raw name");
  for (const key of ['Enter', 'Space']) {
    await page.evaluate(() => navigator.clipboard.writeText('keyboard sentinel'));
    await copyBranch.press(key);
    await page.waitForFunction(async () => await navigator.clipboard.readText() === 'feature/title-badge');
  }
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "feature/title-badge", "branch copy supports keyboard Enter and Space");
  await badge.getByRole("status").filter({ hasText: "已复制分支名" }).waitFor();
  await badge.locator('.branch-copy-feedback').filter({ hasText: '已复制分支名' }).waitFor({ state: 'visible' });
  await page.locator(".title-meta .local-path").hover();
  await page.getByRole("button", { name: "复制工作空间路径", exact: true }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), a.path, "workspace path copy is preserved");
  await page.evaluate('Object.defineProperty(navigator.clipboard, "writeText", { configurable: true, value: async () => { throw new Error("clipboard denied"); } })');
  await copyBranch.focus();
  await copyBranch.click();
  await badge.getByRole("status").filter({ hasText: "复制失败，点击重试" }).waitFor();
  await assertFeedback(page, '复制失败，点击重试');
  assert.equal(await copyBranch.getAttribute("data-tooltip"), null, 'visible copy feedback replaces the hover tooltip');
  await page.evaluate(() => { Reflect.deleteProperty(navigator.clipboard, "writeText"); });
  await copyBranch.click();
  await badge.getByRole("status").filter({ hasText: "已复制分支名" }).waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "feature/title-badge", "clipboard failure can be retried");
  const beforeCopy = await page.locator('.workspace-path-label').boundingBox();
  const beforeTitle = await page.locator('#chat-title').boundingBox();
  const beforeTitleCopy = await page.locator('.title-copy').boundingBox();
  await page.evaluate('Object.defineProperty(navigator.clipboard, "writeText", { configurable: true, value: () => new Promise(resolve => { window.__releaseBranchCopy = resolve; }) })');
  await copyBranch.click();
  await assertFeedback(page, '正在复制…');
  assert.ok(await copyBranch.isDisabled(), 'pending copy prevents duplicate clicks');
  assert.deepEqual(await page.locator('.workspace-path-label').boundingBox(), beforeCopy, 'pending feedback does not move the path');
  assert.deepEqual(await page.locator('#chat-title').boundingBox(), beforeTitle, 'pending feedback does not move the title');
  assert.deepEqual(await page.locator('.title-copy').boundingBox(), beforeTitleCopy, 'pending feedback does not move the title copy');
  await page.evaluate('window.__releaseBranchCopy(); Reflect.deleteProperty(navigator.clipboard, "writeText")');
  await badge.locator('.branch-copy-feedback').filter({ hasText: '已复制分支名' }).waitFor({ state: 'visible' });
  assert.deepEqual(await page.locator('.workspace-path-label').boundingBox(), beforeCopy, 'success feedback does not move the path');
  assert.deepEqual(await page.locator('#chat-title').boundingBox(), beforeTitle, 'success feedback does not move the title');
  assert.deepEqual(await page.locator('.title-copy').boundingBox(), beforeTitleCopy, 'success feedback does not move the title copy');
  await assertFeedback(page, '已复制分支名');
  await page.screenshot({ path: join(artifacts, 'branch-copy-feedback.png') });
  await badge.locator('.branch-copy-feedback').waitFor({ state: 'hidden' });
  await assertHeaderLayout(page);
  await page.screenshot({ path: join(artifacts, "branch-desktop.png") });
  await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
  await assertHeaderLayout(page);
  await page.screenshot({ path: join(artifacts, "branch-desktop-light.png") });
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  for (const scale of [1.25, 1.5]) {
    await page.evaluate(scale => document.documentElement.style.setProperty('--display-font-scale', String(scale)), scale);
    await assertHeaderLayout(page, scale);
  }
  await page.evaluate(() => document.documentElement.style.removeProperty('--display-font-scale'));

  git(a.path, "symbolic-ref", "HEAD", "refs/heads/feature/auto-refresh");
  await waitBranch("feature/auto-refresh"); // No focus event: visible-only polling detects external changes.
  assert.equal(await copyBranch.getAttribute("data-tooltip"), "当前 Git 分支：feature/auto-refresh · 点击复制", "new branch resets copy feedback");
  await select(b.scope); await waitBranch("fix/another-project");
  holdA = true; await select(a.scope);
  for (let i = 0; !held.release && i < 100; i++) await page.waitForTimeout(20);
  assert.ok(held.release, "workspace A read held to exercise a late response");
  await waitBranch("feature/auto-refresh");
  assert.equal(await page.locator(".git-branch-name").textContent(), "feature/auto-refresh", "workspace switch restores only that workspace's own confirmed branch, not project B");
  await select(plain.scope); held.release();
  await page.waitForTimeout(150);
  assert.equal(await badge.count(), 0, "non-Git workspace ignores old Git responses");
  assert.ok(await page.evaluate(() => Math.abs(document.querySelector('#chat-title')!.getBoundingClientRect().left - document.querySelector('#title-path')!.getBoundingClientRect().left) <= 1), 'non-Git titles have no empty branch placeholder');
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
  await context.addInitScript(`(() => {
    window.__branchFrames = [];
    const sample = () => {
      const path = document.querySelector('.workspace-path-label');
      if (path?.textContent === ${JSON.stringify(a.path)}) window.__branchFrames.push(document.querySelector('.git-branch-name')?.textContent ?? null);
      if (window.__branchFrames.length < 180) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  })()`);
  holdA = true; heldName = "feature/resumed"; held.release = undefined;
  await page.reload();
  for (let i = 0; !held.release && i < 100; i++) await page.waitForTimeout(20);
  assert.ok(held.release, "reload Git read is held while cached metadata renders");
  await waitBranch("feature/resumed");
  await page.waitForTimeout(150);
  const frames = await page.evaluate("window.__branchFrames") as Array<string | null>;
  assert.ok(frames.length > 0 && frames.every(value => value === "feature/resumed"), `no frame shows a missing or wrong branch while reload revalidates: ${JSON.stringify(frames)}`);
  const beforeRefresh = await page.locator(".workspace-path-label").boundingBox();
  const releaseReload = heldRelease();
  assert.ok(releaseReload);
  releaseReload();
  await page.waitForTimeout(150);
  assert.deepEqual(await page.locator(".workspace-path-label").boundingBox(), beforeRefresh, "background validation does not move the workspace path");
  await waitBranch("feature/resumed");

  git(a.path, "commit", "--allow-empty", "-m", "fixture"); git(a.path, "checkout", "--detach", "HEAD");
  const detachedName = git(a.path, "rev-parse", "--short", "HEAD");
  await focus(); await waitBranch(`游离 · ${detachedName}`);
  await badge.hover(); await copyBranch.click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), detachedName, "detached copy omits the display prefix");
  const longBranch = "feature/" + "long-title-branch-".repeat(9);
  git(a.path, "checkout", "-b", longBranch); await focus(); await waitBranch(longBranch);
  const longTitle = "长会话标题与分支标记在顶部并排且不挤占复制按钮".repeat(4);
  await page.locator(`.history-row[data-session-id="${a.scope.sessionId}"] .history-item`).press("F2");
  const titleInput = page.getByRole("textbox", { name: "会话标题", exact: true }); await titleInput.fill(longTitle); await titleInput.press("Enter");
  await page.waitForFunction(expected => document.querySelector("#chat-title")?.textContent === expected, longTitle);
  for (const width of [320, 360, 390, 820, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `page overflow at ${width}`);
    await assertHeaderLayout(page);
    assert.ok(await page.getByRole("button", { name: "复制会话标题", exact: true }).isVisible());
    assert.equal(await badge.getAttribute("data-tooltip"), `当前 Git 分支：${longBranch} · 点击复制`);
  }
  const name = badge.locator(".git-branch-name");
  assert.ok(await name.evaluate(node => node.scrollWidth > node.clientWidth), "long branch names are ellipsized");
  await copyBranch.focus(); await copyBranch.click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), longBranch, "copy retains the full ellipsized branch name");
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: join(artifacts, "branch-long-mobile.png") });

  const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: ['clipboard-read', 'clipboard-write'] });
  await touch.addInitScript(scope => sessionStorage.setItem("view", JSON.stringify(scope)), a.scope);
  const mobile = await touch.newPage(); mobile.on("pageerror", error => errors.push(error.message)); await mobile.goto(app.origin);
  await mobile.locator(".git-branch-badge").waitFor();
  const copy = await mobile.getByRole("button", { name: "复制会话标题", exact: true }).boundingBox();
  assert.ok(copy && copy.width >= 44 && copy.height >= 44, "title copy keeps its touch target");
  assert.equal(await mobile.locator(".sidebar .git-branch-badge").count(), 0);
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  for (const width of [320, 390]) {
    await mobile.setViewportSize({ width, height: 844 });
    await assertHeaderLayout(mobile);
    const branchCopy = mobile.getByRole("button", { name: "复制分支名", exact: true });
    const bounds = await branchCopy.boundingBox();
    assert.ok(bounds && bounds.width >= 44 && bounds.height >= 44, "branch copy keeps its touch target");
    assert.equal(await branchCopy.evaluate(node => getComputedStyle(node).opacity), "1", "touch branch itself is the visible copy target without hover");
    await branchCopy.tap();
    await assertFeedback(mobile, '已复制分支名');
    assert.equal(await mobile.evaluate(() => navigator.clipboard.readText()), longBranch, 'touch tap copies the full branch and shows feedback');
    if (width === 320) await mobile.screenshot({ path: join(artifacts, "branch-touch-320.png") });
  }
  await mobile.screenshot({ path: join(artifacts, "branch-touch.png") });
  assert.deepEqual(errors, []);
  await touch.close(); await context.close();
  console.log(`PASS Git branch header: real Git + WS, branch icon/name left of path on the same row below the title, branch/path/title copy with failure retry, selected folder-tree icon, branch text click and keyboard copy without a copy icon or spacer, pointer cursor, visible pending/success/failure feedback without layout shifts, compact 8px branch-path gap, identical 12px branch/path typography/colors in both themes and at 125–150% scale, no reload branch flash, top-only badge, exact name/icon, auto/focus/visibility refresh, cross-workspace late-response guard, non-Git/error hiding, reload, detached HEAD, long-name ellipsis, 320–1440px layout and touch target. Artifacts: ${resolve(artifacts)}`);
} finally {
  await browser.close(); await app.close();
  if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  rmSync(root, { recursive: true, force: true });
}
