import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch({channel:'chrome'});
const out = new URL('./',import.meta.url).pathname;
const results=[];
try {
  for(const touch of [true,false]) {
    const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:touch,isMobile:touch,reducedMotion:'reduce'});
    const page=await context.newPage();const errors=[],badResponses=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)badResponses.push({url:r.url(),status:r.status()});});
    await page.goto('http://127.0.0.1:4317/');
    await page.locator('#toggle-history').click();
    await page.locator('.workspace-picker>summary').click();
    for(const width of touch?[320,390,430]:[1440]) {
      await page.setViewportSize({width,height:844});
      const rows=await page.locator('.workspace-row').evaluateAll(nodes=>nodes.map(row=>{
        const rect=n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
        return {row:rect(row),name:rect(row.querySelector('strong')),option:rect(row.querySelector('.workspace-option')),actions:rect(row.querySelector('.workspace-actions')),buttons:[...row.querySelectorAll('.workspace-actions button')].map(rect),noOverflow:row.scrollWidth<=row.clientWidth+1};
      }));
      assert.ok(rows.length>0);
      for(const r of rows){assert.ok(r.noOverflow);assert.ok(r.name.width>0);assert.ok(Math.abs(r.option.y+r.option.height/2-r.actions.y-r.actions.height/2)<=1);assert.equal(r.buttons.length,4);if(touch){assert.equal(r.row.height,44);assert.ok(r.name.right<=r.actions.x+1);assert.ok(r.buttons.every(b=>b.width>=44&&b.height>=44));}}
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await page.screenshot({path:out+`production-${touch?'touch':'mouse'}-${width}.png`});
      results.push({touch,width,rows});
    }
    await page.waitForTimeout(1500);
    assert.deepEqual(errors,[]);assert.deepEqual(badResponses,[]);
    await context.close();
  }
  await writeFile(out+'production-result.json',JSON.stringify({success:true,scope:'Running production at 127.0.0.1:4317, read-only menu and screenshots; no session or workspace mutation',results},null,2));
  console.log('PASS production: touch320/390/430 row44, four direct44px actions, names and controls aligned without overlap/overflow; desktop1440; no page errors or failed HTTP responses.');
} finally {await browser.close();}
