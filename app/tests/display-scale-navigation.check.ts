import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { startServer } from "../src/server/index.js";

const root = mkdtempSync(join(tmpdir(), "axiom-display-navigation-"));
const artifacts = resolve(process.env.AXIOM_TEST_ARTIFACTS || "test-results/display-scale-navigation");
mkdirSync(artifacts, { recursive: true });
const previous = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = join(root, "pi");
let app: Awaited<ReturnType<typeof startServer>> | undefined;
let browser: Browser | undefined;
const near = (actual: number, expected: number, label: string) => assert.ok(Math.abs(actual - expected) < .1, `${label}: ${actual} != ${expected}`);
const evidence: unknown[] = [];
const shell = (page: Page) => page.locator(".settings-app").evaluate(node => {
  const selectors = [".settings-app", ".settings-brand", ".settings-nav[href='/settings.html']", ".back-link", ".topnav strong"];
  return selectors.map(selector => {
    const element = selector === ".settings-app" ? node : node.querySelector(selector)!;
    const style = getComputedStyle(element);
    return { selector, fontSize: parseFloat(style.fontSize), lineHeight: parseFloat(style.lineHeight) };
  });
});
async function slider(page: Page, value: number) {
  await page.locator("#display-fontScale").evaluate((element, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, String(value));
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}
async function stableDrag(page: Page, entryScale: number, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await slider(page, entryScale);
  const control = page.locator("#display-fontScale");
  await control.scrollIntoViewIfNeeded();
  const box = (await control.boundingBox())!;
  const scrollTop = await page.locator(".display-main").evaluate(node => node.scrollTop);
  const fraction = (entryScale - 50) / 150;
  const thumb = await control.evaluate(node => parseFloat(getComputedStyle(node).height));
  const inset = thumb / 2;
  await page.mouse.move(box.x + inset + (box.width - 2 * inset) * fraction, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(150);
  const values: number[] = [];
  for (const target of [.9, .1, .7]) {
    await page.mouse.move(box.x + inset + (box.width - 2 * inset) * target, box.y + box.height / 2, { steps: 12 });
    values.push(Number(await control.inputValue()));
    const current = (await control.boundingBox())!;
    for (const key of ["x", "y", "width", "height"] as const) near(current[key], box[key], `${width}px ${entryScale}% drag ${key}`);
    near(await page.locator(".display-main").evaluate(node => node.scrollTop), scrollTop, "drag preserves page scroll");
    near((await shell(page))[0].fontSize, 15 * entryScale / 100, "editor inherited text stays at entry scale");
    const value = Number(await control.inputValue());
    near(await page.locator(".display-preview-body").evaluate(node => parseFloat(getComputedStyle(node).fontSize)), 14 * value / 100, "preview uses live scale once");
  }
  await page.mouse.up();
  assert.ok(new Set(values).size === 3 && values[0] > values[1] && values[2] > values[1], `native drag updates both ways: ${values}`);
  evidence.push({ entryScale, width, dragValues: values, track: box });
}
try {
  app = await startServer({ root: join(root, "data"), port: 0, dev: true });
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  for (const scale of [120, 50, 137.5, 200]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(scale => {
      if (!localStorage.getItem("axiom.display.v1")) localStorage.setItem("axiom.display.v1", JSON.stringify({ fontScale: scale, brightness: 100, contrast: 100, fontFamily: "default" }));
    }, scale);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(app.origin + "/settings.html");
    await page.locator(".module-row[href='/display.html']").waitFor();
    const expected = await shell(page);
    near(expected[2].fontSize, 13 * scale / 100, "overview applies saved scale");
    await page.locator(".module-row[href='/display.html']").click();
    const compare = async (stage: string) => {
      await page.locator("#display-fontScale").waitFor();
      await page.screenshot({ path: join(artifacts, `${scale}-${stage}.png`), fullPage: true });
      const actual = await shell(page);
      evidence.push({ scale, stage, expected, actual });
      for (let i = 0; i < actual.length; i++) {
        near(actual[i].fontSize, expected[i].fontSize, `${scale}% ${stage} ${actual[i].selector} font`);
        near(actual[i].lineHeight, expected[i].lineHeight, `${scale}% ${stage} ${actual[i].selector} line height`);
      }
      near(await page.locator(".display-preview-body").evaluate(node => parseFloat(getComputedStyle(node).fontSize)), 14 * scale / 100, "saved preview scale");
      assert.equal(await page.locator("#display-fontScale").inputValue(), String(scale));
    };
    await compare("entry");
    await page.locator(".settings-nav[href='/model-config.html']").click();
    await page.locator(".settings-nav[aria-current='page'][href='/model-config.html']").waitFor();
    const modelShell = await shell(page);
    for (let i = 0; i < modelShell.length; i++) near(modelShell[i].fontSize, expected[i].fontSize, "model shell matches");
    await page.locator(".settings-nav[href='/display.html']").click();
    await compare("return");
    await page.reload();
    await compare("reload");
    const direct = await context.newPage();
    await direct.goto(app.origin + "/display.html");
    await direct.locator("#display-fontScale").waitFor();
    const directShell = await shell(direct);
    for (let i = 0; i < directShell.length; i++) near(directShell[i].fontSize, expected[i].fontSize, "direct entry matches");
    await direct.close();
    if (scale === 120) for (const width of [1440, 390]) await stableDrag(page, scale, width);
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.getByRole("button", { name: "恢复默认", exact: true }).scrollIntoViewIfNeeded();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${scale}% fits ${width}px`);
      const clipped = await page.locator(".display-settings").evaluate(node => [...node.querySelectorAll<HTMLElement>("label,output,button,p")].filter(element => element.checkVisibility() && element.scrollWidth > element.clientWidth + 1).map(element => element.textContent));
      assert.deepEqual(clipped, [], `${scale}% ${width}px clipped visible text`);
      await page.screenshot({ path: join(artifacts, `${scale}-${width}.png`), fullPage: true });
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(`PASS saved display scale across overview/display/models, return/reload/direct entry, live preview, desktop/mobile dragging, 50–200% layout. Artifacts: ${artifacts}`);
} finally {
  writeFileSync(join(artifacts, "measurements.json"), JSON.stringify(evidence, null, 2));
  await browser?.close();
  await app?.close();
  if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  rmSync(root, { recursive: true, force: true });
}
