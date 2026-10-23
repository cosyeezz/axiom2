import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { startServer } from "../src/server/index.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

const root = mkdtempSync(join(tmpdir(), "axiom-display-"));
const artifacts = resolve("test-results/display-settings-chromium");
mkdirSync(artifacts, { recursive: true });
const previous = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = join(root, "pi");
let app: Awaited<ReturnType<typeof startServer>> | undefined;
let browser: Browser | undefined;
async function slider(page: Page, name: string, value: number) {
  await page.locator(`#display-${name}`).evaluate((element, value) => {
    const input = element as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, String(value));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}
async function wheel(page: Page, modifiers: { ctrlKey?: boolean; metaKey?: boolean }, deltaY = -40) {
  return page.evaluate(({ modifiers, deltaY }) => !document.body.dispatchEvent(new WheelEvent("wheel", { ...modifiers, deltaY, bubbles: true, cancelable: true })), { modifiers, deltaY });
}
const scaleReached = (page: Page, value: number) => page.waitForFunction(value => Number(document.documentElement.style.getPropertyValue("--display-font-scale")) === value / 100, value);
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < .1, `${actual} != ${expected}`);
try {
  app = await startServer({ root: join(root, "data"), port: 0 });
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(app.origin + "/settings.html");
  assert.equal(await page.locator('input[type="range"]').count(), 0, "overview has an entry, not a large embedded form");
  await page.locator('.module-row[href="/display.html"]').click();
  await page.locator("#display-fontScale").waitFor();
  assert.equal(await page.locator('.settings-nav[aria-current="page"]').innerText(), "显示与阅读");
  assert.equal(await page.locator(".font-browser").count(), 0, "font browser only opens on request");
  const settingsBox = (await page.locator(".display-layout").boundingBox())!;
  assert.ok(settingsBox.height < 500, "reading controls and the single preview stay compact");
  assert.ok(await page.locator('.display-controls .font-settings').isVisible(), "current font and browser entry stay with reading controls");
  assert.equal(await page.locator('.display-preview').count(), 1, "settings keep one current-effect preview");
  await page.screenshot({ path: join(artifacts, "compact-default.png"), fullPage: true });
  const themeSelect = page.getByRole("combobox", { name: "主题", exact: true });
  assert.equal(await themeSelect.innerText(), "黑夜");
  await themeSelect.click();
  await page.screenshot({ path: join(artifacts, "dark-theme-options.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("option", { name: "白天", exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
  await page.screenshot({ path: join(artifacts, "light-theme-settings.png"), fullPage: true, animations: "disabled" });
  await themeSelect.click();
  await page.screenshot({ path: join(artifacts, "light-theme-options.png"), fullPage: true, animations: "disabled" });
  await page.keyboard.press("Escape");
  assert.equal(await page.evaluate(() => localStorage.getItem("axiom.theme")), "light");
  await page.reload();
  await themeSelect.waitFor();
  assert.equal(await themeSelect.innerText(), "白天");
  assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
  const themeSibling = await context.newPage();
  await themeSibling.goto(app.origin + "/display.html");
  await themeSibling.getByRole("combobox", { name: "主题", exact: true }).waitFor();
  await themeSelect.click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await themeSibling.waitForFunction(() => document.documentElement.dataset.theme === "dark");
  assert.equal(await themeSibling.getByRole("combobox", { name: "主题", exact: true }).innerText(), "黑夜");
  await themeSibling.close();
  await themeSelect.click();
  await page.getByRole("option", { name: "白天", exact: true }).click();
  await page.getByRole("button", { name: "恢复默认", exact: true }).click();
  assert.equal(await themeSelect.innerText(), "黑夜");
  assert.equal(await page.evaluate(() => localStorage.getItem("axiom.theme")), "dark");
  const fontSize = () => page.locator(".display-preview-body").evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  near(await fontSize(), 14);
  await page.locator("#display-fontScale").focus(); await page.keyboard.press("ArrowRight");
  assert.equal(await page.locator("#display-fontScale").inputValue(), "100.1");
  await slider(page, "fontScale", 150);
  near(await fontSize(), 21);
  near(await page.locator(".display-preview").evaluate(el => parseFloat(getComputedStyle(el).paddingLeft)), 21);
  const originalColor = await page.locator(".display-preview-body").evaluate(el => getComputedStyle(el).color);
  await slider(page, "brightness", 75); await slider(page, "contrast", 125);
  assert.notEqual(await page.locator(".display-preview-body").evaluate(el => getComputedStyle(el).color), originalColor);
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).filter), "none");
  await page.screenshot({ path: join(artifacts, "adjusted.png"), fullPage: true });
  await page.reload(); await page.locator("#display-fontScale").waitFor();
  near(await fontSize(), 21);
  assert.equal(await page.locator("#display-brightness").inputValue(), "75");
  const sibling = await context.newPage(); await sibling.goto(app.origin + "/display.html");
  await sibling.locator("#display-fontScale").waitFor();
  await slider(page, "fontScale", 140);
  await sibling.waitForFunction(() => (document.querySelector("#display-fontScale") as HTMLInputElement)?.value === "140");
  await sibling.close();
  assert.equal(await wheel(page, {}), false);
  assert.equal(await page.locator("#display-fontScale").inputValue(), "140");
  // Observe actual animation frames and persistence rather than only final scale.
  const samples = await page.evaluate(async () => {
    const original = Storage.prototype.setItem;
    let writes = 0;
    Storage.prototype.setItem = function(key, value) { if (key === "axiom.display.v1") writes++; original.call(this, key, value); };
    const samples: number[] = [], times: number[] = [];
    document.body.dispatchEvent(new WheelEvent("wheel", { ctrlKey: true, deltaY: -100, bubbles: true, cancelable: true }));
    for (let i = 0; i < 30; i++) {
      times.push(await new Promise<number>(requestAnimationFrame));
      samples.push(Number(document.documentElement.style.getPropertyValue("--display-font-scale")) * 100);
    }
    Storage.prototype.setItem = original;
    return { samples, writes, intervals: times.slice(1).map((time, i) => time - times[i]) };
  });
  assert.ok(new Set(samples.samples).size > 5, "wheel must have intermediate frames, not 5% jumps");
  assert.ok(samples.samples.every((value, i, list) => i === 0 || value >= list[i - 1]), "wheel progression is monotonic");
  assert.ok(samples.writes <= 2, `wheel writes storage ${samples.writes} times`);
  await scaleReached(page, 145);
  assert.equal(await wheel(page, { metaKey: true }, -1), true);
  await scaleReached(page, 145.05); // Tiny touchpad deltas must not be discarded.
  assert.equal(await wheel(page, { metaKey: true }, 1), true);
  await scaleReached(page, 145);
  await page.mouse.move(1100, 600);
  await page.keyboard.down("Control"); await page.mouse.wheel(0, -120); await page.keyboard.up("Control");
  await scaleReached(page, 151);
  await page.keyboard.press("Meta+0"); await scaleReached(page, 100);
  await page.locator(".font-scale-feedback").waitFor({ state: "hidden" });
  // Drag the real controls at a scrolled, narrow viewport: their geometry and
  // page scroll position must stay fixed while preview typography changes.
  await page.setViewportSize({ width: 390, height: 550 });
  for (const name of ["fontScale", "brightness", "contrast"]) {
    const control = page.locator(`#display-${name}`);
    await slider(page, name, 100);
    await control.scrollIntoViewIfNeeded();
    const box = (await control.boundingBox())!;
    const scrollTop = await page.locator('.display-main').evaluate(el => el.scrollTop);
    const minimum = Number(await control.getAttribute('min')), maximum = Number(await control.getAttribute('max'));
    let fraction = (100 - minimum) / (maximum - minimum);
    // Start on the current thumb, hold without moving, then drag both ways
    // without another mouse down. A track click alone cannot satisfy this check.
    await page.mouse.move(box.x + 8 + (box.width - 16) * fraction, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(700);
    assert.ok(Math.abs(Number(await control.inputValue()) - 100) <= 1, `${name} holding the thumb does not change its value`);
    for (const target of [.9, .1]) {
      const start = fraction, dragValues = [Number(await control.inputValue())];
      for (let step = 1; step <= 12; step++) {
        fraction = start + (target - start) * step / 12;
        await page.mouse.move(box.x + 8 + (box.width - 16) * fraction, box.y + box.height / 2 + (step > 6 ? 30 : 0));
        assert.ok(await control.evaluate(el => document.activeElement === el), `${name} retains focus while held`);
        dragValues.push(Number(await control.inputValue()));
        const current = (await control.boundingBox())!;
        near(current.x, box.x); near(current.y, box.y); near(current.width, box.width);
        near(await page.locator('.display-main').evaluate(el => el.scrollTop), scrollTop);
      }
      assert.ok(new Set(dragValues).size >= 10, `${name} updates continuously during held drag toward ${target}`);
      const direction = Math.sign(target - start), expectedStep = (maximum - minimum) * Math.abs(target - start) / 12;
      assert.ok(dragValues.every((value, i) => i === 0 || (value - dragValues[i - 1]) * direction >= 0), `${name} follows the drag direction`);
      assert.ok(dragValues.every((value, i) => i === 0 || Math.abs(value - dragValues[i - 1]) <= expectedStep + 1), `${name} follows equal mouse movements without jumps`);
      await page.waitForTimeout(300);
    }
    await page.mouse.up();
    const releasedValue = await control.inputValue();
    await page.mouse.move(box.x + box.width - 8, box.y + box.height / 2);
    assert.equal(await control.inputValue(), releasedValue, `${name} stops dragging on release`);
  }
  if (process.platform === 'darwin' && process.env.AXIOM_TEST_SKIP_WEBKIT !== '1') {
    const native = await promisify(execFile)('swift', [resolve('tests/webkit-display-probe.swift'), app.origin + '/display.html'], { timeout: 60_000 });
    console.log(native.stdout);
  }
  await slider(page, 'fontScale', 200);
  const scrollport = page.locator('.display-preview-viewport');
  await scrollport.scrollIntoViewIfNeeded();
  await scrollport.evaluate(el => { el.scrollTop = 0; });
  const scrollBox = (await scrollport.boundingBox())!;
  const outerScroll = await page.locator('.display-main').evaluate(el => el.scrollTop);
  // App-wide CSS hides native scrollbar chrome. Exercise the actual scroll
  // affordance, including overscroll at the end, rather than an invisible thumb.
  await page.mouse.move(scrollBox.x + scrollBox.width / 2, scrollBox.y + scrollBox.height / 2);
  const scrollSamples: number[] = [];
  for (let step = 1; step <= 10; step++) {
    await page.mouse.wheel(0, 80);
    await scrollport.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    scrollSamples.push(await scrollport.evaluate(el => el.scrollTop));
    near(await page.locator('.display-main').evaluate(el => el.scrollTop), outerScroll);
  }
  assert.ok(scrollSamples.at(-1)! > 50, 'native wheel scrolls preview content');
  assert.ok(scrollSamples.every((value, i) => i === 0 || value >= scrollSamples[i - 1]), 'preview scrolling must not jump backwards');
  await slider(page, 'brightness', 75); await slider(page, 'contrast', 125);
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const value of [50, 137.5, 200]) {
      await slider(page, "fontScale", value); near(await fontSize(), 14 * value / 100);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `fits ${width}px at ${value}%`);
      const overflow = await page.locator(".display-settings").evaluate(node => Array.from(node.querySelectorAll<HTMLElement>("label,output,button,p")).filter(element => element.scrollWidth > element.clientWidth + 1).map(element => element.textContent));
      assert.deepEqual(overflow, [], `${width}/${value} text clipping`);
      assert.ok(await page.locator('.display-font .select-trigger').evaluate(el => {
        const label = el.querySelector<HTMLElement>('span')!;
        return label.scrollWidth <= label.clientWidth + 1;
      }), `${width}/${value} font selection remains readable`);
      assert.ok(await page.locator('.topnav strong').evaluate(el => el.getBoundingClientRect().height <= parseFloat(getComputedStyle(el).lineHeight) * 1.5), `${width}/${value} breadcrumb stays on one line`);
      await page.getByRole("button", { name: "恢复默认", exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(artifacts, `${width}-${value}.png`), fullPage: true });
    }
  }
  await page.getByRole("button", { name: "恢复默认", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("combobox", { name: "字体", exact: true }).click();
  await page.getByRole("option", { name: "衬线字体", exact: true }).click();
  assert.match(await page.locator(".display-preview-body").evaluate(el => getComputedStyle(el).fontFamily), /Songti/);
  await slider(page, "fontScale", 200);
  const project = join(root, "project"); mkdirSync(project);
  const workspace = app.store.execute({ requestId: crypto.randomUUID(), op: "workspace.open", params: { path: project, authorized: true } }) as Workspace;
  const session = app.store.execute({ requestId: crypto.randomUUID(), op: "session.create", workspaceId: workspace.id, params: {} }) as Session;
  await page.evaluate(scope => sessionStorage.setItem("view", JSON.stringify(scope)), { workspaceId: workspace.id, sessionId: session.id });
  await page.goto(app.origin + "/"); await page.locator(".composer textarea").waitFor();
  await page.locator(".composer textarea").fill("字号与间距同步调整\n第二行输入，检查高度和镜像\n第三行");
  near(await page.locator(".composer textarea").evaluate(el => parseFloat(getComputedStyle(el).fontSize)), 32);
  assert.ok(await page.locator(".composer textarea").evaluate(el => el.clientHeight >= parseFloat(getComputedStyle(el).lineHeight) * 3), "composer accommodates three scaled lines");
  await page.screenshot({ path: join(artifacts, "workbench-200.png"), fullPage: true });
  for (const width of [320, 390, 700, 920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator('.composer textarea').fill(`${'一二三四五六七八'.repeat(width <= 640 ? 4 : 1)}\n第二行\n第三行`);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const bounds = await page.locator('.composer').evaluate(composer => {
      const input = composer.querySelector('textarea')!, style = getComputedStyle(input);
      const canvas = document.createElement('canvas'), context = canvas.getContext('2d')!;
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const mobile = !!composer.closest('.mobile-workbench,.android-workbench');
      const textFits = input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) >= context.measureText('一二三四五六七八').width;
      input.scrollLeft = 1000; input.scrollTop = 1000;
      const horizontalScroll = input.scrollLeft > 0, verticalScroll = input.scrollTop > 0;
      input.scrollLeft = 0; input.scrollTop = 0;
      const controls = [input, ...composer.querySelectorAll<HTMLElement>('#attach,.model-picker > summary,.send')].map(el => el.getBoundingClientRect());
      const box = composer.getBoundingClientRect();
      return {
        textAccessible: mobile ? horizontalScroll && style.whiteSpace === 'pre' : textFits,
        linesAccessible: mobile ? verticalScroll : input.clientHeight >= parseFloat(style.lineHeight) * 3,
        mobileSizing: !mobile || (input.clientHeight === 40 && parseFloat(style.fontSize) === 14 && parseFloat(style.lineHeight) === 22),
        contained: controls.every(r => r.left >= box.left - 1 && r.right <= box.right + 1 && r.top >= box.top - 1 && r.bottom <= box.bottom + 1),
        overlaps: controls.some((a, i) => controls.slice(i + 1).some(b => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1)),
      };
    });
    assert.deepEqual(bounds, { textAccessible: true, linesAccessible: true, mobileSizing: true, contained: true, overlaps: false }, `${width}px composer at 200%`);
    if (width <= 640) {
      await page.locator('.composer .model-picker > summary').click();
      const menu = page.locator('.model-popover[data-floating]');
      await menu.waitFor({ state: 'visible' });
      near(await menu.evaluate(el => Number(getComputedStyle(el).getPropertyValue('--display-font-scale'))), 2);
      await page.keyboard.press('Escape');
      await menu.waitFor({ state: 'hidden' });
    }
    await page.screenshot({ path: join(artifacts, `workbench-${width}-200.png`), fullPage: true });
  }
  await page.keyboard.press("Control+0"); await scaleReached(page, 100);
  // Compare to direct native font/color values at the same position and DPR.
  // A scaled bitmap is not an acceptable reference for text clarity.
  for (const dpr of [1, 2]) for (const theme of ["dark", "light"]) {
    const visualContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: dpr, reducedMotion: "reduce" });
    await visualContext.addInitScript(theme => localStorage.setItem("axiom.theme", theme), theme);
    const visual = await visualContext.newPage(); await visual.goto(app.origin + "/display.html");
    await visual.locator("#display-fontScale").waitFor();
    for (const [scale, brightness, contrast] of [[100, 100, 100], [137.5, 40, 50], [200, 200, 200]]) {
      await slider(visual, "fontScale", scale); await slider(visual, "brightness", brightness); await slider(visual, "contrast", contrast);
      const preview = visual.locator(".display-preview");
      const contrastRatio = await preview.evaluate(node => {
        const [bg, ...foregrounds] = [node, ...node.querySelectorAll('p,.display-preview-label')].map((el, i) => {
          const style = getComputedStyle(el), value = i === 0 ? style.backgroundColor : style.color;
          return value.match(/[\d.]+/g)!.slice(0, 3).reduce((sum, channel, i) => {
            const c = Number(channel) / 255;
            return sum + (c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4) * [.2126, .7152, .0722][i];
          }, 0);
        });
        return Math.min(...foregrounds.map(fg => (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05)));
      });
      assert.ok(contrastRatio >= 4.5, `${theme} ${brightness}/${contrast} preview contrast ${contrastRatio}`);
      assert.ok(await preview.evaluate(node => { for (let el: Element | null = node; el; el = el.parentElement) { const style = getComputedStyle(el); if (style.filter !== "none" || style.transform !== "none" || Number(style.zoom) !== 1) return false; } return true; }));
      const before = await preview.screenshot({ path: join(artifacts, `native-${theme}-dpr${dpr}-${scale}.png`) });
      await preview.evaluate(node => {
        for (const el of [node, ...node.querySelectorAll("*")] as HTMLElement[]) {
          el.dataset.savedStyle = el.getAttribute("style") ?? "";
          const style = getComputedStyle(el);
          const values = ["font-family", "font-size", "font-weight", "line-height", "letter-spacing", "color", "background-color"].map(prop => [prop, style.getPropertyValue(prop)]);
          for (const [prop, value] of values) el.style.setProperty(prop, value);
        }
      });
      assert.deepEqual(await preview.screenshot(), before, `native raster reference DPR${dpr} ${scale}/${brightness}/${contrast}`);
      await preview.evaluate(node => { for (const el of [node, ...node.querySelectorAll("*")] as HTMLElement[]) { el.setAttribute("style", el.dataset.savedStyle!); delete el.dataset.savedStyle; } });
    }
    const stable = await visual.locator('.display-preview-secondary').evaluate(el => getComputedStyle(el).color);
    await visual.evaluate(theme => window.dispatchEvent(new CustomEvent('axiom-theme', { detail: theme === 'dark' ? 'light' : 'dark' })), theme);
    await visual.waitForFunction(stable => getComputedStyle(document.querySelector('.display-preview-secondary')!).color !== stable, stable);
    await visual.evaluate(theme => window.dispatchEvent(new CustomEvent('axiom-theme', { detail: theme })), theme);
    await visual.waitForFunction(stable => getComputedStyle(document.querySelector('.display-preview-secondary')!).color === stable, stable);
    await visual.reload(); await visual.locator('#display-fontScale').waitFor();
    assert.equal(await visual.locator('.display-preview-secondary').evaluate(el => getComputedStyle(el).color), stable, 'theme and adjusted colors persist on reload');
    await visualContext.close();
  }
  assert.deepEqual(errors, []);
  console.log(`PASS display: compact independent page, geometry, palette without filters, smooth wheel (${new Set(samples.samples).size} frames/${samples.writes} writes, max frame interval ${Math.max(...samples.intervals).toFixed(1)}ms), persistence, bounds, composer, native text reference DPR1/2. Artifacts: ${artifacts}`);
} finally {
  await browser?.close(); await app?.close();
  if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  rmSync(root, { recursive: true, force: true });
}
