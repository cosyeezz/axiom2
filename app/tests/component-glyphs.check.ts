// Static in-memory fixture: never connects to a maintenance executor.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { build } from "vite";
import { chromium } from "playwright";
import glyphs from "../src/client/maintenance/component-glyphs.json" with { type: "json" };
import { assertComponentPalette, assertComponentTree, ensureComponentActions } from "./component-layout-helpers.js";

const root = mkdtempSync(join(tmpdir(), "axiom-component-glyphs-"));
const artifacts = resolve(process.env.AXIOM_TEST_ARTIFACTS ?? "test-results/component-glyphs");
mkdirSync(artifacts, { recursive: true });
const expected = {
  component: ["C-25", "lucide:blocks"], environment: ["E-03", "iconmind:dependency-outline-regular"],
  check: ["Q-47", "mingcute:refresh-2-line"], install: ["I-33", "tabler:download"],
  update: ["U-04", "keyline-icons:package-arrow-up"], reinstall: ["R-02", "mdi:box-refresh-outline"],
  uninstall: ["X-24", "lucide:trash"],
  "cleanup-package": ["P-02", "lucide:package-x"], "download-package": ["D-23", "hugeicons:package-receive-01"],
  "install-cached": ["K-01", "lucide:package-check"], "open-installer": ["O-26", "ri:share-box-line"],
  "switch-version": ["V-02", "ri:swap-box-line"], repair: ["F-46", "heroicons:wrench-screwdriver"],
};
const catalog = [...JSON.parse(readFileSync(resolve("../docs/component-icon-options.json"), "utf8")).groups.flatMap((g: { items: { code: string; id: string; sha256: string }[] }) => g.items), ...JSON.parse(readFileSync(resolve("../docs/component-action-icon-selections.json"), "utf8")).selections];
for (const [name, [code, id]] of Object.entries(expected)) {
  const glyph = glyphs[name as keyof typeof glyphs];
  assert.equal(glyph.code, code); assert.equal(glyph.id, id);
  assert.equal(glyph.sha256, catalog.find((item: { code: string }) => item.code === code)?.sha256);
  assert.doesNotMatch(glyph.body, /<(script|foreignObject|image|animate|set)\b|\bon\w+\s*=|(?:href|src)\s*=/i);
  const box = glyph.viewBox.split(" ").map(Number);
  assert.equal(box.length, 4); assert.ok(box.every(Number.isFinite)); assert.equal(box[2], box[3], "square viewport, no axis stretch");
}
await build({ configFile: false, root: resolve("src/client"), logLevel: "warn", define: { "process.env.NODE_ENV": '"production"' }, build: { outDir: root, emptyOutDir: true, target: "safari15", minify: false, lib: { entry: resolve("tests/fixtures/component-glyphs.tsx"), name: "ComponentGlyphFixture", formats: ["iife"], fileName: "fixture" } } });
const files = readdirSync(root), js = files.find(f => f.endsWith(".js"))!, css = files.find(f => f.endsWith(".css"))!;
const bundle = readFileSync(join(root, js), "utf8");
for (const notice of ["IconMind", "Cole Bemis", "Paweł Kuna", "Keyline Icons", "Colton Wiscombe", "Apache License", "Modification notice", "2025 Hugeicons", "Tailwind Labs, Inc.", "Remix Design", "P-02", "F-46"]) assert.ok(bundle.includes(notice), `distributed notice: ${notice}`);
writeFileSync(join(root, "index.html"), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/${css}"></head><body><div id="root"></div><script src="/${js}"></script></body></html>`);
const server = createServer((req, res) => {
  const file = req.url === "/" ? "index.html" : basename(new URL(req.url!, "http://fixture").pathname);
  if (![...files, "index.html"].includes(file)) { res.writeHead(404).end(); return; }
  res.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html; charset=utf-8");
  res.end(readFileSync(join(root, file)));
});
await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
const fixtureOrigin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const errors: string[] = [], remote: string[] = [];
const guardRequests = async (route: import("playwright").Route) => {
  if (route.request().url().startsWith(`${fixtureOrigin}/`)) await route.continue();
  else { remote.push(route.request().url()); await route.abort("blockedbyclient"); }
};
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 780 }, reducedMotion: "reduce", serviceWorkers: "block" });
  await page.route("**/*", guardRequests);
  page.on("pageerror", e => errors.push(e.message)); page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  page.on("request", req => { if (!req.url().startsWith(`${fixtureOrigin}/`)) remote.push(req.url()); });
  await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}/`);
  const card = page.getByRole("region", { name: "示例组件维护", exact: true });
  const added = page.getByRole("region", { name: "补充动作维护", exact: true });
  await card.getByRole("heading", { name: "示例组件", exact: true }).waitFor();
  const environmentHeading = card.locator(":scope > .component-environment > .component-environment-heading");
  assert.equal(await environmentHeading.textContent(), "环境");
  assert.equal(await environmentHeading.locator("svg").count(), 1);
  for (const [name, [,id]] of Object.entries(expected)) {
    const owner = ["cleanup-package", "download-package", "install-cached", "open-installer", "switch-version", "repair"].includes(name) ? added : card;
    const glyph = owner.locator(`:scope > .maintenance-panel-heading [data-component-glyph="${name}"], :scope > .component-environment > .component-environment-heading [data-component-glyph="${name}"]`);
    assert.equal(await glyph.count(), 1); assert.equal(await glyph.getAttribute("data-icon-source"), id);
    assert.equal(await glyph.getAttribute("aria-hidden"), "true");
    assert.equal(await glyph.getAttribute("focusable"), "false");
  }
  await ensureComponentActions(card); await ensureComponentActions(added);
  const kinds = { environment: "square-terminal", skill: "book-open-check", mcp: "tool-tool", dependency: "package" };
  for (const [kind, symbol] of Object.entries(kinds)) {
    const icon = card.locator(`.component-kind-glyph[data-component-kind="${kind}"]`);
    assert.equal(await icon.count(), 1); assert.equal(await icon.isVisible(), true);
    assert.equal(await icon.locator("use").getAttribute("href"), `#i-${symbol}`);
    assert.ok(await icon.evaluate(node => { const box = (node as SVGSVGElement).getBBox(); return box.width > 0 && box.height > 0; }), "each semantic type references nonempty local geometry");
    assert.match((await icon.locator("metadata").textContent())!, /Permission to use/);
  }
  const metrics = await page.locator('section[aria-label="示例组件维护"] .component-glyph, section[aria-label="补充动作维护"] .component-action .component-glyph').evaluateAll(async nodes => {
    const output = [];
    for (const node of nodes) {
      const svg = node as SVGSVGElement;
      const style = getComputedStyle(svg), clone = svg.cloneNode(true) as SVGSVGElement;
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg"); clone.setAttribute("width", "1024"); clone.setAttribute("height", "1024");
      clone.style.color = "#000"; clone.style.strokeWidth = style.strokeWidth;
      const image = new Image(); image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(clone.outerHTML); await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1024;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!; ctx.drawImage(image, 0, 0);
      const data = ctx.getImageData(0,0,1024,1024).data;
      let minX=1024,minY=1024,maxX=-1,maxY=-1,area=0;
      for(let y=0;y<1024;y++) for(let x=0;x<1024;x++) {
        const alpha=data[(y*1024+x)*4+3]; area+=alpha/255;
        if(alpha>2) {minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
      }
      output.push({ name: svg.dataset.componentGlyph!, slot: [parseFloat(style.width),parseFloat(style.height)], typeSlot: !!svg.closest(".maintenance-resource-icon"), bounds: [minX,minY,maxX+1,maxY+1].map(n=>n/64), paintArea: area/(64*64) });
    }
    return output;
  });
  assert.equal(metrics.length, 13, "all seven original and six new selected shapes are actually measured");
  for (const m of metrics) {
    // The type slot is 26px and spans the name/path rows; action glyphs scale from the 14px name font (about 16px).
    assert.ok(m.slot[0] === m.slot[1] && (m.typeSlot ? m.slot[0] === 26 : m.slot[0] >= 15.5 && m.slot[0] <= 16.5), `${m.name}: square slot for its role ${JSON.stringify(m)}`);
    const [x,y,right,bottom] = m.bounds, longest=Math.max(right-x,bottom-y);
    assert.ok(longest>=14 && longest<=15.4, `${m.name}: visible size ${longest}, not nominal CSS size`);
    assert.ok(Math.min(x,y,16-right,16-bottom)>.25, `${m.name}: no clipped painted edge`);
    assert.ok(Math.abs((x+right)/2-8)<.04 && Math.abs((y+bottom)/2-8)<.04, `${m.name}: centered visible bounds`);
    assert.ok(m.paintArea>45 && m.paintArea<100, `${m.name}: nonempty, no inherited fill/stroke pollution`);
  }
  const ownMetadata = card.locator(":scope > .maintenance-panel-heading metadata");
  assert.equal(await ownMetadata.count(),1);
  assert.match((await ownMetadata.textContent())!, /2013-present Cole Bemis/);
  const compatible = page.getByRole("region", { name: "兼容动作维护", exact: true });
  await ensureComponentActions(compatible);
  assert.equal(await compatible.getByRole("button", { name: "安装已下载包", exact: true }).locator('[data-component-glyph="install"]').count(),1);
  assert.equal(await compatible.getByRole("button", { name: "检查安装", exact: true }).locator('use[href="#i-scan"]').count(),1);
  assert.equal(await compatible.getByRole("button", { name: "查看安装包", exact: true }).locator('use[href="#i-folder-open"]').count(),1);
  const check = card.getByRole("button", { name: "检查更新", exact: true });
  await check.hover(); await page.getByRole("tooltip", { name: "检查更新", exact: true }).waitFor(); await page.keyboard.press("Escape");
  await check.focus(); assert.notEqual(await check.evaluate(n=>getComputedStyle(n).outlineStyle),"none");
  await page.keyboard.press("Enter"); assert.equal(await page.getByLabel("模拟检查次数").innerText(),"1");
  const unavailable = compatible.getByRole("button", { name: "不可用安装", exact: true, includeHidden: true });
  assert.equal(await unavailable.getAttribute("aria-disabled"), "true");
  assert.equal(await unavailable.isVisible(), true, "temporary blockers stay discoverable");
  assert.equal(await unavailable.getAttribute("disabled"), null, "temporary blockers stay keyboard-focusable");
  const reasonId = await unavailable.getAttribute("aria-describedby"); assert.ok(reasonId);
  const unavailableReason = compatible.locator(`[id=${JSON.stringify(reasonId)}]`);
  assert.equal(await unavailableReason.count(), 1, "blocked button describes its own reason, independently of DOM nesting");
  await unavailable.focus(); await page.keyboard.press("Enter");
  await unavailableReason.waitFor({ state: "visible" });
  assert.equal(await page.getByLabel("阻塞误提交次数").innerText(), "0");
  await page.keyboard.press("Escape");
  assert.equal(await unavailableReason.isHidden(), true);
  for(const theme of ["light","dark"]) for(const width of [1200,390,320]) {
    await page.setViewportSize({width,height:780}); await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await assertComponentTree(card); await assertComponentTree(added);
    await assertComponentPalette(card); await assertComponentPalette(added);
    if (width === 1200) {
      await ensureComponentActions(compatible);
      assert.notEqual(await unavailable.evaluate(n => getComputedStyle(n).display), "none", "blocked actions retain their layout slot");
      assert.equal(await unavailable.evaluate(n => getComputedStyle(n).opacity), "0.5", "blocked actions do not light up on hover");
    }
    await page.screenshot({path:join(artifacts,`${theme}-${width}.png`),fullPage:true});
  }
  const touch = await browser.newPage({ viewport: { width: 320, height: 780 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  await touch.route("**/*", guardRequests);
  await touch.goto(page.url());
  await ensureComponentActions(touch.getByRole("region", { name: "示例组件维护", exact: true }));
  await ensureComponentActions(touch.getByRole("region", { name: "兼容动作维护", exact: true }));
  const touchVisible = await touch.locator(".component-action:visible").count();
  assert.ok(touchVisible >= 15, `touch shows supported actions and temporary blockers (${touchVisible})`);
  const touchBlocked = touch.getByRole("button", { name: "不可用安装", exact: true });
  const blockedBox = await touchBlocked.boundingBox(); assert.ok(blockedBox);
  await touch.touchscreen.tap(blockedBox.x + blockedBox.width / 2, blockedBox.y + blockedBox.height / 2);
  const touchReasonId = await touchBlocked.getAttribute("aria-describedby"); assert.ok(touchReasonId);
  await touch.locator(`[id=${JSON.stringify(touchReasonId)}]`).waitFor({ state: "visible" });
  assert.equal(await touch.getByLabel("阻塞误提交次数").innerText(), "0");
  assert.ok(await touch.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "touch blocker explanation fits the viewport");
  // Touch keeps glyph-only actions at their visible size; an invisible ::before supplies a >=24px (WCAG 2.5.8) hit area.
  for(const hit of await touch.locator(".component-action:visible").evaluateAll(nodes=>nodes.map(n=>{const box=n.getBoundingClientRect(),before=getComputedStyle(n,"::before");return {width:box.width-2*parseFloat(before.left),height:box.height-2*parseFloat(before.top)};}))) assert.ok(hit.width>=24 && hit.height>=24, `touch hit area ${JSON.stringify(hit)}`);
  assert.equal(await touch.locator(".component-action-label:visible").count(), 0, "touch actions stay glyph-only");
  await touch.screenshot({path:join(artifacts,"touch-320.png"),fullPage:true}); await touch.close();
  assert.deepEqual(errors,[]); assert.deepEqual(remote,[]);
  writeFileSync(join(artifacts,"result.json"),JSON.stringify({ok:true,metrics,errors,remote,themes:["light","dark"],widths:[1200,390,320],touch:true,systemPalette:true},null,2));
  console.log("PASS: thirteen selected glyphs, group title reference size, painted bounds, slots, sources and bundled licenses, labels, keyboard, disabled state, deep/light responsive layout and touch targets");
} finally {
  await browser.close(); await new Promise<void>((done,reject)=>server.close(e=>e?reject(e):done())); rmSync(root,{recursive:true,force:true});
}
