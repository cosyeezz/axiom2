// Real Composer submissions with isolated sessions and prompt interception; no model calls.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page, type WebSocketRoute } from "playwright";
import { startServer } from "../src/server/index.js";
import { agentScope, emptyAgent } from "../src/shared/agent.js";
import type { AgentViews } from "../src/server/agents/views.js";
import type { Command, Session, Workspace } from "../src/shared/protocol.js";

const root = mkdtempSync(join(tmpdir(), "axiom-submit-scroll-"));
mkdirSync(join(root, "pi"));
const previousPi = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = join(root, "pi");
const app = await startServer({ root: join(root, "data"), port: 0, dev: process.env.AXIOM_TEST_BUILT !== "1" });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
async function bottom(page: Page, label: string) {
  await page.waitForFunction(() => {
    const el = document.querySelector("#thread")!;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 2;
  }, null, { timeout: 3000 }).catch(async () => {
    assert.fail(`${label}: ${JSON.stringify(await page.locator("#thread").evaluate(el => ({ top: el.scrollTop, height: el.clientHeight, total: el.scrollHeight })))}`);
  });
}
async function frames(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
try {
  const workspace = app.store.execute({ requestId: crypto.randomUUID(), op: "workspace.open", params: { path: root, authorized: true } }) as Workspace;
  const views = (app.agents as unknown as { views: AgentViews }).views;
  const scopes = [0, 1].map(i => {
    const session = app.store.execute({ requestId: crypto.randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
    const scope = { workspaceId: workspace.id, sessionId: session.id };
    for (let n = 0; n < 60; n++) views.messageChanged(scope, { id: `m${n}`, role: n % 2 ? "assistant" : "user", text: `会话${i} 历史消息${n}\n\n历史内容。` });
    views.flush(scope);
    return scope;
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [], sends: Command[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/@vite/client", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace("async function handleMessage(payload) {", "async function handleMessage(payload) { return;") });
  });
  await page.addInitScript(scope => sessionStorage.setItem("view", JSON.stringify(scope)), scopes[0]);
  const selection = { provider: "fixture", id: "fixture", thinking: "off" };
  let active = false, socket: WebSocketRoute, seq = 0;
  const publish = (scope: typeof scopes[number]) => socket.send(JSON.stringify({ type: "snapshot", scope: agentScope(scope), streamId: "scroll-fixture", seq: ++seq,
    data: { ...emptyAgent, selection, run: active ? { id: "running", sessionId: scope.sessionId, status: "running", selection, startedAt: Date.now() } : null } }));
  await page.routeWebSocket("**/ws", route => {
    socket = route;
    const server = route.connectToServer();
    route.onMessage(raw => {
      const command = JSON.parse(raw.toString()) as Command;
      if (command.op === "prompt") {
        sends.push(command);
        route.send(JSON.stringify({ type: "receipt", requestId: command.requestId, ok: true, data: active ? { inputId: command.requestId } : { runId: command.requestId } }));
      } else if (command.op === "subscribe" && scopes.some(scope => agentScope(scope) === command.params?.scope)) {
        publish(scopes.find(scope => agentScope(scope) === command.params?.scope)!);
        route.send(JSON.stringify({ type: "receipt", requestId: command.requestId, ok: true, data: {} }));
      } else server.send(raw);
    });
    server.onMessage(raw => {
      const message = JSON.parse(raw.toString());
      if (message.type === "snapshot" && scopes.some(scope => agentScope(scope) === message.scope)) return;
      if (message.type === "snapshot" && message.scope === "configuration") message.data.available = [{ ...selection, name: "Fixture", input: ["text"] }];
      route.send(JSON.stringify(message));
    });
  });
  await page.goto(app.origin);
  await page.getByText("会话0 历史消息59", { exact: false }).waitFor();
  for (const scope of scopes) {
    await page.locator(`.history-row[data-session-id="${scope.sessionId}"] .history-item`).click();
    await page.waitForFunction(id => JSON.parse(sessionStorage.getItem("view")!).sessionId === id, scope.sessionId);
    await page.getByText(`会话${scopes.indexOf(scope)} 历史消息59`, { exact: false }).waitFor();
    await bottom(page, "session navigation");
    for (const queued of [false, true]) {
      active = queued; publish(scope);
      for (const multiline of [false, true]) {
        const marker = `${scope.sessionId}-${queued}-${multiline}`;
        const text = marker + "\n" + (multiline ? "多行输入清空后恢复跟随\n".repeat(30) : "本次单行输入");
        await page.locator("#prompt").fill(text);
        const thread = page.locator("#thread"), box = (await thread.boundingBox())!;
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.wheel(0, 200 - await thread.evaluate(el => el.scrollTop));
        await page.waitForFunction(() => Math.abs(document.querySelector("#thread")!.scrollTop - 200) < 2);
        await frames(page);
        const count = sends.length;
        if (multiline && !queued) {
          // Button submission preserves a document selection unless sending clears it.
          await page.locator("#thread .user-text").first().evaluate(el => {
            const range = document.createRange(); range.selectNodeContents(el);
            getSelection()!.removeAllRanges(); getSelection()!.addRange(range);
          });
          assert.ok(await page.evaluate(() => getSelection()!.toString()));
          await page.locator("button.send").click();
        } else await page.locator("#prompt").press("Enter");
        await page.waitForFunction(() => !(document.querySelector("#prompt") as HTMLTextAreaElement).value);
        assert.equal(sends.length, count + 1);
        await bottom(page, `real send queued=${queued} multiline=${multiline}`);
        if (multiline && !queued) assert.equal(await page.evaluate(() => getSelection()!.toString()), "", "sending ends selection-based reading");
        const command = sends.at(-1)!;
        assert.equal(command.sessionId, scope.sessionId, "submission belongs to the displayed session");
        views.messageChanged(scope, { id: `input-${command.requestId}`, role: "user", text, inputIds: [command.requestId] }); views.flush(scope);
        await page.locator(`#messages .user-text`).filter({ hasText: marker }).waitFor();
        await bottom(page, "formal input and queue removal");
        const output = `后续输出 ${command.requestId}`;
        views.messageChanged(scope, { id: `output-${command.requestId}`, role: "assistant", phase: "final_answer", text: `${output}\n\n` + "流式正文\n\n".repeat(30) }); views.flush(scope);
        await page.getByText(output, { exact: true }).waitFor();
        await bottom(page, "streaming after real send");
      }
    }
  }
  // A plain click to focus the conversation must not silently cancel tail following.
  for (const target of ["text", "blank"] as const) {
    const tail = page.locator("#messages .reply-body .markdown p").last();
    if (target === "text") await tail.click();
    else {
      const bounds = (await page.locator("#thread").boundingBox())!;
      await page.mouse.click(bounds.x + 24, bounds.y + bounds.height - 12);
    }
    const marker = `普通${target}点击后的流式输出`;
    views.messageChanged(scopes[1], { id: `click-output-${target}`, role: "assistant", phase: "final_answer", text: `${marker}\n\n` + "继续跟随正文\n\n".repeat(30) });
    views.flush(scopes[1]);
    await page.getByText(marker, { exact: true }).waitFor();
    await bottom(page, `streaming after plain ${target} click`);
  }
  // First the down arrow reaches the last delivery start; clicking it again
  // reaches the bottom smoothly, rather than skipping that delivery.
  const thread = page.locator("#thread");
  const box = (await thread.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -1000);
  await page.waitForFunction(() => { const el = document.querySelector("#thread")!; return el.scrollHeight - el.clientHeight - el.scrollTop > 900; });
  await frames(page);
  await page.locator('.thread-navigation [data-scroll="down"]').click();
  await page.waitForFunction(() => {
    const body = document.querySelector('[data-delivery-start="click-output-blank"]')!, thread = document.querySelector("#thread")!;
    return Math.abs(body.getBoundingClientRect().top - thread.getBoundingClientRect().top - 24) < 2;
  });
  await page.waitForTimeout(120);
  const firstNavigationGap = await page.evaluate<number>(`new Promise(resolve => {
    const el = document.querySelector("#thread");
    const start = el.scrollTop;
    const sample = () => {
      if (el.scrollTop <= start + 1) return;
      el.removeEventListener("scroll", sample);
      requestAnimationFrame(() => resolve(el.scrollHeight - el.clientHeight - el.scrollTop));
    };
    el.addEventListener("scroll", sample);
    document.querySelector('.thread-navigation [data-scroll="down"]').click();
  })`);
  assert.ok(firstNavigationGap > 2, `bottom navigation preserves intermediate animation frames: ${JSON.stringify({ gap: firstNavigationGap, reducedMotion: await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches) })}`);
  await bottom(page, "smooth navigation returns to tail");
  // A new submission wins even when a delivery reveal still has positioning
  // frames/observers pending. Both actions intentionally happen in one event turn.
  // The preceding loop ends with an active run, where form submission means
  // stop rather than send. Explicitly enter idle before testing requestSubmit.
  active = false; publish(scopes[1]);
  await page.waitForFunction(() => !document.querySelector("button.send")!.classList.contains("is-running"));
  const beforeRaceSend = sends.length;
  const raceText = "交付定位尚未结束时发送，必须恢复跟随";
  await page.locator("#prompt").fill(raceText);
  await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>('.thread-navigation [data-scroll="up"]')!.click();
    document.querySelector<HTMLFormElement>("form.composer")!.requestSubmit();
  });
  await page.waitForFunction(() => !(document.querySelector("#prompt") as HTMLTextAreaElement).value);
  assert.equal(sends.length, beforeRaceSend + 1);
  await page.waitForTimeout(300); await bottom(page, "submission cancels unfinished delivery positioning");
  const raceCommand = sends.at(-1)!;
  views.messageChanged(scopes[1], { id: `input-${raceCommand.requestId}`, role: "user", text: raceText, inputIds: [raceCommand.requestId] }); views.flush(scopes[1]);
  await page.getByText(raceText, { exact: true }).waitFor(); await bottom(page, "race submission reconciles at tail");
  // Keyboard reading is also an explicit interruption, and reaching the tail restores following.
  const keyboardTarget = page.locator("#thread .reply-actions .copy-reply").last();
  assert.equal(await keyboardTarget.isEnabled(), true);
  await keyboardTarget.focus();
  assert.equal(await keyboardTarget.evaluate(node => node === document.activeElement), true, "keyboard reading starts from an enabled reply action");
  const beforeKeyboard = await thread.evaluate(el => el.scrollTop);
  await page.keyboard.press("PageUp");
  await page.waitForFunction(before => document.querySelector("#thread")!.scrollTop < before - 100, beforeKeyboard, { timeout: 3000 });
  await page.waitForTimeout(250); // Native keyboard scrolling animates beyond its first scroll event.
  const reading = await thread.evaluate(el => el.scrollTop);
  views.messageChanged(scopes[1], { id: "keyboard-output", role: "assistant", text: "键盘阅读时的新输出\n\n" + "键盘阅读正文\n\n".repeat(30) }); views.flush(scopes[1]);
  await page.getByText("键盘阅读时的新输出", { exact: false }).waitFor();
  await frames(page);
  assert.equal(await thread.evaluate(el => el.scrollTop), reading, "keyboard reading survives output");
  await page.keyboard.press("End");
  await bottom(page, "keyboard returns to tail");
  assert.deepEqual(errors, []);
  console.log("PASS: real Composer idle/steering, single/multiline, two sessions, input reconciliation, subsequent output and keyboard reading");
} finally {
  await browser.close(); await app.close();
  if (previousPi === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previousPi;
  rmSync(root, { recursive: true, force: true });
}
