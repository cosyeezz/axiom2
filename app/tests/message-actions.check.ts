// Real reply actions and styles, including a late-loaded global disabled rule.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
// Reuse Playwright's PNG decoder; compare actual RGBA pixels, not just CSS opacity.
const { PNG } = createRequire(import.meta.url)(resolve("node_modules/playwright-core/lib/utilsBundle.js"));
import { chromium, webkit } from "playwright";
import { createServer } from "vite";

const output = resolve(process.env.AXIOM_TEST_ARTIFACTS ?? "test-results/message-actions");
mkdirSync(output, { recursive: true });
const virtual = "virtual:message-actions-check";
const fixture = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {CopyReply} from '/chat/CopyReply.tsx';
import {ForkConversation} from '/chat/ForkButton.tsx';
import {Icons} from '/components.tsx';
import {Icon} from '/Icon.tsx';
import '/styles/tokens.css';
import '/styles/message-edit.css';
import '/styles/workbench.css';
import '/styles/chat.css';
await import('/styles/page-overrides.css');
createRoot(document.getElementById('root')).render(<><Icons/>
  <button id="outside">外部焦点</button>
  <div className="log-row" style={{margin:'40px',padding:'20px'}}>
    <div className="reply-body">回复正文</div>
    <ForkConversation.Provider value={{busy:false,fork:async()=>{throw new Error('No fork requests in CSS check')}}}>
      <CopyReply scope={{workspaceId:'fixture',sessionId:'fixture'}} message={{id:'reply',role:'assistant',text:'回复正文'}}/>
    </ForkConversation.Provider>
  </div>
  <div className="log-row" style={{margin:'40px'}}><div className="user-text editable-user-message" tabIndex={0}>用户消息
    <div className="message-actions"><button disabled aria-label="编辑"><Icon name="square-pen"/></button><button disabled className="action-icon fork-action" aria-label="Fork"><Icon name="git-branch"/></button></div>
  </div></div></>);
