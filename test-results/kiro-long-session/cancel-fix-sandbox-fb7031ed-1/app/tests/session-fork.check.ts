import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { chromium, type Page } from "playwright";
import { rewriteFixture } from "./rewrite-fixture.js";

const f = await rewriteFixture(!process.env.AXIOM_TEST_PRODUCTION);
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
try {
  await f.call("prompt", { text: "第一个问题 [file1]", attachments: [{ id: "file1", name: "notes.txt", kind: "file", path: join(f.project, "notes.txt"), text: "" }] }); await f.idle();
  await f.call("prompt", { text: "第二个问题" }); await f.idle();
  await f.app.store.execute({ op: "session.pin", requestId: crypto.randomUUID(), ...f.scope, params: { pinned: true } });
  const errors: string[] = [];
  const openSource = async (width = 1440, height = 900, touch = false) => {
    const page = await browser.newPage({ viewport: { width, height }, hasTouch: touch, reducedMotion: "reduce" });
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(scope => sessionStorage.setItem("view", JSON.stringify(scope)), f.scope);
    await page.goto(f.app.origin);
    await page.getByText("REWRITE_ANSWER_2", { exact: true }).waitFor();
    assert.equal(await page.locator(".composer .fork-action").count(), 0);
    return page;
  };
  const artifacts = resolve("test-results/session-fork"); mkdirSync(artifacts, { recursive: true });
  const page = await openSource();
  await page.locator("#prompt").fill("源会话独立草稿");
  const assertLayout = async (page: Page, width: number) => {
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}: no overflow`);
    const buttons = page.locator(".fork-action");
    assert.equal(await buttons.count(), 4);
    for (const button of await buttons.all()) {
      await button.scrollIntoViewIfNeeded();
      const message = button.locator("xpath=ancestor::div[contains(@class, 'editable-user-message')]");
      if (await message.count() && await page.evaluate(() => matchMedia("(hover: none), (pointer: coarse)").matches)) await message.focus();
      await button.focus();
      const box = await button.boundingBox();
      const minimum = await button.evaluate(node => node.closest(".editable-user-message") ? 24 : matchMedia("(pointer: coarse)").matches ? 44 : 28);
      assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1 && box.width >= minimum && box.height >= minimum, `${width}: button bounds ${JSON.stringify(box)}`);
      assert.ok(await button.evaluate(node => {
        const r = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      }), `${width}: button receives clicks ${JSON.stringify(await button.evaluate(node => {
        const r = node.getBoundingClientRect();
        return { label: node.getAttribute("aria-label"), rect: r.toJSON(), thread: node.closest(".thread")?.getBoundingClientRect().toJSON(), hit: document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.outerHTML.slice(0, 200) };
      }))}`);
    }
    assert.equal(await page.locator(".reply-actions").first().evaluate(node => getComputedStyle(node).gap), "0px");
    for (const message of await page.locator(".editable-user-message").all()) {
      assert.ok(await message.evaluate(node => {
        const actions = node.querySelector(".message-actions")!, rect = actions.getBoundingClientRect();
        const bubble = node.getBoundingClientRect();
        const buttons = [...actions.querySelectorAll("button")].map(button => button.getBoundingClientRect());
        return rect.right <= bubble.left && bubble.left - rect.right <= 5 &&
          rect.left >= 0 && Math.abs(buttons[1].left - buttons[0].right) <= 1 &&
          parseFloat(getComputedStyle(node).paddingInlineStart) <= 18;
      }), `${width}: both user actions outside left border, compact and without internal reserved space`);
    }
  };
  for (const [width, height] of [[1440, 900], [820, 900], [390, 844], [390, 480]]) {
    await page.setViewportSize({ width, height }); await assertLayout(page, width);
    // The last message stays fully visible in the short viewport; the first can scroll above the thread.
    await page.locator("#prompt").focus();
    const message = page.locator(".editable-user-message").last();
    await message.hover();
    const pencil = message.getByRole("button", { name: "修改并重新发送", exact: true });
    assert.ok(await pencil.evaluate(node => {
      const r = node.getBoundingClientRect(), thread = node.closest(".thread")!.getBoundingClientRect();
      return r.top >= thread.top && r.bottom <= thread.bottom;
    }), `${width}: hover target fully inside thread viewport`);
    await pencil.hover();
    assert.equal(await pencil.evaluate(node => getComputedStyle(node).opacity), "1", "buttons stay visible when pointer moves outside bubble");
    await page.screenshot({ path: join(artifacts, `${width}-${height}.png`) });
  }
  const mobile = await openSource(390, 844, true);
  const assertTouchHidden = async () => {
    for (const button of await mobile.locator(".editable-user-message .message-actions > button").all())
      assert.equal(await button.evaluate(node => getComputedStyle(node).visibility), "hidden", "touch actions hidden without message focus, including sticky hover");
  };
  await assertTouchHidden();
  for (const [width, height] of [[320, 844], [390, 844], [430, 844], [390, 480]]) {
    await mobile.setViewportSize({ width, height });
    await mobile.locator("#prompt").tap();
    await assertTouchHidden();
    await mobile.screenshot({ path: join(artifacts, `touch-hidden-${width}-${height}.png`) });
    const message = mobile.locator(".editable-user-message").last();
    await message.tap();
    assert.equal(await mobile.locator(".composer-edit-status").count(), 0, "tapping text only reveals actions, never starts editing");
    assert.ok(await message.evaluate(node => {
      const buttons = [...node.querySelectorAll<HTMLButtonElement>(".message-actions > button")];
      const icons = buttons.map(button => button.querySelector("svg")!.getBoundingClientRect());
      return buttons.every(button => {
        const r = button.getBoundingClientRect();
        return r.width === 24 && r.height >= 44 && getComputedStyle(button).visibility === "visible" &&
          button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      }) && Math.abs(icons[1].left - icons[0].left - 24) <= 1 && icons[1].left - icons[0].right <= 8.5;
    }), `${width}: real tap reveals compact 24px-centered icons with 44px-tall distinct hit targets`);
    await mobile.screenshot({ path: join(artifacts, `touch-revealed-${width}-${height}.png`) });
    await mobile.getByText("REWRITE_ANSWER_2", { exact: true }).tap();
    await assertTouchHidden();
    assert.equal(f.requests.length, 2);
    assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}: touch no overflow`);
  }
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.locator(".editable-user-message").last().tap();
  await mobile.locator(".editable-user-message").last().getByRole("button", { name: "修改并重新发送", exact: true }).tap();
  await mobile.getByRole("button", { name: "取消修改", exact: true }).waitFor();
  assert.equal(await mobile.locator("#prompt").inputValue(), "第二个问题", "real touch pencil refills composer");
  await mobile.getByRole("button", { name: "取消修改", exact: true }).tap();
  assert.equal(await mobile.locator("#prompt").inputValue(), "源会话独立草稿");
  await assertLayout(mobile, 390);
  await mobile.locator("#prompt").tap();
  await assertTouchHidden();
  await mobile.screenshot({ path: join(artifacts, "touch-390.png") });
  const confirm = async (page: Page) => {
    const dialog = page.getByRole("dialog", { name: "创建分支会话" });
    await dialog.waitFor();
    assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem("view") ?? "{}").sessionId), f.scope.sessionId);
    await dialog.getByRole("button", { name: "创建并打开", exact: true }).click();
    await page.waitForFunction(sourceId => JSON.parse(sessionStorage.getItem("view") ?? "{}").sessionId !== sourceId, f.scope.sessionId);
  };
  const count = () => Number(f.app.store.db.prepare("SELECT count(*) AS n FROM sessions").get()!.n);
  // Both dialog actions create one branch; only the primary action navigates.
  const createOnly = async (page: Page, selector: string, artifact: string) => {
    const before = count();
    const draft = await page.locator("#prompt").inputValue();
    const button = page.locator(selector).first();
    if (await page.evaluate(() => matchMedia("(pointer: coarse)").matches)) {
      await button.locator("xpath=ancestor::div[contains(@class, 'editable-user-message')]").tap();
      await button.tap();
    } else { await button.focus(); await button.click(); }
    const dialog = page.getByRole("dialog", { name: "创建分支会话" });
    await dialog.getByRole("button", { name: "创建并打开", exact: true }).waitFor();
    await page.screenshot({ path: join(artifacts, artifact) });
    await dialog.getByRole("button", { name: "仅创建", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    assert.equal(count(), before + 1, "only-create creates exactly one branch");
    assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem("view") ?? "{}").sessionId), f.scope.sessionId);
    assert.equal(await page.locator("#prompt").inputValue(), draft, "only-create retains current draft");
    await page.getByText("REWRITE_ANSWER_2", { exact: true }).waitFor();
    const latest = f.app.store.db.prepare("SELECT id FROM sessions WHERE forkParentSessionId = ? ORDER BY updatedAt DESC LIMIT 1").get(f.scope.sessionId)!;
    await page.waitForFunction(({ parent, child }) => {
      const rows = [...document.querySelectorAll("#history [data-session-id]")].map(node => node.getAttribute("data-session-id"));
      return rows.indexOf(parent) >= 0 && rows.indexOf(child) === rows.indexOf(parent) + 1;
    }, { parent: f.scope.sessionId, child: String(latest.id) });
    assert.equal(f.requests.length, 2, "only-create does not send");
  };
  await page.setViewportSize({ width: 1440, height: 900 });
  await createOnly(page, ".reply-actions .fork-action", "dual-action-desktop.png");
  await createOnly(mobile, ".editable-user-message .fork-action", "dual-action-touch.png");
  // Cancelling creates nothing and retains source selection.
  const before = count();
  await mobile.locator(".editable-user-message").first().tap();
  await mobile.locator(".editable-user-message .fork-action").first().tap();
  await mobile.getByRole("dialog").getByRole("button", { name: "取消", exact: true }).tap();
  assert.equal(count(), before);
  await mobile.locator(".editable-user-message").first().tap();
  await mobile.locator(".editable-user-message .fork-action").first().tap();
  await confirm(mobile);
  await mobile.waitForFunction(() => (document.querySelector("#prompt") as HTMLTextAreaElement)?.value === "第一个问题 [file1]");
  assert.equal(await mobile.getByText("REWRITE_ANSWER_1", { exact: true }).count(), 0);
  assert.equal(await mobile.getByText("第二个问题", { exact: true }).count(), 0);
  assert.ok(await mobile.getByText("notes.txt", { exact: true }).count());
  assert.equal(f.requests.length, 2);
  await mobile.screenshot({ path: join(artifacts, "user-branch-mobile.png") });
  // Fork from an answer includes precisely that answer; pinned source and branch stay adjacent.
  const replyPage = await openSource();
  assert.equal(await replyPage.locator("#prompt").inputValue(), "源会话独立草稿");
  await replyPage.locator(".reply-actions .fork-action").first().focus();
  await replyPage.locator(".reply-actions .fork-action").first().click();
  await confirm(replyPage);
  await replyPage.waitForFunction(() => !document.body.textContent?.includes("REWRITE_ANSWER_2"));
  await replyPage.getByText("REWRITE_ANSWER_1", { exact: true }).waitFor();
  assert.equal(await replyPage.locator("#prompt").inputValue(), "");
  const branchView = await replyPage.evaluate(() => sessionStorage.getItem("view"));
  const branchId = JSON.parse(branchView!).sessionId;
  const assertAdjacent = async () => {
    await replyPage.waitForFunction(({ parent, child }) => {
      const rows = [...document.querySelectorAll("#history [data-session-id]")].map(node => node.getAttribute("data-session-id"));
      return rows.indexOf(parent) >= 0 && rows.indexOf(child) === rows.indexOf(parent) + 1;
    }, { parent: f.scope.sessionId, child: branchId });
  };
  await assertAdjacent();
  await replyPage.addInitScript(view => sessionStorage.setItem("view", view!), branchView);
  await replyPage.reload();
  await replyPage.getByText("REWRITE_ANSWER_1", { exact: true }).waitFor();
  await assertAdjacent();
  await replyPage.screenshot({ path: join(artifacts, "reply-branch-adjacent.png") });
  f.stall(true); await f.call("prompt", { text: "BUSY_UI" });
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLButtonElement>(".fork-action")].every(button => button.disabled));
  await f.app.tasks.stopParent(f.scope); await f.idle();
  assert.deepEqual(errors, []);
  console.log("PASS: two message entries; compact left/adjacent actions; real-touch hidden/tap-reveal/outside-dismiss; 24px icon centers and 44px-tall hit targets; responsive hit targets; confirmation/cancel; create-only retains source and draft; navigate after confirm; pinned source adjacency and reload; original draft; attachments; no auto-send; answer cutoff; busy guards");
} finally { await browser.close(); await f.close(); }
