import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "vite";
import { chromium } from "playwright";
const fixture = `
import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {Usage} from '/chat/Usage.tsx';import {MemoryToolbar} from '/memory/MemoryToolbar.tsx';import {parseMemory} from '/@fs/${resolve('src/shared/memory.ts').replaceAll('\\', '/')}';import {Icons} from '/components.tsx';import {acceptSnapshot} from '/transport.ts';
import '/styles/tokens.css';import '/styles/workbench.css';import '/styles/icon-geometry.css';import '/styles/mobile.css';import '/styles/data-icons.css';import '/styles/action-icons.css';
const root=createRoot(document.getElementById('root'));let seq=0;
window.show=(options={})=>{const sessionId=options.sessionId??'parent';const scope={workspaceId:'fixture',sessionId};
flushSync(()=>root.render(<><Icons/><main style={{height:'100dvh',boxSizing:'border-box',display:'flex',flexDirection:'column',justifyContent:'flex-end',padding:'20px 12px'}}>{options.memory === undefined ? <Usage scope={scope}/> : <MemoryToolbar scope={scope} workspaces={[]}>{tools=><Usage scope={scope} tools={tools}/>}</MemoryToolbar>}</main></>));
acceptSnapshot({scope:'agent:fixture:'+sessionId,streamId:'fixture',seq:++seq,data:{selection:null,environment:null,run:null,usage:options.usage??{input:56250,output:123,cacheRead:25000,cacheWrite:18750,total:100123,cost:0.1234,context:{tokens:32000,window:128000,estimated:true}}}});if(options.memory!==undefined)acceptSnapshot({scope:'memory:fixture:'+sessionId,streamId:'fixture',seq:++seq,data:{...scope,revision:String(seq),entry:options.memory,progress:parseMemory(options.memory),files:[],deleted:false}});};window.show();`;
const server = await createServer({ configFile: false, root: resolve('src/client'), cacheDir: resolve('test-results/data-icons/vite-cache'), plugins: [{ name: 'data-fixture', resolveId(id) { if(id==='virtual:data-icons') return id; }, load(id) { if(id==='virtual:data-icons') return {code:fixture,loader:'tsx'}; }, transform(code,id){ if(id==='virtual:data-icons') return import('esbuild').then(e=>e.transform(code,{loader:'tsx',jsx:'automatic'})); } }], server: { host:'127.0.0.1',port:0,fs:{allow:[resolve('.')]}} });
await server.listen();const browser=await chromium.launch({executablePath:process.env.AXIOM_TEST_BROWSER});
const output=resolve('test-results/data-icons');mkdirSync(output,{recursive:true});
try {
  const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'}),errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/data-icons-check',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/virtual:data-icons"></script></body></html>'}));
  await page.goto(server.resolvedUrls!.local[0]+'data-icons-check');await page.locator('[data-od-id="context-capacity"] svg[data-value="25"]').waitFor();
  const escape = async () => { await page.keyboard.press('Escape'); await page.waitForFunction(()=>!document.querySelector('.metric-detail,.cost-popover')); };
  const context=page.locator('[data-od-id="context-capacity"]'),cache=page.locator('[data-od-id="cache-tokens"]');
  assert.equal(await context.innerText(),'');
  assert.equal(await context.locator('.data-filled').count(),1);
  assert.equal(await context.locator('.data-filled').getAttribute('stroke-dasharray'),'25 100');
  assert.equal(await context.locator('.context-ring.data-track').getAttribute('stroke-dasharray'),null);
  assert.equal(await context.locator('.memory-progress-bars .memory-progress-pending').count(),3);
  await context.click();assert.match(await page.locator('.metric-detail').innerText(),/32,000 \/ 128,000/);assert.match(await page.locator('.metric-detail').innerText(),/待模型用量校准/);
  await escape();assert.ok(await context.evaluate(n=>n===document.activeElement));
  await cache.click();const text=await page.locator('.metric-detail').innerText();for(const value of ['25.0%','25,000','56,250','18,750','累计输入'])assert.ok(text.includes(value));
  const method = page.locator('.cache-detail .metric-method');
  assert.equal(await method.locator('summary use').getAttribute('href'), '#i-chevron-down');
  await method.locator('summary').focus(); await page.keyboard.press('Enter');
  assert.equal(await method.getAttribute('open'), '');
  assert.match(await method.innerText(), /不是请求命中概率/);
  await page.keyboard.press('Enter');
  assert.equal(await method.getAttribute('open'), null);
  await escape(); await cache.click();
  for (const width of [390, 1440]) {
    await page.setViewportSize({width,height:900});
    assert.ok(await page.locator('.cache-detail').evaluate(el => el.getBoundingClientRect().width <= 360 && el.scrollWidth <= el.clientWidth + 1));
    assert.equal(await page.locator('.cache-summary strong').evaluate(el => getComputedStyle(el).fontSize), '20px');
    assert.ok(await page.locator('.cache-detail').evaluate(el => {
      const body = el.querySelector('.toolbar-detail-body')!.getBoundingClientRect();
      const summary = el.querySelector('.cache-summary')!.getBoundingClientRect();
      const ledger = el.querySelector('.cache-ledger')!.getBoundingClientRect();
      return summary.top >= body.top && ledger.bottom <= body.bottom;
    }), 'opening shows the percentage and all three input counts without scrolling');
    await page.screenshot({path:resolve(output,`cache-detail-${width}.png`)});
  }
  await page.setViewportSize({width:390,height:844});
  await escape();await page.screenshot({path:resolve(output,'mobile.png')});
  const show=async(usage:unknown,sessionId='parent')=>{await page.evaluate(({usage,sessionId})=>(window as any).show({usage,sessionId}),{usage,sessionId});};
  const base={input:0,cacheRead:0,cacheWrite:0,output:0,total:0,cost:null,context:{tokens:0,window:128000,estimated:false}};
  await show(base);await page.waitForFunction(()=>document.querySelector('[data-od-id="context-capacity"] svg')?.getAttribute('data-value')==='0');
  assert.equal(await cache.locator('svg.data-icon').getAttribute('data-value'),'unknown');
  await show({...base,input:100,context:{tokens:160000,window:128000,estimated:false}});
  await context.click();assert.match(await page.locator('.metric-detail').innerText(),/125.0%/);assert.match(await page.locator('.metric-detail').innerText(),/超出上下文容量 32,000/);assert.equal(await context.locator('.data-filled').count(),1);assert.equal(await context.locator('.data-filled').getAttribute('stroke-dasharray'),'100 100');assert.equal(await context.locator('.memory-progress-lit').count(),0);
  await show({...base,input:100},'child');await page.locator('.metric-detail').waitFor({state:'detached'});
  await page.setViewportSize({width:1440,height:900});assert.equal(await context.innerText(),'');
  await context.click();await page.screenshot({path:resolve(output,'desktop-detail.png')});await escape();
  for (const height of [667, 320, 240]) {
    await page.setViewportSize({width:375,height}); await cache.click();
    const box = (await page.locator('.metric-detail').boundingBox())!;
    assert.ok(box.y >= 0 && box.y + box.height <= height + 1, `detail respects short viewport ${height}`);
    assert.ok(await page.locator('.metric-detail').evaluate(n => n.clientHeight <= innerHeight - 20));
    await escape();
  }
  await page.setViewportSize({width:1440,height:900});
  const cost=page.locator('[data-od-id="estimated-cost"]'),duration=page.locator('[data-od-id="run-duration"]');
  const color=async(selector:string)=>page.locator(selector).first().evaluate(el=>getComputedStyle(el).color);
  await show({...base,input:100,cost:12.9876});
  await page.waitForFunction(()=>document.querySelector('[data-od-id="estimated-cost"]')?.textContent==='');
  assert.equal(await color('[data-od-id="estimated-cost"] svg'),'rgb(184, 190, 200)');
  assert.equal(await cost.locator('use').getAttribute('href'),'#i-chart-column-increasing');
  assert.equal(await cost.locator('[data-od-id="run-duration"]').count(),0);
  assert.equal(await page.locator('.usage-row > button').count(),3);
  await cost.click();
  assert.match(await page.locator('.cost-session-duration').innerText(),/当前主会话预计费用/);
  assert.match(await page.locator('.cost-session-duration').innerText(),/\$12\.9876/);
  await escape();
  assert.ok(await cost.evaluate(n=>n===document.activeElement));
  assert.deepEqual(await page.locator('.usage-row [data-od-id]').evaluateAll(els=>els.map(el=>el.getAttribute('data-od-id'))),['context-capacity','cache-tokens','estimated-cost']);
  for(const ratio of [0,49.99,50,100]) {
    await show({...base,input:100-ratio,cacheRead:ratio});
    await page.waitForFunction(value=>document.querySelector('[data-od-id="cache-tokens"] svg')?.getAttribute('data-value')===String(value),ratio);
    assert.equal(await color('[data-od-id="cache-tokens"] svg'),ratio<50?'rgb(217, 149, 149)':'rgb(184, 190, 200)');
  }
  await show(base);
  await page.waitForFunction(()=>document.querySelector('[data-od-id="cache-tokens"] svg')?.getAttribute('data-value')==='unknown');
  assert.equal(await color('[data-od-id="cache-tokens"] svg'),'rgb(184, 190, 200)');
  for(const [estimate,state,bars,valid] of [['约 30%','进行中',0,'30'],['约 40%','进行中',1,'40'],['约 70%','进行中',2,'70'],['约 90%','进行中',2,'90'],['100%','已完成',3,'100'],['100%','进行中',0,'unknown'],['待评估','尚未记录',0,'unknown']] as const) {
    const memory=`# 会话记忆\n\n## 目标与范围\n三等分验证\n\n## 任务进度\n整体状态：${state}\n整体进度：${estimate}\n`;
    await page.evaluate(memory=>(window as any).show({memory}),memory);
    await page.waitForFunction(value=>document.querySelector('.memory-progress-bars')?.getAttribute('data-progress')===value,valid);
    assert.equal(await context.locator('.memory-progress-lit').count(),bars,estimate+' '+state);
    assert.equal(await context.innerText(),'');
    assert.equal(await context.locator('.data-filled').count(),1);
    if(bars)assert.equal(await color('.memory-progress-lit'),'rgb(252, 188, 124)');
  }
  for(const width of [1440,820,390,360]) {
    await page.setViewportSize({width,height:844});
    const centers=await page.locator('.usage-row [data-od-id]>svg').evaluateAll(els=>els.map(el=>{const b=el.getBoundingClientRect();return b.x+b.width/2}));
    const gaps=centers.slice(1).map((x,i)=>x-centers[i]);
    assert.ok(Math.max(...gaps)-Math.min(...gaps)<1,`equal icon spacing at ${width}: ${gaps}`);
    for(const item of [context,cache,cost]){const box=(await item.boundingBox())!;assert.ok(box.width>=44&&box.height>=44)}
    assert.equal(await duration.isVisible(),false);
    assert.ok(gaps.every(gap=>Math.abs(gap-44)<1));
    await cost.click();assert.match(await page.locator('.cost-session-duration').innerText(),/耗时/);await escape();
  }
  await page.setViewportSize({width:1440,height:900});
  await page.locator('.usage').screenshot({path:resolve(output,'toolbar-gray.png')});
  await show(base);
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(() => { const dialog=document.createElement('dialog');dialog.id='child-fixture';document.body.append(dialog);dialog.append(document.getElementById('root')!);dialog.showModal(); });
  await cache.click();assert.equal(await page.locator('#child-fixture > .metric-detail').count(),1,'child metric remains owned by its modal');
  await escape();assert.equal(await page.locator('#child-fixture').evaluate(n=>(n as HTMLDialogElement).open),true,'Escape closes only metric');
  assert.deepEqual(errors,[]);writeFileSync(resolve(output,'results.json'),JSON.stringify({passed:true,errors,checks:['continuous context ring','icon-only toolbar','Esc focus','zero vs unknown','over-capacity actual amount','scope switch closes','desktop values']},null,2));
  console.log('PASS: real Usage ratios, mobile details, focus, unknown/zero, over-capacity and scope isolation');
}finally{await browser.close();await server.close();}
