// Isolated real AttachmentList + ImagePreview browser check; no backend/model requests.
import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
const artifacts = resolve("test-results/image-preview");
mkdirSync(artifacts, { recursive: true });
const fixture = `
    import React, { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { AttachmentList } from '/chat/Attachments.tsx';
    import { Icons } from '/components.tsx';
    import '/styles/tokens.css'; import '/styles/workbench.css'; import '/styles/chat.css';
    const canvas = document.createElement('canvas'); canvas.width = 1600; canvas.height = 900;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#2e4e64'; ctx.fillRect(0,0,1600,900);
    ctx.fillStyle = '#fff'; ctx.font = '80px sans-serif'; ctx.fillText('Image preview', 80, 150);
    const image = { id:'imag1', name:'pasted-image.png', mimeType:'image/png', data:canvas.toDataURL().split(',')[1] };
    function App() {
      const [other, setOther] = useState(false);
      return React.createElement('section', {className:'composer-area'}, React.createElement(Icons), React.createElement('div', {className:'container'},
        React.createElement(AttachmentList, {scope:{ workspaceId:'w', sessionId:other ? 'other' : 's' }, draft:{text:'hello [imag1]', attachment:null, images:other ? [] : [image], revision:0}, reading:false}),
        React.createElement('textarea', {defaultValue:'hello [imag1]', 'aria-label':'draft'}),
        React.createElement('button', {id:'switch', onClick:()=>setOther(true)}, 'switch')));
    }
    createRoot(document.getElementById('root')).render(React.createElement(App));
  `;
const server = await createServer({ server: { port: 0, hmr: false }, plugins: [{
  name: 'image-preview-fixture',
  resolveId(id) { if (id === '/preview-fixture.tsx') return '\0preview-fixture.tsx'; },
  load(id) { if (id === '\0preview-fixture.tsx') return fixture; },
  configureServer(vite) {
    vite.middlewares.use("/__image_preview", async (_req, res) => {
      const html = await vite.transformIndexHtml("/__image_preview", '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/preview-fixture.tsx"></script></body></html>');
      res.setHeader("Content-Type", "text/html"); res.end(html);
    });
  },
}] });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => { errors.push(e.message); console.error(e.message); });
  await page.goto(`http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}/__image_preview`);
  const trigger = page.getByRole("button", { name: "预览图片：imag1" });
  const modal = page.getByRole("dialog", { name: "图片预览 · imag1" });
  for (const [width, height] of [[390, 844], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    await trigger.click(); await modal.waitFor();
    await page.waitForFunction(() => document.querySelector<HTMLImageElement>('.image-preview img')?.naturalWidth === 1600);
    const box = await modal.boundingBox();
    assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height);
    await modal.getByRole('img').click(); assert.equal(await modal.isVisible(), true);
    await page.screenshot({path:resolve(artifacts, `preview-${width}.png`)});
    await page.keyboard.press('Escape'); await modal.waitFor({state:'detached'});
    assert.equal(await trigger.evaluate((node) => node === document.activeElement), true);
    await trigger.press('Enter'); await modal.waitFor();
    await modal.getByRole('button', {name:'关闭图片预览'}).click(); await modal.waitFor({state:'detached'});
    await trigger.click(); await modal.waitFor(); await page.mouse.click(2,2); await modal.waitFor({state:'detached'});
    assert.equal(await page.getByRole('textbox').inputValue(), 'hello [imag1]');
  }
  await trigger.click(); await modal.waitFor();
  await page.locator('#switch').evaluate((node: HTMLButtonElement) => node.click());
  await modal.waitFor({state:'detached'});
  assert.equal(await trigger.count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS image preview: actual image, label/keyboard open, close/Escape/backdrop, focus restore, draft unchanged, scope change, 390/1440 viewport.');
} finally { await browser.close(); await server.close(); }