`;
const server = await createServer({
  configFile: resolve("vite.config.ts"), cacheDir: resolve(output, ".vite"),
  plugins: [{ name: "message-actions-fixture", resolveId(id) { if (id === virtual) return id; },
    async load(id) { if (id === virtual) return (await import("esbuild")).transform(fixture, { loader: "tsx", jsx: "automatic" }); } }],
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
});
await server.listen();
const engine = process.env.AXIOM_TEST_ENGINE === "webkit" ? webkit : chromium;
const browser = await engine.launch(engine === chromium ? { executablePath: process.env.AXIOM_TEST_BROWSER } : {});
const evidence: object[] = [];
try {
  for (const touch of [false, true]) {
    const context = await browser.newContext({ viewport: { width: touch ? 390 : 1200, height: 800 }, hasTouch: touch, reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/message-actions-check", route => route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/${virtual}"></script></body></html>` }));
    await page.goto(server.resolvedUrls!.local[0] + "message-actions-check");
    const row = page.locator(".log-row").first(), actions = page.locator(".reply-actions"), fork = actions.locator(".fork-action");
    const copy = actions.locator(".copy-reply"), outside = page.locator("#outside");
    await fork.waitFor({ state: "attached" });
    assert.ok(await fork.isDisabled(), "disconnected real ForkButton starts disabled");
    let pixelChecks = 0;
    const checkPixels = async (visible: boolean, state: string) => {
      // Include overflowing SVG paint beyond the buttons, not only their boxes.
      const box = (await actions.boundingBox())!;
      const clip = { x: Math.max(0, box.x - 16), y: Math.max(0, box.y - 16), width: box.width + 32, height: box.height + 32 };
      const actual = await page.screenshot({ clip });
      const noGlyphs = await page.addStyleTag({ content: '.reply-actions > button > svg { display: none !important; }' });
      const baseline = await page.screenshot({ clip });
      await noGlyphs.evaluate(node => (node as HTMLStyleElement).remove());
      const a = PNG.sync.read(actual), b = PNG.sync.read(baseline);
      assert.equal(a.width, b.width); assert.equal(a.height, b.height);
      let changedPixels = 0;
      for (let i = 0; i < a.data.length; i += 4) if (!a.data.subarray(i, i + 4).equals(b.data.subarray(i, i + 4))) changedPixels++;
      evidence.push({ touch, state, changedPixels, pixelBaseline: 'SVG display:none' });
      writeFileSync(resolve(output, 'states.json'), JSON.stringify(evidence, null, 2));
      writeFileSync(resolve(output, `${touch ? 'touch' : 'desktop'}-pixels-${pixelChecks++}-${state.replaceAll(' ', '-')}.png`), actual);
      assert.ok(visible ? changedPixels > 0 : changedPixels === 0, `${state}: ${changedPixels} differing pixels against no-glyph baseline`);
    };
    for (const lateDisabledRule of [false, true]) {
      // This global rule exists in workbench.css/models.css. Hidden message controls
      // must win even when shared styles arrive later, not rely on import order.
      if (lateDisabledRule) await page.addStyleTag({ content: "button:disabled { opacity: .4; cursor: not-allowed; }" });
      for (const disabled of [false, true]) {
        await fork.evaluate((button, value) => { (button as HTMLButtonElement).disabled = value; }, disabled);
        const check = async (state: string, visible: boolean) => {
          const values = await actions.locator("button").evaluateAll(buttons => buttons.map(button => ({
            name: button.className, opacity: getComputedStyle(button).opacity,
            pointer: getComputedStyle(button).pointerEvents,
            glyphDisplay: getComputedStyle(button.querySelector('svg')!).display,
            glyphRects: button.querySelector('svg')!.getClientRects().length,
          })));
          evidence.push({ touch, lateDisabledRule, disabled, state, values });
          writeFileSync(resolve(output, "states.json"), JSON.stringify(evidence, null, 2));
          for (const value of values) {
            assert.equal(value.opacity, visible ? "1" : "0", JSON.stringify({ touch, lateDisabledRule, disabled, state, value }));
            assert.equal(value.pointer, visible ? "auto" : "none");
            assert.equal(value.glyphDisplay, visible ? "block" : "none");
            assert.equal(value.glyphRects, visible ? 1 : 0, "hidden SVG has no layout/paint box");
          }
          if (['idle', 'hover', 'leave', 'fork focus', 'feedback reset'].includes(state)) await checkPixels(visible, state);
        };
        await outside.focus(); await page.mouse.move(0, 0);
        await check("idle", touch);
        const before = await row.boundingBox();
        if (!touch) {
          await row.hover(); await check("hover", true);
          await page.mouse.move(0, 0); await check("leave", false);
        } else {
          for (const button of [copy, fork]) {
            const box = (await button.boundingBox())!;
            assert.equal(box.width, 44); assert.equal(box.height, 44);
          }
        }
        await copy.focus(); await check("copy focus", true);
        if (!disabled) {
          // macOS WebKit uses Option-Tab to include buttons in keyboard navigation.
          await page.keyboard.press(engine === webkit ? "Alt+Tab" : "Tab");
          assert.ok(await fork.evaluate(node => document.activeElement === node));
          await check("fork focus", true);
        }
        await outside.focus();
        for (const feedback of ["copied", "failed"]) {
          await actions.evaluate((node, value) => node.setAttribute("data-feedback", value), feedback);
          await check(feedback, true);
        }
        await actions.evaluate(node => node.removeAttribute("data-feedback"));
        await check("feedback reset", touch);
        assert.deepEqual(await row.boundingBox(), before, "visibility does not reflow the reply");
        await page.screenshot({ path: resolve(output, `${touch ? "touch" : "desktop"}-${lateDisabledRule ? "late" : "normal"}-${disabled ? "disabled" : "enabled"}.png`) });
      }
    }
    // More-specific visibility must not override the user-message button geometry.
    const user = page.locator(".editable-user-message");
    await outside.focus(); await page.mouse.move(0, 0);
    for (const button of await user.locator("button").all()) {
      const box = (await button.boundingBox())!;
      assert.equal(box.width, 24); assert.equal(box.height, touch ? 44 : 28);
      if (touch) assert.equal(await button.evaluate(node => getComputedStyle(node).visibility), "hidden");
      else {
        assert.equal(await button.evaluate(node => getComputedStyle(node).opacity), "0");
        assert.equal(await button.locator('svg').evaluate(node => getComputedStyle(node).display), 'none');
      }
    }
    await user.focus();
    for (const button of await user.locator("button").all()) {
      assert.equal(await button.evaluate(node => getComputedStyle(node).opacity), "1");
      assert.equal(await button.evaluate(node => getComputedStyle(node).visibility), "visible");
      assert.equal(await button.locator('svg').evaluate(node => getComputedStyle(node).display), 'block');
    }
    if (!touch) {
      // Exercise actual fades and repainting at fractional CSS scales as well.
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      for (const zoom of [0.8, 1, 1.25]) {
        await page.evaluate(value => { document.body.style.zoom = String(value); }, zoom);
        await copy.focus(); await page.waitForTimeout(250);
        await checkPixels(true, `animated focus zoom${zoom}`);
        await outside.focus(); await page.mouse.move(0, 0);
        assert.equal(await fork.locator('svg').evaluate(node => getComputedStyle(node).display), 'none', 'hide glyph immediately, without waiting for opacity transition');
        await page.waitForTimeout(250);
        await checkPixels(false, `animated blur zoom${zoom}`);
      }
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(`PASS: enabled/disabled fork matches copy for idle, hover, leave, keyboard focus, feedback and reset; SVG excluded from painting while hidden; zero hidden pixel differences vs no-glyph baseline, nonzero visible pixels; both CSS orders; animation and zoom; touch targets; no reflow/page errors. ${output}`);
} finally { await browser.close(); await server.close(); }
