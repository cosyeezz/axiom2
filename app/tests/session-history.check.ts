import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startServer } from "../src/server/index.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

const root = mkdtempSync(join(tmpdir(), "axiom-pins-"));
const app = await startServer({ root: join(root, "data"), port: 0 });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
try {
  const run = (op: string, params = {}, workspaceId?: string, sessionId?: string) =>
    app.store.execute({ requestId: crypto.randomUUID(), op, params, workspaceId, sessionId });
  const create = (name: string) => {
    const path = join(root, name);
    mkdirSync(path);
    const workspace = run("workspace.open", { path, authorized: true }) as Workspace;
    const session = run("session.create", {}, workspace.id) as Session;
    run("session.rename", { title: name }, workspace.id, session.id);
    return { workspace, session };
  };
  const a = create("Pinned A"), b = create("Local B");
  const longTitle = "Pinned A · " + "长标题完整可用宽度测试".repeat(8);
  run("session.rename", { title: longTitle }, a.workspace.id, a.session.id);
  run("session.pin", { pinned: true }, a.workspace.id, a.session.id);
  // Keep the unread fixture consistent with versioned read acknowledgements.
  app.store.db.prepare("UPDATE sessions SET unread=1,resultVersion=1,readVersion=0 WHERE id=?").run(a.session.id);
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const errors: string[] = [];
  const browserDialogs: string[] = [];
  page.on("dialog", async (dialog) => {
    browserDialogs.push(`${dialog.type()}: ${dialog.message()}`);
    await dialog.dismiss();
  });
  const mutations: { op: string; workspaceId: string; sessionId: string; params: Record<string, unknown> }[] = [];
  const workspaceSelections: { workspaceId: string; params: { view: { workspaceId: string; sessionId: string } } }[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("websocket", (socket) => socket.on("framesent", ({ payload }) => {
    const message = JSON.parse(payload.toString());
    if (message.op === "workspace.select") workspaceSelections.push(message);
    if (["session.rename", "session.pin", "session.delete"].includes(message.op)) mutations.push(message);
  }));
  await page.addInitScript((view) => {
    if (!sessionStorage.getItem("view")) sessionStorage.setItem("view", JSON.stringify(view));
  }, {
    workspaceId: b.workspace.id, sessionId: b.session.id,
  });
  await page.goto(app.origin);
  const pins = page.getByRole("region", { name: "置顶会话", exact: true });
  const row = pins.locator(".history-row");
  const item = row.locator(".history-item");
  const input = page.getByRole("textbox", { name: "会话标题", exact: true });
  const prompt = page.locator("#prompt");
  const search = page.getByRole("searchbox", { name: "搜索置顶和当前空间的会话" });
  const waitTitle = async (title: string) => {
    await page.waitForFunction((expected) =>
      document.querySelector('[aria-label="置顶会话"] strong')?.textContent === expected, title);
    assert.equal(app.store.session(a.workspace.id, a.session.id).title, title);
  };
  const switchWorkspace = async (name: string) => {
    const target = name === "Local B" ? b : a;
    const selectionsBefore = workspaceSelections.length;
    await page.locator("#workspace-picker > summary").click();
    await page.getByRole("button", { name, exact: true }).click();
    // Selecting the current space still runs deferred navigation. Its old title
    // and saved view cannot prove that this selection has completed.
    await page.waitForFunction(() => !document.querySelector("#workspace-picker")?.hasAttribute("open"));
    await page.waitForFunction((expected) =>
      document.querySelector("#workspace-picker summary strong")?.textContent === expected, name);
    await page.waitForFunction((workspaceId) => {
      const view = JSON.parse(sessionStorage.getItem("view") || "null");
      return view?.workspaceId === workspaceId && Boolean(view.sessionId) &&
        document.querySelector("#chat-title")?.textContent !== "新对话";
    }, target.workspace.id);
    const observedSelection = () => workspaceSelections.slice(selectionsBefore).some(({ params }) =>
      params.view?.workspaceId === target.workspace.id && params.view.sessionId === target.session.id);
    const deadline = Date.now() + 5000;
    while (!observedSelection() && Date.now() < deadline) await page.waitForTimeout(20);
    assert.equal(observedSelection(), true, "workspace selection restores its session before the next action");
  };
  const selectedWorkspace = () => page.locator("#workspace-picker summary strong").textContent();
  const beginF2 = async () => {
    await item.focus();
    await item.press("F2");
    await input.waitFor();
    assert.equal(await input.evaluate((el) => el === document.activeElement), true);
    assert.equal(await input.getAttribute("class").then((value) => value?.includes("session-title-input")), true);
    assert.equal(await row.locator("button.history-item").count(), 0, "editor replaces the navigation button");
    assert.equal(await page.getByRole("dialog").count(), 0, "rename must stay inline");
    assert.equal(await row.locator(".session-actions").isVisible(), false, "actions cannot overlap inline editing");
  };
  await item.waitFor();
  assert.equal(await item.evaluate((el) => el.tagName), "BUTTON");
  assert.equal(await row.locator(".session-workspace-path").textContent(), a.workspace.path);
  assert.equal(await row.locator(".session-workspace-path").getAttribute("data-tooltip"), a.workspace.path);
  assert.equal(await page.getByRole("region", { name: "当前空间对话", exact: true }).locator(".session-workspace-path").count(), 0);
  assert.equal(await page.locator(".history-item").count(), 2);
  assert.equal(await page.locator(".session-manage").count(), 0);
  assert.equal(await page.getByRole("button", { name: /^管理会话：/ }).count(), 0);
  assert.equal(await pins.locator(".session-title-line > :first-child").getAttribute("aria-label"), "未读");
  assert.equal(await pins.locator(".session-state").evaluate((el) => getComputedStyle(el).width), "8px");
  assert.equal(await pins.locator(".session-state.pulse-rings-multiple path").count(), 3);
  const unreadFrames = await pins.locator(".session-state").evaluate(node => {
    const svg = node as SVGSVGElement;
    svg.pauseAnimations();
    svg.setCurrentTime(0.3);
    const first = svg.querySelector<SVGCircleElement>(".unread-solid-dot")!.r.animVal.value;
    svg.setCurrentTime(0.8);
    const second = svg.querySelector<SVGCircleElement>(".unread-solid-dot")!.r.animVal.value;
    svg.unpauseAnimations();
    return { first, second, stroke: getComputedStyle(svg).stroke };
  });
  assert.ok(unreadFrames.second > unreadFrames.first, "unread rings fill towards a solid dot even with reduced motion");
  assert.equal(unreadFrames.stroke, "none");
  await search.fill("Pinned A");
  assert.equal(await page.locator(".history-item").count(), 1);
  await search.fill("");

  // Hidden actions occupy no title width and cannot intercept pointer events.
  await prompt.focus();
  await page.mouse.move(1000, 700);
  const geometry = () => row.evaluate((el) => {
    const item = el.querySelector<HTMLElement>(".history-item")!;
    const title = el.querySelector<HTMLElement>("strong")!;
    const actions = el.querySelector<HTMLElement>(".session-actions")!;
    // Keep browser callbacks free of named local functions: tsx may inject a
    // Node-side __name helper that is unavailable in the page's JS context.
    const rowBox = el.getBoundingClientRect();
    const itemBox = item.getBoundingClientRect();
    const titleBox = title.getBoundingClientRect();
    const style = getComputedStyle(item), titleStyle = getComputedStyle(title);
    return {
      row: { x: rowBox.x, y: rowBox.y, width: rowBox.width, height: rowBox.height },
      item: { x: itemBox.x, y: itemBox.y, width: itemBox.width, height: itemBox.height },
      title: { x: titleBox.x, y: titleBox.y, width: titleBox.width, height: titleBox.height },
      contentRight: item.getBoundingClientRect().right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth),
      scrollWidth: title.scrollWidth, clientWidth: title.clientWidth,
      ellipsis: titleStyle.textOverflow, whiteSpace: titleStyle.whiteSpace,
      position: getComputedStyle(actions).position,
      opacity: getComputedStyle(actions).opacity,
      buttons: [...actions.querySelectorAll("button")].map((button) => ({
        pointerEvents: getComputedStyle(button).pointerEvents,
        color: getComputedStyle(button).color,
        iconColor: getComputedStyle(button.querySelector("svg")!).color,
        centerY: button.getBoundingClientRect().y + button.getBoundingClientRect().height / 2,
      })),
    };
  });
  const hidden = await geometry();
  assert.equal(hidden.position, "absolute");
  assert.equal(hidden.opacity, "0");
  assert.equal(hidden.buttons.length, 2);
  assert.ok(hidden.buttons.every((button) => button.pointerEvents === "none"));
  assert.ok(Math.abs(hidden.title.x + hidden.title.width - hidden.contentRight) <= 1, "hidden actions reserve no title width");
  assert.ok(hidden.scrollWidth > hidden.clientWidth, "fixture must overflow even at full width");
  assert.equal(await row.locator(".session-actions > .session-pin + .session-delete").count(), 1);
  assert.equal(await row.locator(".history-item .session-actions").count(), 0, "actions are not nested buttons");
  await row.hover({ position: { x: 8, y: 8 } });
  const hovered = await geometry();
  assert.equal(hovered.opacity, "1");
  assert.ok(hovered.buttons.every((button) => button.pointerEvents !== "none"));
  assert.equal(hovered.buttons[0].color, hovered.buttons[1].color, "both idle action icons use the same gray");
  assert.deepEqual(hovered.row, hidden.row, "hover must not resize or move the row");
  assert.deepEqual(hovered.item, hidden.item, "hover must not resize or move the navigation button");
  assert.ok(hidden.title.width - hovered.title.width >= 60 && hidden.title.width - hovered.title.width <= 70, "only title width shrinks by about 64px");
  assert.equal(hovered.ellipsis, "ellipsis");
  assert.equal(hovered.whiteSpace, "nowrap");
  const luminance = (color: string) => page.evaluate((value) => {
    const canvas = document.createElement("canvas"), context = canvas.getContext("2d")!;
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }, color);
  for (const [index, selector] of [".session-pin", ".session-delete"].entries()) {
    await row.locator(selector).hover();
    const highlight = await geometry();
    if (index === 1) assert.equal(highlight.buttons[index].iconColor, "rgb(217, 149, 149)", "delete icon uses muted rose on hover");
    else assert.ok(await luminance(highlight.buttons[index].color) > await luminance(hovered.buttons[index].color), `${selector} brightens on hover`);
    assert.ok(Math.abs(highlight.buttons[index].centerY - (highlight.row.y + highlight.row.height / 2)) < 1, "actions are vertically centered in the row");
    assert.equal(highlight.buttons[1 - index].iconColor, hovered.buttons[1 - index].iconColor, "only hovered icon changes color");
    assert.deepEqual(highlight.row, hidden.row);
  }
  await page.mouse.move(1000, 700);
  await item.focus();
  await page.keyboard.press("Tab");
  assert.equal(await row.locator(".session-pin").evaluate((el) => el === document.activeElement && el.matches(":focus-visible")), true);
  assert.equal((await geometry()).opacity, "1", "keyboard action focus reveals controls");
  await page.keyboard.press("Tab");
  assert.equal(await row.locator(".session-delete").evaluate((el) => el === document.activeElement && getComputedStyle(el).outlineStyle !== "none"), true);
  await prompt.focus();
  assert.equal((await geometry()).opacity, "0");
  assert.deepEqual((await geometry()).title, hidden.title, "full title width returns on pointer/focus exit");

  // F2 does not select the foreign pinned session; rename uses its owner, not B.
  await beginF2();
  assert.equal(await selectedWorkspace(), "Local B");
  await input.fill("Renamed A");
  await input.press("Enter");
  await waitTitle("Renamed A");
  await input.waitFor({ state: "detached" });
  assert.equal(await selectedWorkspace(), "Local B");
  assert.equal(mutations.length, 1, "Enter plus editor unmount/blur saves only once");
  await beginF2();
  await input.fill("Discard Escape");
  await input.press("Escape");
  await prompt.focus();
  await input.waitFor({ state: "detached" });
  await waitTitle("Renamed A");
  assert.equal(mutations.length, 1, "Escape followed by blur must not save");
  for (const exit of ["enter", "blur"]) {
    await beginF2();
    await input.fill("   ");
    if (exit === "enter") await input.press("Enter");
    else await prompt.focus();
    await input.waitFor({ state: "detached" });
    await waitTitle("Renamed A");
    assert.equal(mutations.length, 1, `blank ${exit} cancels without a request`);
  }
  await beginF2();
  await input.fill("Blur A");
  await prompt.focus();
  await waitTitle("Blur A");
  await input.waitFor({ state: "detached" });
  assert.equal(mutations.length, 2);
  await beginF2();
  await input.fill("中文标题 A");
  await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true });
  assert.equal(await input.isVisible(), true);
  assert.equal(mutations.length, 2, "native IME Enter must not submit");
  await input.dispatchEvent("compositionstart");
  await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: false });
  assert.equal(await input.isVisible(), true);
  assert.equal(app.store.session(a.workspace.id, a.session.id).title, "Blur A");
  assert.equal(mutations.length, 2, "composition lifecycle also guards Enter");
  await input.dispatchEvent("compositionend", { data: "中文标题 A" });
  await input.press("Enter");
  await waitTitle("中文标题 A");
  assert.equal(mutations.length, 3);
  await item.dblclick();
  await input.waitFor();
  assert.equal(await page.getByRole("dialog").count(), 0, "double-click rename must not open a dialog");
  await input.fill("Renamed A");
  await input.press("Enter");
  await waitTitle("Renamed A");
  assert.equal(await page.locator("#chat-title").textContent(), "Local B", "double-click rename keeps the viewed session");
  assert.equal(await pins.locator(".session-state").getAttribute("aria-label"), "未读", "renaming an unread session does not mark its content read");
  assert.equal(mutations.length, 4);
  // Enter restores keyboard focus on the next animation frame after saving.
  // Wait for that handoff before moving focus away so it cannot steal focus back.
  await page.waitForFunction(() => document.querySelector('[aria-label="置顶会话"] button.history-item') === document.activeElement);
  // Leave both focus and hover before asserting the normal hidden state.
  await prompt.focus();
  await page.mouse.move(1000, 700);
  const afterEditing = await geometry();
  assert.equal(afterEditing.opacity, "0");
  assert.ok(afterEditing.buttons.every((button) => button.pointerEvents === "none"));
  assert.equal(await page.getByRole("dialog").count(), 0);

  // Foreign pins open their real session without navigating the sidebar workspace.
  await switchWorkspace("Local B");
  await prompt.fill("B draft stays");
  const waitPreference = async (workspaceId: string, sessionId: string) => {
    const deadline = Date.now() + 5000;
    while (app.store.lastSession()?.sessionId !== sessionId && Date.now() < deadline) await page.waitForTimeout(20);
    assert.equal(app.store.workspacePreferences().lastWorkspaceId, workspaceId);
    assert.equal(app.store.lastSession()?.sessionId, sessionId);
  };
  await waitPreference(b.workspace.id, b.session.id);
  const selectionsBefore = workspaceSelections.length;
  await search.fill("Renamed");
  await item.click();
  await page.waitForFunction(() => document.querySelector("#chat-title")?.textContent === "Renamed A");
  assert.equal(await selectedWorkspace(), "Local B");
  assert.equal(await search.inputValue(), "Renamed", "opening a pin preserves sidebar search");
  assert.equal(await page.locator("#title-path").textContent(), a.workspace.path, "chat header uses the session owner");
  await waitPreference(b.workspace.id, a.session.id);
  assert.equal(workspaceSelections.length, selectionsBefore + 1, "opening a foreign pin saves the viewed session separately");
  assert.equal(workspaceSelections.at(-1)!.workspaceId, b.workspace.id, "sidebar preference remains B");
  assert.deepEqual(workspaceSelections.at(-1)!.params.view, { workspaceId: a.workspace.id, sessionId: a.session.id });
  await search.fill("");
  const local = page.getByRole("region", { name: "当前空间对话", exact: true });
  assert.deepEqual(await local.locator("strong").allTextContents(), ["Local B"]);
  await prompt.fill("A draft stays");
  await local.locator(".history-item").click();
  await page.waitForFunction(() => (document.querySelector("#prompt") as HTMLTextAreaElement)?.value === "B draft stays");
  await item.click();
  await page.waitForFunction(() => (document.querySelector("#prompt") as HTMLTextAreaElement)?.value === "A draft stays");
  await page.reload();
  await page.waitForFunction(() => document.querySelector("#chat-title")?.textContent === "Renamed A");
  assert.equal(await selectedWorkspace(), "Local B", "refresh restores sidebar separately from foreign session");
  await row.hover();
  await pins.getByRole("button", { name: "取消置顶：Renamed A", exact: true }).click();
  await pins.getByRole("button", { name: "置顶会话：Renamed A", exact: true }).waitFor();
  assert.equal(await pins.locator(".history-row").count(), 1, "removing the manual flag preserves the viewed automatic pin");
  // Leaving the foreground starts cooling without navigating away from the foreign session.
  app.store.db.prepare("UPDATE sessions SET autoPinUntil=? WHERE id=?").run(Date.now() - 1, a.session.id);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + 5000;
    const check = setInterval(() => {
      if (app.store.session(a.workspace.id, a.session.id).autoPinUntil! > Date.now()) { clearInterval(check); resolve(); }
      else if (Date.now() > deadline) { clearInterval(check); reject(Error("blur did not start cooling")); }
    }, 20);
  });
  app.store.db.prepare("UPDATE sessions SET autoPinUntil=? WHERE id=?").run(Date.now() - 1, a.session.id);
  await pins.waitFor({ state: "hidden" });
  assert.equal(await page.locator("#chat-title").textContent(), "Renamed A", "unpinning the viewed foreign session does not navigate away");
  assert.equal(await page.locator(".history-item").count(), 1);
  assert.equal(app.store.session(a.workspace.id, a.session.id).pinned, false);
  assert.equal(await selectedWorkspace(), "Local B");
  await switchWorkspace("Pinned A");
  await page.locator(".history-row").hover();
  await page.getByRole("button", { name: "置顶会话：Renamed A", exact: true }).click();
  await pins.waitFor();
  assert.equal(app.store.session(a.workspace.id, a.session.id).pinned, true);
  await switchWorkspace("Local B");
  await prompt.fill("B draft stays");

  // Direct deletion keeps the confirmation and never targets the viewed B session.
  const remove = pins.getByRole("button", { name: "删除会话：Renamed A", exact: true });
  const confirmation = page.getByRole("dialog", { name: "删除会话", exact: true });
  for (const action of ["escape", "cancel", "accept"]) {
    if (action === "accept") {
      await item.click();
      await page.waitForFunction(() => document.querySelector("#chat-title")?.textContent === "Renamed A");
    }
    const before: number = mutations.length;
    await row.hover();
    await remove.click();
    assert.deepEqual(browserDialogs, [], "deletion must not use browser dialogs");
    await confirmation.waitFor();
    assert.match(await confirmation.innerText(), /Renamed A/);
    assert.match(await confirmation.innerText(), /停止所属任务并从列表移除；保留对话、记忆与附件，不删除项目文件。/);
    const cancel = confirmation.getByRole("button", { name: "取消", exact: true });
    const confirm = confirmation.getByRole("button", { name: "删除会话", exact: true });
    assert.equal(await cancel.evaluate((el) => el === document.activeElement), true, "cancel receives default focus");
    assert.equal(await confirmation.evaluate((el) => el.matches(":modal")), true, "confirmation uses native modal focus isolation");
    await page.keyboard.press("Tab");
    assert.equal(await confirm.evaluate((el) => el === document.activeElement), true);
    await page.keyboard.press("Shift+Tab");
    assert.equal(await cancel.evaluate((el) => el === document.activeElement), true);
    assert.equal(mutations.length, before, "opening a confirmation does not delete");
    if (action === "escape") {
      // Resize only while the modal is open; restore before continuing sidebar scenarios.
      await page.setViewportSize({ width: 390, height: 844 });
      const box = await confirmation.boundingBox();
      assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 391 && box.y + box.height <= 845, "mobile confirmation fits viewport");
      assert.equal(await confirmation.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), true, "mobile confirmation has no horizontal overflow");
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.waitForFunction(() =>
        !document.getElementById("history-sidebar")?.hasAttribute("inert") &&
        !document.getElementById("app")?.classList.contains("mobile-workbench"));
      await page.keyboard.press("Escape");
    } else if (action === "cancel") await cancel.click();
    else await confirm.click();
    await confirmation.waitFor({ state: "hidden" });
    if (action !== "accept") {
      assert.equal(mutations.length, before, `${action} deletion issues no request`);
      assert.equal(app.store.session(a.workspace.id, a.session.id).title, "Renamed A");
      assert.equal(await remove.count(), 1);
      assert.equal(await remove.evaluate((el) => el === document.activeElement), true, "cancel restores focus to delete trigger");
    } else {
      await pins.waitFor({ state: "hidden" });
      assert.equal(app.store.sessions(a.workspace.id).length, 0);
      assert.equal(mutations.length, before + 1);
      await page.waitForFunction(() => document.querySelector("#chat-title")?.textContent === "Local B");
      assert.equal(mutations.at(-1)?.params.confirmed, true);
    }
    assert.equal(await selectedWorkspace(), "Local B");
    assert.equal(await prompt.inputValue(), "B draft stays");
  }
  assert.equal(await page.locator(".history-item").count(), 1);
  assert.equal(app.store.session(b.workspace.id, b.session.id).title, "Local B");
  assert.equal(app.store.session(b.workspace.id, b.session.id).pinned, false);
  assert.deepEqual(mutations.map(({ op }) => op), [
    "session.rename", "session.rename", "session.rename", "session.rename", "session.pin", "session.pin", "session.delete",
  ]);
  for (const mutation of mutations) {
    assert.equal(mutation.workspaceId, a.workspace.id, `${mutation.op} is owner-scoped`);
    assert.equal(mutation.sessionId, a.session.id);
  }
  assert.deepEqual(browserDialogs, [], "no browser dialogs throughout session history scenarios");
  assert.deepEqual(errors, []);
  console.log("PASS: global pins/search; hidden pointer-safe sibling actions, hover highlight, keyboard focus, full-width/ellipsized titles and stable row geometry; inline double-click/F2 rename, Enter/Escape/blur/blank/IME; owner-bound rename/pin/delete in-app confirmation Escape/cancel/accept, default/returned focus, keyboard navigation and narrow viewport without browser dialogs; navigation, drafts and animated leading status icon");
} finally {
  await browser.close();
  await app.close();
  rmSync(root, { recursive: true, force: true });
}
