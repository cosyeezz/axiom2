// Real toolbar components and production PostCSS/cascade; no model or user-data access.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, webkit } from "playwright";
import { createServer } from "vite";

const output = resolve(process.env.AXIOM_TEST_ARTIFACTS || "test-results/toolbar-icon-scale");
mkdirSync(output, { recursive: true });
const fixture = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {Usage} from '/chat/Usage.tsx';
import {MemoryToolbar} from '/memory/MemoryToolbar.tsx';
import {Icons} from '/components.tsx';
import {acceptSnapshot} from '/transport.ts';
import {initializeDisplaySettings,setDisplaySettings} from '/display-settings.ts';
import '/styles/tokens.css';
import '/styles/workbench.css';
import '/styles/chat.css';
await import('/styles/page-overrides.css');
initializeDisplaySettings();
const root=createRoot(document.getElementById('root'));
const scope={workspaceId:'fixture',sessionId:'toolbar'};
const workspaces=[{id:'fixture',name:'Toolbar',path:'/fixture',sessions:[]}];
window.setScale=fontScale=>setDisplaySettings({fontScale});
window.show=(variant='desktop')=>{
  flushSync(()=>root.render(<><Icons/><main className={'app '+(variant==='desktop'?'':variant+'-workbench')} style={{display:'block',padding:'12px'}}><MemoryToolbar scope={scope} workspaces={workspaces}>{tools=><Usage scope={scope} tools={tools}/>}</MemoryToolbar></main></>));
  acceptSnapshot({scope:'agent:fixture:toolbar',streamId:'fixture',seq:1,data:{selection:null,environment:null,run:null,usage:{context:{tokens:32000,window:128000,source:'model-usage'},lastRequest:{input:10,cacheRead:90,cacheWrite:0}}}});
};
window.show();`;
const virtual = "virtual:toolbar-icon-scale";
const server = await createServer({
  configFile: resolve("vite.config.ts"), cacheDir: resolve(output, ".vite"),
  plugins: [{ name: "toolbar-scale-fixture", resolveId(id) { if (id === virtual) return id; },
    async load(id) { if (id === virtual) return (await import("esbuild")).transform(fixture, { loader: "tsx", jsx: "automatic" }); } }],
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
});
await server.listen();
const engine = process.env.AXIOM_TEST_ENGINE === "webkit" ? webkit : chromium;
const browser = await engine.launch(engine === chromium ? { executablePath: process.env.AXIOM_TEST_BROWSER } : {});
const evidence: object[] = [];
const near = (actual: number, expected: number, label: string) => assert.ok(Math.abs(actual - expected) < .12, `${label}: ${actual} != ${expected}`);
try {
  for (const touch of [false, true]) {
    const context = await browser.newContext({ viewport: { width: touch ? 390 : 1440, height: 900 }, hasTouch: touch, reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/toolbar-scale-check", route => route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/${virtual}"></script></body></html>` }));
    await page.goto(server.resolvedUrls!.local[0] + "toolbar-scale-check");
    await page.locator(".usage-settings > button > svg").first().waitFor();
    for (const variant of ["desktop", "mobile", "android"]) {
      await page.evaluate(variant => (window as any).show(variant), variant);
      for (const scale of [50, 75, 100, 125, 137.5, 150, 200]) {
        await page.evaluate(scale => (window as any).setScale(scale), scale);
        const rows = await page.locator('.usage-row .action-icon, .usage-settings > button').evaluateAll(buttons => buttons.map(button => {
          const svg = button.querySelector("svg")!, b = button.getBoundingClientRect(), g = svg.getBoundingClientRect();
          return { label: button.getAttribute("aria-label"), group: button.parentElement!.className,
            width: g.width, height: g.height, basis: parseFloat(getComputedStyle(svg).flexBasis),
            buttonWidth: b.width, buttonHeight: b.height, centeredX: Math.abs((g.left + g.right) / 2 - (b.left + b.right) / 2),
            centeredY: Math.abs((g.top + g.bottom) / 2 - (b.top + b.bottom) / 2) };
        }));
        evidence.push({ touch, variant, scale, rows });
        writeFileSync(resolve(output, "measurements.json"), JSON.stringify(evidence, null, 2));
        if ([75, 100, 150, 200].includes(scale)) await page.locator(".usage").screenshot({ path: resolve(output, `${touch ? 'touch' : 'mouse'}-${variant}-${scale}.png`) });
        assert.equal(rows.length, 9, "four statistics and five tools are all covered");
        for (const row of rows) {
          near(row.width, 16 * scale / 100, `${variant} ${scale}% ${row.label} width`);
          near(row.height, row.width, `${row.label} square`);
          near(row.basis, row.width, `${row.label} flex basis`);
          assert.ok(row.buttonWidth >= row.width && row.buttonHeight >= row.height, `${row.label} fits hit target`);
          near(row.centeredX, 0, `${row.label} horizontally centered`);
          near(row.centeredY, 0, `${row.label} vertically centered`);
        }
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "narrow toolbar scrolls internally, not the page");
        const bar = page.locator(".usage");
        await bar.evaluate(node => { node.scrollLeft = node.scrollWidth; });
        const last = page.locator(".usage-settings > button").last();
        assert.ok(await last.evaluate(node => { const b=node.getBoundingClientRect(), p=node.closest('.usage')!.getBoundingClientRect(); return b.right <= p.right + 1; }), "last control remains reachable by scrolling");
        await bar.evaluate(node => { node.scrollLeft = 0; });
      }
    }
    // A portalled detail owns its geometry and must not inherit the toolbar token.
    await page.evaluate(() => (window as any).setScale(150));
    await page.locator('[data-od-id="cache-tokens"]').click();
    const close = page.locator('.toolbar-detail-panel header > .icon-btn > svg');
    await close.waitFor();
    near(await close.evaluate(node => node.getBoundingClientRect().width), 24, "detail close keeps its own scaled size");
    await page.keyboard.press("Escape");
    await page.locator(".toolbar-detail-panel").waitFor({ state: "detached" });
    // Live wheel scaling and reload use exactly the same token as direct settings.
    await page.evaluate(() => document.body.dispatchEvent(new WheelEvent("wheel", { ctrlKey: true, deltaY: -100, bubbles: true, cancelable: true })));
    await page.waitForFunction(() => Number(document.documentElement.style.getPropertyValue("--display-font-scale")) === 1.55);
    near(await page.locator('.usage-settings > button > svg').first().evaluate(node => node.getBoundingClientRect().width), 24.8, "live wheel tool scale");
    await page.reload();
    await page.locator(".usage-settings > button > svg").first().waitFor();
    near(await page.locator('.usage-row .action-icon > svg').first().evaluate(node => node.getBoundingClientRect().width), 24.8, "saved scale after reload");
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(`PASS: all 9 toolbar glyphs scale together at 50–200%, desktop/mobile/Android, mouse/touch, wheel/reload, internal scrolling and portalled detail. Evidence: ${output}`);
} finally { await browser.close(); await server.close(); }
