// Actual composer + responsive styles, isolated data/port, no model requests.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, webkit, type Page } from "playwright";
import { startServer } from "../src/server/index.js";
import { agentScope, emptyAgent, type Selection } from "../src/shared/agent.js";
import type { Command, ModelSummary, Session, Workspace } from "../src/shared/protocol.js";

const root = mkdtempSync(join(tmpdir(), "axiom-composer-model-label-"));
const engine = process.env.AXIOM_LABEL_BROWSER === "webkit" ? "webkit" : "chromium";
const artifacts = resolve(process.env.AXIOM_LABEL_ARTIFACTS ?? `test-results/composer-model-label-${engine}`);
for (const dir of [artifacts, join(root, "pi"), join(root, "project")]) mkdirSync(dir, { recursive: true });
const previousPi = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = join(root, "pi");
const app = await startServer({ root: join(root, "data"), port: 0, dev: true });
const browser = await (engine === "webkit" ? webkit.launch() : chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER }));
const errors: string[] = [], commands: string[] = [], results: unknown[] = [];
const models: ModelSummary[] = [
  { provider: "custom-primary", providerName: "自定义供应商 · Primary Gateway", id: "long-model", name: "GPT-6.1 Sol – Ultrafast (Codex subscription; entitlement required)", levels: ["off", "low", "medium", "high", "xhigh", "max"] },
  { provider: "custom-backup", providerName: "备用供应商 · Enterprise Inference Gateway", id: "long-model", name: "ClaudeSonnetExtendedThinking".repeat(4), levels: ["off", "high", "xhigh"] },
  { provider: "openai", providerName: "OpenAI", id: "short-model", name: "GPT-6", levels: ["off", "high", "xhigh"] },
];
let page: Page | undefined;
try {
  const workspace = app.store.execute({ requestId: crypto.randomUUID(), op: "workspace.open", params: { path: join(root, "project"), authorized: true } }) as Workspace;
  const session = app.store.execute({ requestId: crypto.randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const scope = { workspaceId: workspace.id, sessionId: session.id };
  for (const touch of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: touch, reducedMotion: "reduce" });
    page = await context.newPage();
    page.setDefaultTimeout(10000);
    let currentCase = `${touch ? "touch" : "mouse"}-loading`;
    page.on("pageerror", error => errors.push(`${currentCase}: ${error.message}`));
    await page.addInitScript("window.__name = value => value;");
    await page.addInitScript(value => sessionStorage.setItem("view", JSON.stringify(value)), scope);
    let selection: Selection = { provider: models[0].provider, id: models[0].id, thinking: "xhigh" };
    let sendAgent: (() => void) | undefined, seq = 0;
    // This is a fixed UI fixture, not an HMR test. Unrelated workspace edits
    // must not reload its document in the middle of a layout assertion.
    await page.routeWebSocket(url => url.pathname !== "/ws", () => {});
    await page.routeWebSocket("**/ws", route => {
      const server = route.connectToServer();
      const snapshot = (name: string, data: unknown) => route.send(JSON.stringify({ type: "snapshot", scope: name, streamId: "label-fixture", seq: ++seq, data }));
      sendAgent = () => snapshot(agentScope(scope), { ...emptyAgent, selection });
      route.onMessage(raw => {
        const command = JSON.parse(raw.toString()) as Command;
        commands.push(command.op);
        if (command.op === "agent.model") {
          selection = command.params!.selection as Selection;
          sendAgent!();
          route.send(JSON.stringify({ type: "receipt", requestId: command.requestId, ok: true, data: {} }));
        } else if (["prompt", "agent.append", "agent.rewrite", "agent.fork"].includes(command.op)) {
          throw Error(`Unexpected model operation: ${command.op}`);
        } else server.send(raw);
      });
      server.onMessage(raw => {
        const event = JSON.parse(raw.toString());
        if (event.type === "snapshot" && event.scope === "configuration") snapshot(event.scope, { ...event.data, available: models, modelCount: models.length });
        else if (event.type === "snapshot" && event.scope === agentScope(scope)) sendAgent!();
        else route.send(raw);
      });
    });
    await page.goto(app.origin);
    const input = page.locator("#prompt"), summary = page.locator(".composer .model-picker > summary");
    await summary.getByText(models[0].name, { exact: false }).waitFor();
    const settle = async () => {
      await page!.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
      await page!.waitForTimeout(60);
    };
    const verify = async (model: ModelSummary, label: string) => {
      await settle();
      await summary.scrollIntoViewIfNeeded();
      const mobile = await page!.locator(".app").evaluate(node => node.matches(".mobile-workbench,.android-workbench"));
      const expected = `${mobile ? "" : `${model.providerName} / `}${model.name} · ${selection.thinking}`;
      assert.equal(await summary.locator(":scope > span").innerText(), expected, label);
      const geometry = await summary.evaluate(el => {
        const form = el.closest(".composer")!, copy = el.querySelector<HTMLElement>(":scope > span")!;
        const box = form.getBoundingClientRect(), textBox = copy.getBoundingClientRect();
        const controls = [form.querySelector("textarea")!, ...form.querySelectorAll(".attachment-picker,.composer-clear,.model-picker > summary,.send")];
        const rects = controls.map(node => node.getBoundingClientRect());
        const clipped: string[] = [];
        const walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!node.parentElement?.getClientRects().length) continue; // mobile provider is intentionally absent
          const range = document.createRange();
          for (let i = 0; i < node.textContent!.length; i++) {
            range.setStart(node, i); range.setEnd(node, i + 1);
            for (const r of range.getClientRects()) {
              if (!r.width || !r.height) continue;
              const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
              if (r.left < textBox.left - 1 || r.right > textBox.right + 1 || r.top < textBox.top - 1 || r.bottom > textBox.bottom + 1 || !hit || !copy.contains(hit)) clipped.push(node.textContent!.slice(i, i + 1));
            }
          }
        }
        return {
          ellipsis: getComputedStyle(copy).textOverflow === "ellipsis",
          clipped,
          contained: rects.every(r => r.left >= box.left - 1 && r.right <= box.right + 1 && r.top >= box.top - 1 && r.bottom <= box.bottom + 1),
          overlaps: rects.some((a, i) => rects.slice(i + 1).some(b => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1)),
          horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
          touchHeight: el.getBoundingClientRect().height >= 44,
        };
      });
      const typography = await page!.locator(".composer").evaluate(form => {
        const input = getComputedStyle(form.querySelector("textarea")!);
        const model = getComputedStyle(form.querySelector(".model-picker > summary")!);
        return { inputSize: input.fontSize, modelSize: model.fontSize, inputFont: input.fontFamily, modelFont: model.fontFamily,
          expectedSize: 14 * Math.max(.85, Math.min(Number(getComputedStyle(form).getPropertyValue("--display-font-scale") || 1), 1.15)) };
      });
      assert.ok(Math.abs(parseFloat(typography.inputSize) - typography.expectedSize) < .01, `both labels compact: ${label}`);
      assert.equal(typography.inputSize, typography.modelSize, `matching compact font size: ${label}`);
      assert.equal(typography.inputFont, typography.modelFont, `matching font family: ${label}`);
      const alignment = await page!.locator(".composer").evaluate(form => {
        if (form.hasAttribute("data-multiline")) return null;
        const input = form.querySelector("textarea")!, span = form.querySelector(".model-picker > summary > span")!;
        const style = getComputedStyle(input), inputBox = input.getBoundingClientRect(), modelBox = span.getBoundingClientRect();
        // Responsive layouts may deliberately place model controls in a separate row.
        const controls = form.querySelector(".composer-model-controls") ?? form.querySelector(".model-picker")!;
        if (getComputedStyle(controls).gridRowStart !== style.gridRowStart || modelBox.top >= inputBox.bottom || modelBox.bottom <= inputBox.top) return null;
        return Math.abs(inputBox.top + parseFloat(style.paddingTop) + parseFloat(style.lineHeight) / 2 - (modelBox.top + modelBox.height / 2));
      });
      if (alignment !== null && label.startsWith("visual-empty")) assert.ok(alignment <= 1, `text vertical alignment ${alignment}: ${label}`);
      // Long identities are intentionally ellipsized, never wrapped or distorted.
      assert.equal(geometry.ellipsis, true, label);
      assert.equal(await summary.locator(":scope > span").evaluate(el => getComputedStyle(el).whiteSpace), "nowrap", label);
      assert.ok(await summary.getAttribute("title"), label);
      assert.deepEqual({ ...geometry, clipped: [] }, { ellipsis: true, clipped: [], contained: true, overlaps: false, horizontalOverflow: false, touchHeight: true }, label);
      const clearAlignment = await page!.locator(".composer-model-controls").evaluate(controls => {
        const clear = controls.querySelector(".composer-clear"), model = controls.querySelector(".model-picker > summary");
        if (!clear || !model || getComputedStyle(controls).display !== "flex") return 0;
        const a = clear.getBoundingClientRect(), b = model.getBoundingClientRect();
        return Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2);
      });
      assert.ok(clearAlignment <= 1, `eraser stays beside model: ${label}`);
      // Stable row placement over successive observer/layout frames.
      const frames = await page!.locator(".composer").evaluate(async form => {
        const values: string[] = [];
        for (let i = 0; i < 6; i++) {
          await new Promise(requestAnimationFrame);
          const input = form.querySelector("textarea")!.getBoundingClientRect();
          values.push(`${form.hasAttribute("data-multiline")}:${input.width}:${input.height}:${form.getBoundingClientRect().height}`);
        }
        return values;
      });
      assert.equal(new Set(frames).size, 1, `stable layout: ${label}`);
      results.push({ label, mobile, expected });
    };
    for (const [width, height] of [[320, 640], [390, 844], [640, 900], [641, 900], [820, 900], [1440, 900], ...(touch ? [[844, 390]] : [])]) {
      await page.setViewportSize({ width, height });
      await page.waitForFunction(() => document.querySelector(".app")?.classList.contains("mobile-workbench") === matchMedia("(max-width:640px), (pointer:coarse) and (max-height:500px)").matches);
      for (const scale of [100, 150, 200]) {
        await page.evaluate(async fontScale => {
          const path = "/display-settings.ts";
          (await import(/* @vite-ignore */ path)).setDisplaySettings({ fontScale });
        }, scale);
        for (const model of models.slice(0, 2)) {
          selection = { provider: model.provider, id: model.id, thinking: "xhigh" };
          sendAgent!();
          await summary.getByText(model.name, { exact: false }).waitFor();
          for (const draft of ["", "短", "第一行\n第二行\n第三行"]) {
            currentCase = `${touch ? "touch" : "mouse"}-${width}x${height}-${scale}-${model.provider}-${draft ? draft.includes("\n") ? "multiline" : "short" : "empty"}`;
            await input.fill(draft);
            await verify(model, currentCase);
          }
        }
      }
      await page.screenshot({ path: join(artifacts, `${touch ? "touch" : "mouse"}-${width}x${height}.png`) });
    }
    // Android is mobile even when its WebView is wider than the media breakpoint.
    currentCase = `Android-wide-${touch}`;
    await page.setViewportSize({ width: 820, height: 900 });
    await page.locator(".app").evaluate(node => node.classList.add("android-workbench"));
    await input.fill("Android draft");
    await verify(models[1], `Android-wide-${touch}`);
    await page.locator(".app").evaluate(node => node.classList.remove("android-workbench"));
    await page.evaluate(async () => {
      const path = "/display-settings.ts";
      (await import(/* @vite-ignore */ path)).setDisplaySettings({ fontScale: 100 });
    });
    // A real menu confirmation updates both provider and model, then collapses safely.
    currentCase = `menu-confirmation-${touch}`;
    await page.setViewportSize({ width: 320, height: 640 });
    await settle();
    await summary.click();
    const menu = page.locator(".model-popover[data-floating]");
    // Six fixed columns even under enlarged typography; shorter lists leave slots empty.
    for (const fontScale of [50, 100, 150, 200]) {
      await page.evaluate(async scale => {
        const path = "/display-settings.ts";
        (await import(/* @vite-ignore */ path)).setDisplaySettings({ fontScale: scale });
      }, fontScale);
      for (const model of models) {
        await menu.locator(".model-option").filter({ has: page.getByText(model.name, { exact: true }) }).click();
        const layout = await menu.locator(".model-levels").evaluate(el => {
          const boxes = [...el.querySelectorAll(".model-level")].map(node => node.getBoundingClientRect());
          return { columns: getComputedStyle(el).gridTemplateColumns.split(" ").length,
            oneRow: boxes.every(box => Math.abs(box.top - boxes[0].top) < 1),
            fits: [...el.querySelectorAll(".model-level span")].every(node => node.scrollWidth <= node.clientWidth + 1) };
        });
        assert.deepEqual(layout, { columns: 6, oneRow: true, fits: true });
      }
    }
    await menu.getByRole("button", { name: "GPT-6 OpenAI", exact: true }).click();
    await menu.getByRole("radio", { name: "high", exact: true }).check();
    await menu.getByRole("button", { name: "确认模型设置", exact: true }).click();
    await menu.waitFor({ state: "hidden" });
    await verify(models[2], `confirmed-short-model-${touch}`);
    await page.getByRole("button", { name: "清空输入", exact: true }).click();
    await verify(models[2], `cleared-${touch}`);
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const fontScale of [100, 150, 200]) {
      await page.evaluate(async scale => {
        const path = "/display-settings.ts";
        (await import(/* @vite-ignore */ path)).setDisplaySettings({ fontScale: scale });
      }, fontScale);
      await verify(models[2], `visual-empty-${touch}-${fontScale}`);
      await page.locator(".composer").screenshot({ path: join(artifacts, `composer-empty-${touch}-${fontScale}.png`) });
    }
    // User screenshot regression: a short image reference must not grow a blank row
    // or wrap the eraser above the model identity.
    await page.evaluate(async currentScope => {
      const path = "/chat/composer-edit.ts";
      (await import(/* @vite-ignore */ path)).updateComposerDraft(currentScope, {
        text: "[img1] 放到进度条下方", attachment: null,
        images: [{ id: "img1", name: "image.png", mimeType: "image/png", data: "AA==" }],
      });
    }, scope);
    await verify(models[2], `image-reference-${touch}`);
    assert.equal(await page.locator(".composer").getAttribute("data-multiline"), null);
    await page.locator(".composer-area").screenshot({ path: join(artifacts, `composer-image-${touch}.png`) });
    await context.close();
  }
  assert.deepEqual(errors, []);
  assert.ok(!commands.some(op => ["prompt", "agent.append", "agent.rewrite", "agent.fork"].includes(op)));
  const report = { passed: true, engine, checks: results.length, errors, results };
  writeFileSync(join(artifacts, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: true, engine, checks: results.length, artifacts }));
} catch (error) {
  writeFileSync(join(artifacts, "failure-report.json"), JSON.stringify({ engine, checks: results.length, errors, message: String(error), results }, null, 2));
  if (page && !page.isClosed()) {
    await page.screenshot({ path: join(artifacts, "failure.png") });
    writeFileSync(join(artifacts, "failure.html"), await page.content());
  }
  throw error;
} finally {
  await browser.close(); await app.close();
  if (previousPi === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previousPi;
  rmSync(root, { recursive: true, force: true });
}
