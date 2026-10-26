import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "playwright";
import { startServer } from "../src/server/index.js";
import { FileIcon, type FileIconName } from "../src/client/chat/FileIcon.js";
import type { Workspace, Session } from "../src/shared/protocol.js";
import type { AgentViews } from "../src/server/agents/views.js";

const root = mkdtempSync(join(tmpdir(), "axiom-icon-system-"));
const artifacts = resolve("test-results/icon-system"); mkdirSync(artifacts, { recursive: true });
const previous = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = join(root, "pi");
mkdirSync(join(root, "pi")); mkdirSync(join(root, "project"));
const app = await startServer({ root: join(root, "data"), port: 0, dev: true });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
try {
  const workspace = app.store.execute({ requestId: crypto.randomUUID(), op: "workspace.open", params: { path: join(root, "project"), authorized: true } }) as Workspace;
  const session = app.store.execute({ requestId: crypto.randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const scope = { workspaceId: workspace.id, sessionId: session.id };
  const views = (app.agents as unknown as { views: AgentViews }).views;
  views.messageChanged(scope, { id: "u1", role: "user", text: "检查图标、间距与运行状态在整个界面中的一致性。" });
  views.messageChanged(scope, { id: "a1", role: "assistant", text: "图标按可见轮廓对齐，控件保留独立点击区域。\n\n```typescript\nconst state = { running: false };\n```\n\n界面状态应与当前会话保持一致。" });
  views.flush(scope);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage(); const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(scope => sessionStorage.setItem("view", JSON.stringify(scope)), scope);
  await page.goto(app.origin);
  await page.locator('#content .usage .memory-global').waitFor();
  await page.waitForFunction(() => document.querySelector('.connection-status')?.getAttribute('data-connected') === 'true');
  const usage = page.locator('#content .usage');
  const toolbar = await usage.locator('.usage-metric>svg,.usage-settings>button>svg,.memory-todo-toggle>svg').evaluateAll(nodes => nodes.map((node, i) => ({ name: `toolbar-${i}`, svg: node.outerHTML })));
  assert.equal(toolbar.length, 8, "context/memory and cost/duration each share a single entry");
  assert.equal(await usage.locator('[data-od-id="context-capacity"]').count(),1);
  for (const [width, height] of [[1440,900], [1024,768], [820,1180], [600,960], [390,844], [360,800]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(100);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `page fits ${width}`);
    const centers = await usage.locator('.usage-row [data-od-id]>svg').evaluateAll(nodes => nodes.map(node => { const box = node.getBoundingClientRect(); return box.x + box.width / 2; }));
    const gaps = centers.slice(1).map((center, i) => center - centers[i]);
    assert.ok(Math.max(...gaps) - Math.min(...gaps) < 1, `statistics icons are equally spaced at ${width}: ${gaps}`);
    const metricsBox = (await usage.locator('.usage-row').boundingBox())!, toolsBox = (await usage.locator('.usage-settings').boundingBox())!;
    assert.ok(metricsBox.x + metricsBox.width <= toolsBox.x + 1 || metricsBox.y + metricsBox.height <= toolsBox.y + 1, `statistics and session tools do not overlap at ${width}`);
    const controls = usage.locator('.usage-settings>button,.memory-todo-toggle,.usage-metric');
    for (const control of await controls.all()) {
      const box = (await control.boundingBox())!;
      assert.ok(box.width >= 44 && box.height >= 44, `touch target ${await control.getAttribute('aria-label')} at ${width}: ${JSON.stringify(box)}`);
    }
    const sizes = await usage.locator('.usage-metric>svg,.usage-settings>button>svg,.memory-todo-toggle>svg').evaluateAll(nodes => nodes.map(node => ({ w: node.getBoundingClientRect().width, h: node.getBoundingClientRect().height, data: node.classList.contains('data-icon') })));
    assert.ok(sizes.every(size => size.w === (size.data ? 20 : 16) && size.w === size.h), `consistent icon boxes at ${width}`);
    if (width <= 640) {
      assert.equal(await usage.locator('[data-od-id="context-capacity"]').innerText(), '');
      for (const id of ['context-capacity', 'cache-tokens', 'estimated-cost']) {
        const trigger = usage.locator(`[data-od-id="${id}"]`); await trigger.click();
        const dialog = page.locator(id === 'context-capacity' ? '.memory-todo-body' : id === 'estimated-cost' ? '.cost-popover' : '.metric-detail'); await dialog.waitFor();
        if(id === 'estimated-cost') assert.match(await dialog.locator('.cost-session-duration').innerText(), /运行耗时/);
        assert.ok((await dialog.innerText()).trim().length > 20, `${id} has values and scope`);
        const box = (await dialog.boundingBox())!; assert.ok(box.x >= 0 && box.x + box.width <= width + 1, 'metric detail fits mobile');
        await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
        assert.ok(await trigger.evaluate(node => node === document.activeElement), 'Escape restores metric trigger focus');
      }
      await usage.evaluate(node => node.scrollLeft = node.scrollWidth);
      const last = (await usage.locator('.memory-global').boundingBox())!;
      assert.ok(last.x >= 0 && last.x + last.width <= width, "last mobile action remains reachable");
      await usage.evaluate(node => node.scrollLeft = 0);
    }
    await page.screenshot({ path: join(artifacts, `${width}-workbench.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await usage.locator('.memory-global').click();
  await page.locator('.memory-dialog').waitFor();
  await page.screenshot({ path: join(artifacts, 'memory.png') });
  await page.keyboard.press('Escape');
  await usage.locator('.cost-trigger').click();
  await page.locator('.cost-popover').waitFor();
  await page.screenshot({ path: join(artifacts, 'costs.png') });
  await page.keyboard.press('Escape');
  for (const path of ['/settings.html', '/model-config.html', '/tools.html', '/connect.html']) {
    await page.goto(app.origin + path); await page.locator('#root').waitFor();
    await page.waitForTimeout(200);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${path} page fits`);
    await page.screenshot({ path: join(artifacts, path.slice(1).replace('.html','.png')) });
  }
  assert.deepEqual(errors, []);

  // Pixel measurement uses actual source glyphs and actual toolbar SVG markup.
  const sprite = readFileSync('src/client/icons.svg', 'utf8');
  const symbols = [...sprite.matchAll(/<symbol id="([^"]+)"/g)].map(([, id]) => ({ name: id, svg: `<svg class="ui-glyph"><use href="#${id}"/></svg>` }));
  const names: FileIconName[] = ['source','split','reading','folder','close','text','image','file','reload','wrap','minus','plus','fit'];
  const icons = [...symbols, ...names.map(name => ({ name: `file-${name}`, svg: renderToStaticMarkup(createElement(FileIcon, { name })) })), ...toolbar];
  const atlas = await browser.newPage({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 3, reducedMotion: 'reduce' });
  await atlas.setContent(`<style>body{margin:0;background:#000;color:#fff;font:12px sans-serif}main{display:grid;grid-template-columns:repeat(8,1fr);gap:16px;padding:24px}.swatch{display:grid;justify-items:center;gap:8px;padding:12px 0}.swatch svg{display:block!important;width:24px!important;height:24px!important;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;color:#fff!important}.swatch span{color:#aaa;font-size:10px}.swatch [fill="currentColor"]{fill:currentColor}.swatch svg:has([data-icon]){stroke:none}</style>${sprite}<main>${icons.map((icon, index) => `<div class="swatch" data-index="${index}">${icon.svg}<span>${icon.name}</span></div>`).join('')}</main>`);
  await atlas.addStyleTag({ content: readFileSync('src/client/styles/icon-geometry.css','utf8') });
  await atlas.addStyleTag({ content: readFileSync('src/client/styles/data-icons.css','utf8') });
  // Shared glyphs retain their measured stroke geometry.
  await atlas.locator('.swatch svg').evaluateAll(nodes => nodes.forEach(node => {
    if (node.getAttribute('data-icon') === 'bi:filetype-raw' || node.getAttribute('viewBox')?.startsWith('354.9')) { (node as SVGSVGElement).style.stroke = 'none'; (node as SVGSVGElement).style.fill = 'currentColor'; }
  }));
  const measurements = [];
  for (let i = 0; i < icons.length; i++) {
    const png = await atlas.locator(`[data-index="${i}"]>svg`).screenshot();
    const extent = await atlas.evaluate(async base64 => {
      const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width=image.width;canvas.height=image.height;
      const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0); const data=ctx.getImageData(0,0,image.width,image.height).data;
      let left=image.width,top=image.height,right=-1,bottom=-1;
      // Count muted empty segments too: their intentional 22% white is ~56/255.
      for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){const k=(y*image.width+x)*4;if(data[k+3]>20&&Math.max(data[k],data[k+1],data[k+2])>20){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}}
      return { longest:Math.max(right-left+1,bottom-top+1)/image.width, centerX:(left+right+1)/2/image.width, centerY:(top+bottom+1)/2/image.height };
    }, png.toString('base64'));
    assert.ok(extent.longest >= (icons[i].svg.includes('data-icon') ? .75 : .88) && extent.longest <= 1, `${icons[i].name} visible size: ${JSON.stringify(extent)}`);
    assert.ok(Math.abs(extent.centerX-.5)<.07 && Math.abs(extent.centerY-.5)<.07, `${icons[i].name} optically centered: ${JSON.stringify(extent)}`);
    measurements.push({ name: icons[i].name, ...extent });
  }
  await atlas.screenshot({ path: join(artifacts, 'icon-atlas.png'), fullPage: true });
  writeFileSync(join(artifacts,'measurements.json'),JSON.stringify(measurements,null,2));
  console.log(`PASS: ${icons.length} rendered glyphs measured; ${toolbar.length} toolbar icons; six viewports; 44px targets; memory/cost panels and five application pages. Artifacts: ${artifacts}`);
} finally {
  await browser.close(); await app.close();
  if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR=previous;
  rmSync(root,{recursive:true,force:true});
}
