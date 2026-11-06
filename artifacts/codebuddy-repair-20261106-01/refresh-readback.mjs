// Read-only UI verification. No prompt, model selection, resume or app mutation.
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const require = createRequire(resolve('app/package.json')), { chromium } = require('playwright');
const key = process.argv[2]; assert.ok(['glm', 'deepseek'].includes(key));
const out = resolve('artifacts/codebuddy-repair-20261106-01');
const control = JSON.parse(readFileSync(join(out, `${key}-control.json`)));
const report = { model: key === 'glm' ? 'glm-5.3' : 'deepseek-v4.1-flash', noModelRequests: true, passed: false };
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript(s => sessionStorage.setItem('view', JSON.stringify(s)), { workspaceId: 'b64c057e-96ee-435a-a078-a501e8f0d128', sessionId: control.sessionId });
  let forbidden = false;
  page.on('websocket', socket => socket.on('framesent', ({ payload }) => {
    try { const v = JSON.parse(payload); if (['prompt', 'agent.resume', 'agent.model'].includes(v.op)) forbidden = true; } catch {}
  }));
  await page.goto('http://127.0.0.1:4317');
  const recovery = page.locator('article[aria-label="助手回复"]').filter({ hasText: '恢复正常' });
  await recovery.first().waitFor({ timeout: 20000 });
  report.beforeRefreshAssistantCount = await page.locator('article[aria-label="助手回复"]').count();
  await page.reload();
  await recovery.first().waitFor({ timeout: 20000 });
  report.afterRefreshAssistantCount = await page.locator('article[aria-label="助手回复"]').count();
  report.recoveredAnswerVisible = await recovery.first().isVisible();
  report.rememberedCodeVisible = (await recovery.first().innerText()).includes('5832');
  report.sessionSidebarSelected = await page.locator(`.history-row[data-session-id="${control.sessionId}"] [aria-current="true"]`).count() > 0;
  report.modelSelectionVisible = (await page.locator('#model-picker summary').innerText()).toLowerCase().includes(key === 'glm' ? 'glm-5.3' : 'deepseek-v4.1-flash');
  report.noModelRequests = !forbidden;
  assert.ok(report.recoveredAnswerVisible && report.rememberedCodeVisible && report.modelSelectionVisible && !forbidden);
  assert.equal(report.beforeRefreshAssistantCount, report.afterRefreshAssistantCount);
  report.passed = true;
} catch { report.category = 'readback-gate'; process.exitCode = 1; }
finally { await browser.close(); writeFileSync(join(out, `${key}-refresh-readback.json`), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report)); }
