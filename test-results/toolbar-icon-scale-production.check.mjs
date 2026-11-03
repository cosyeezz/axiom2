import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync} from 'node:fs';
import {chromium} from '../app/node_modules/playwright/index.mjs';
const output=new URL('./toolbar-icon-scale-production/',import.meta.url);
mkdirSync(output,{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const results=[];
try {
  for(const width of [1440,390]) for(const scale of [50,100,150,200]) {
    const context=await browser.newContext({viewport:{width,height:900},hasTouch:width===390,reducedMotion:'reduce'});
    const page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await context.addInitScript(scale=>localStorage.setItem('axiom.display.v1',JSON.stringify({fontScale:scale,brightness:100,contrast:100,fontFamily:'default'})),scale);
    await page.goto('http://127.0.0.1:4317/');
    await page.locator('.usage-settings > button > svg').first().waitFor();
    const sizes=await page.locator('.usage-row .action-icon > svg,.usage-settings > button > svg').evaluateAll(nodes=>nodes.map(node=>({width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height,basis:parseFloat(getComputedStyle(node).flexBasis)})));
    assert.equal(sizes.length,9);
    for(const size of sizes) for(const dimension of Object.values(size)) assert.ok(Math.abs(dimension-16*scale/100)<.12,`${width}px ${scale}%: ${dimension}`);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    assert.deepEqual(errors,[]);
    const assets=await page.evaluate(()=>performance.getEntriesByType('resource').filter(r=>r.name.includes('/assets/')).map(r=>new URL(r.name).pathname));
    results.push({width,scale,sizes,errors,assets});
    if(scale===150) await page.locator('.usage').screenshot({path:new URL(`${width}-${scale}.png`,output).pathname});
    await context.close();
  }
  writeFileSync(new URL('result.json',output),JSON.stringify({origin:'http://127.0.0.1:4317',results},null,2));
  console.log('PASS live 4317 built frontend: 9 glyphs × 50/100/150/200% × desktop/touch mobile; no overflow or page errors.');
} finally {await browser.close();}
