import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { chromium } from '/Volumes/D_Work/axiom2/app/node_modules/playwright/index.mjs';
import { startServer } from '/Volumes/D_Work/axiom2/app/src/server/index.ts';
import { atomicRtkJson, rtkConfigPath, rtkDirectory } from '/Volumes/D_Work/axiom2/app/src/server/integrations/rtk-config.ts';
import { recordRtkEvent } from '/Volumes/D_Work/axiom2/app/src/server/integrations/rtk-stats.ts';
const out='/tmp/axiom-rtk-ui-final-close', root=join(out,'root-'+randomUUID());
mkdirSync(root,{recursive:true});
const directory='v1.0.1-'+randomUUID(), exe=join(rtkDirectory(root),'versions',directory,'rtk');
mkdirSync(join(rtkDirectory(root),'versions',directory),{recursive:true});
writeFileSync(exe,'placeholder - never execute\n',{mode:0o600});
atomicRtkJson(rtkConfigPath(root),{format:1,revision:randomUUID(),enabled:true,subagents:true,level:'balanced',installation:{directory,version:'1.0.1'}});
const now=Date.now();
const events=[{stage:'postprocess',reason:'filtered',inputBytes:1000,outputBytes:100,durationMs:10},
 ...['rewritten','no_match','rewritten','no_match','rewritten'].map((reason,i)=>({stage:'rewrite',reason,inputBytes:900000+i,outputBytes:800000+i,durationMs:20}))];
for(const [i,e] of events.entries()) recordRtkEvent(root,{id:randomUUID(),at:now+i,role:i%2?'subagent':'main',level:'balanced',filter:i?'rewrite':'fixture',version:'1.0.1',...e} as any);
writeFileSync(join(out,'seed.json'),JSON.stringify({root,exe,events},null,2));
const calls:any[]=[];
const app=await startServer({root,port:0,dev:true,rtk:{download:async()=>{throw Error('Network downloads forbidden in probe');},run:async(file,args)=>{calls.push({file,args});throw Error('Binary execution forbidden in probe');}}});
console.log('isolated origin',app.origin,'root',root);
let browser;
const errors:string[]=[], failures:string[]=[], matrix:any[]=[], wsCommands:any[]=[], externalRequests:string[]=[];
try {
 browser=await chromium.launch({headless:true,executablePath:process.env.AXIOM_TEST_BROWSER || chromium.executablePath()});
 const context=await browser.newContext({reducedMotion:'reduce',acceptDownloads:true});
 await context.route('**/*',route=>{const u=new URL(route.request().url());if(['http:','https:'].includes(u.protocol)&&u.origin!==app.origin){externalRequests.push(u.href);return route.abort();}return route.continue();});
 const page=await context.newPage();
 page.on('pageerror',e=>errors.push(e.message));
 page.on('websocket',ws=>ws.on('framesent',f=>{try{wsCommands.push(JSON.parse(String(f.payload)));}catch{}}));
 await page.goto(app.origin+'/tools.html#rtk');
 const rtk=page.locator('#rtk');
 await rtk.getByText('900 B · 90.0%',{exact:true}).waitFor({timeout:60000});
 assert.match(await rtk.innerText(),/前置改写采用 3 \/ 检查 5 次/);
 assert.match(await rtk.innerText(),/1000 B → 100 B/);
 assert.match(await rtk.innerText(),/无法恢复未观察到的未压缩原文；不会为回查重跑命令/);
 assert.match(await rtk.innerText(),/仅后处理在采用前保存原始工具文本并附回查路径/);
 assert.match(await rtk.innerText(),/采用不代表已测得节省/);
 await rtk.locator('summary').filter({hasText:'最近 6 条记录'}).click();
 const rows=rtk.locator('tbody tr');assert.equal(await rows.count(),6);
 assert.equal(await rows.filter({hasText:'前置 · 字节未测量'}).count(),5);
 assert.equal(await rows.filter({hasText:'1000 B → 100 B'}).count(),1);
 for(const theme of ['dark','light']) {
   await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
   for(const width of [320,390,1200]) {
     await page.setViewportSize({width,height:900});
     await rtk.locator('#rtk-effects-heading').scrollIntoViewIfNeeded();
     await page.waitForTimeout(150);
     const size=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,innerWidth,bodyWidth:document.body.scrollWidth,theme:document.documentElement.dataset.theme}));
     matrix.push({theme,width,...size});
     await page.screenshot({path:join(out,`rtk-${theme}-${width}.png`),fullPage:true});
     assert.ok(size.scrollWidth<=width && size.bodyWidth<=width,JSON.stringify(size));
   }
 }
 const downloadPromise=page.waitForEvent('download');await rtk.getByRole('button',{name:'导出效果 JSON',exact:true}).click();
 const download=await downloadPromise;await download.saveAs(join(out,'axiom-rtk-effects.json'));
 const data=JSON.parse(readFileSync(join(out,'axiom-rtk-effects.json'),'utf8'));
 assert.equal(data.count,1);assert.equal(data.filtered,1);assert.equal(data.inputBytes,1000);assert.equal(data.outputBytes,100);assert.equal(data.durationMs,10);
 assert.equal(data.rewriteCount,5);assert.equal(data.rewritten,3);assert.equal(data.rewriteDurationMs,100);
 assert.match(data.measurement,/Postprocess-only observed UTF-8 tool text bytes including recall hint/);
 assert.match(data.measurement,/rewrite bytes are unknown.*adoption is not measured savings/);
 assert.match(data.measurement,/not billed tokens/);assert.equal(data.recent.length,6);
 assert.equal(data.recent.filter((e:any)=>e.stage==='rewrite'&&e.inputBytes>=900000).length,5);
 assert.deepEqual(errors,[]);assert.deepEqual(calls,[]);
 await page.screenshot({path:join(out,'rtk-export-verified.png'),fullPage:true});
 console.log('PASS real-page rendering, boundaries, download and six viewport/theme checks');
} catch(e) { failures.push(String((e as Error).stack||e)); console.error(e);process.exitCode=1; }
finally {
 writeFileSync(join(out,'result.json'),JSON.stringify({passed:!failures.length,origin:app.origin,root,errors,failures,matrix,calls,externalRequests,wsCommands},null,2));
 await browser?.close();await app.close();
}
