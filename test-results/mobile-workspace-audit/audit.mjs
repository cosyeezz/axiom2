import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const out = new URL('./', import.meta.url).pathname;
const browser = await chromium.launch({ channel: 'chrome' });
const results = [];
try {
  for (const touch of [true, false]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: touch, isMobile: touch, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://127.0.0.1:4317/');
    await page.locator('#toggle-history').click();
    await page.locator('.workspace-picker > summary').click();
    for (const width of touch ? [320, 390, 430] : [390, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await page.locator('.workspace-row').first().waitFor();
      const measure = () => page.evaluate(() => {
        const row = document.querySelector('.workspace-row');
        const box = n => {const r = n.getBoundingClientRect(); return { x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom };};
        const option = row.querySelector('.workspace-option');
        const actions = row.querySelector('.workspace-actions');
        const style = getComputedStyle(actions);
        const labels = [...actions.querySelectorAll('button')].map(n => ({ label:n.getAttribute('aria-label'),box:box(n) }));
        return { width:innerWidth, touch:matchMedia('(pointer:coarse)').matches, noPageOverflow:document.documentElement.scrollWidth <= innerWidth, row:box(row),option:box(option),actions:box(actions),style:{position:style.position,width:style.width,transform:style.transform},labels,nameStyle:{whiteSpace:getComputedStyle(row.querySelector('strong')).whiteSpace,textOverflow:getComputedStyle(row.querySelector('strong')).textOverflow} };
      });
      const actual = await measure();
      assert.ok(actual.noPageOverflow);
      if(touch) {
        assert.equal(actual.style.position, 'static');
        assert.ok(actual.actions.y >= actual.option.bottom - 1, 'touch actions are forced to their own row');
        assert.equal(actual.labels.length, 4);
        assert.ok(actual.labels.every(n => n.box.width >= 44 && n.box.height >= 44));
        if(width === 390) {
          // DOM-only control; no workspace/store changes.
          await page.locator('.workspace-row strong').first().evaluate(n => n.textContent = '很长的工作空间名称用于窄屏布局校验');
          const long = await measure();
          assert.equal(long.nameStyle.whiteSpace, 'nowrap');
          assert.equal(long.nameStyle.textOverflow, 'ellipsis');
          actual.longName = long;
          await page.screenshot({path:out+'touch-390-long-name.png'});
        }
      } else assert.equal(actual.style.position, 'absolute');
      await page.screenshot({path:out+`${touch?'touch':'mouse'}-${width}.png`});
      results.push(actual);
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
  await writeFile(out+'results.json',JSON.stringify({success:true,scope:'Read-only running production UI; only menu toggles and temporary DOM label change. No product or persisted data changes.',results},null,2));
  console.log(JSON.stringify(results.map(r=>({width:r.width,touch:r.touch,rowHeight:r.row.height,actionsPosition:r.style.position,actionY:r.actions.y,optionBottom:r.option.bottom,pageOverflow:!r.noPageOverflow})),null,2));
} finally { await browser.close(); }
