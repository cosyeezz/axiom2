// Uses built client assets and real upload/preview WS commands, no model execution.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { startServer } from "../src/server/index.js";
import type { Workspace, Session } from "../src/shared/protocol.js";
const root = mkdtempSync(join(tmpdir(), 'axiom-preview-product-'));
const project = join(root, 'project'), pi = join(root, 'pi'); mkdirSync(project); mkdirSync(pi);
const previous = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = pi;
const app = await startServer({ root: join(root,'data'), port: 0 });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
try {
  const workspace = app.store.execute({ requestId: randomUUID(), op:'workspace.open', params:{ path:project, authorized:true } }) as Workspace;
  const session = app.store.execute({ requestId:randomUUID(), op:'session.create', workspaceId:workspace.id }) as Session;
  const scope = { workspaceId:workspace.id, sessionId:session.id };
  const page = await browser.newPage(); const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((scope) => sessionStorage.setItem('view',JSON.stringify(scope)),scope);
  await page.goto(app.origin);
  await page.locator('.connection-status[data-connected="true"]').waitFor();
  assert.equal(await page.getByRole('button', { name: '预览与评论', exact: true }).count(), 0);
  assert.equal(await page.locator('.preview-dialog, .annotation-card, iframe').count(), 0);
  mkdirSync('test-results/remove-preview', { recursive: true });
  for (const width of [390, 820, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: `test-results/remove-preview/workbench-${width}.png` });
  }
  await page.locator('#prompt').fill('before after');
  await page.locator('#prompt').evaluate(async (node: HTMLTextAreaElement) => {
    node.setSelectionRange(7,7);
    const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 600;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#527583'; ctx.fillRect(0,0,800,600);
    const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!),'image/png'));
    const data = new DataTransfer(); data.items.add(new File([blob],'product-paste.png',{type:'image/png'}));
    node.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
  });
  const trigger = page.getByRole('button',{name:'预览图片：imag1',exact:true});
  await trigger.waitFor();
  assert.equal(await page.locator('#prompt').inputValue(),'before [imag1]after');
  await trigger.click();
  const modal = page.getByRole('dialog',{name:'图片预览 · imag1'}); await modal.waitFor();
  await page.waitForFunction(() => document.querySelector<HTMLImageElement>('.image-preview img')?.naturalWidth === 800);
  await page.keyboard.press('Escape'); await modal.waitFor({state:'detached'});
  assert.equal(await trigger.evaluate((node) => node === document.activeElement),true);
  assert.equal(await page.locator('#prompt').inputValue(),'before [imag1]after');
  assert.equal(app.store.db.prepare('SELECT count(*) AS n FROM runs').get()!.n,0);
  assert.deepEqual(errors,[]);
  console.log('PASS built product: paste -> real uploaded path -> click label -> real scoped preview bytes -> decoded 800px image -> Escape/focus, no model run.');
} finally {
  await browser.close(); await app.close();
  if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  rmSync(root,{recursive:true,force:true});
}
