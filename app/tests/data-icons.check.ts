import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "vite";
import { chromium } from "playwright";
import { emptyCostTotals, type CostReport } from "../src/shared/costs.js";
const fixture = `
import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {Usage} from '/chat/Usage.tsx';import {MemoryToolbar} from '/memory/MemoryToolbar.tsx';import {parseMemory} from '/@fs/${resolve('src/shared/memory.ts').replaceAll('\\', '/')}';import {Icons} from '/components.tsx';import {acceptSnapshot,connect} from '/transport.ts';
import '/styles/tokens.css';import '/styles/workbench.css';import '/styles/icon-geometry.css';import '/styles/mobile.css';import '/styles/data-icons.css';import '/styles/action-icons.css';
const root=createRoot(document.getElementById('root'));let seq=0;
window.show=(options={})=>{const sessionId=options.sessionId??'parent';const scope={workspaceId:'fixture',sessionId};
flushSync(()=>root.render(<><Icons/><main style={{height:'100dvh',boxSizing:'border-box',display:'flex',flexDirection:'column',justifyContent:'flex-end',padding:'20px 12px'}}>{options.memory === undefined ? <Usage scope={scope}/> : <MemoryToolbar scope={scope} workspaces={[]}>{tools=><Usage scope={scope} tools={tools}/>}</MemoryToolbar>}</main></>));
acceptSnapshot({scope:'agent:fixture:'+sessionId,streamId:'fixture',seq:++seq,data:{task:sessionId==='child'?{id:'fixture-task',parentSessionId:'parent',status:'completed'}:undefined,selection:null,environment:null,run:options.active?{id:'fixture-run',status:'running',startedAt:Date.now()}:null,usage:options.usage??{input:90000,output:123,cacheRead:9000,cacheWrite:1000,total:100123,cost:0.1234,lastRequest:{input:56250,cacheRead:25000,cacheWrite:18750},context:{tokens:32000,window:128000,estimated:true}}}});if(options.memory!==undefined)acceptSnapshot({scope:'memory:fixture:'+sessionId,streamId:'fixture',seq:++seq,data:{...scope,revision:String(seq),entry:options.memory,progress:parseMemory(options.memory),files:[],deleted:false}});};window.show();connect();`;
const output=resolve(process.env.AXIOM_TEST_ARTIFACTS || 'test-results/data-icons');
const server = await createServer({ configFile: false, root: resolve('src/client'), cacheDir: resolve(output,'vite-cache'), plugins: [{ name: 'data-fixture', resolveId(id) { if(id==='virtual:data-icons') return id; }, load(id) { if(id==='virtual:data-icons') return {code:fixture,loader:'tsx'}; }, transform(code,id){ if(id==='virtual:data-icons') return import('esbuild').then(e=>e.transform(code,{loader:'tsx',jsx:'automatic'})); } }], server: { host:'127.0.0.1',port:0,fs:{allow:[resolve('.')]}} });
await server.listen();const browser=await chromium.launch({executablePath:process.env.AXIOM_TEST_BROWSER});
mkdirSync(output,{recursive:true});
try {
  const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'}),errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/status', route => route.fulfill({json:{ok:true}}));
  await page.routeWebSocket('**/ws', socket => socket.onMessage(raw => {
    const command = JSON.parse(String(raw));
    let data: CostReport | object = {};
    if (command.op === 'costs.get') {
      const totals = {...emptyCostTotals(),records:1,knownCost:12.9876};
      totals.tokens.input = 100;
      totals.parts.input = totals.knownCost;
      data = {scope:{workspaceId:'fixture',sessionId:command.sessionId},requestedSessionId:command.sessionId,
        title:'图标测试',updatedAt:Date.now(),sessions:[{id:command.sessionId,title:'图标测试',taskId:null,status:null}],
        rows:[{...totals,id:'fixture-cost',category:'main',sessionId:command.sessionId,source:'fixture',provider:'fixture',model:'fixture'}],
        total:totals,warnings:[]} satisfies CostReport;
    }
    socket.send(JSON.stringify({type:'receipt',requestId:command.requestId,ok:true,data}));
  }));
  await page.route('**/data-icons-check',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/virtual:data-icons"></script></body></html>'}));
  await page.goto(server.resolvedUrls!.local[0]+'data-icons-check');await page.locator('[data-od-id="context-capacity"] svg[data-value="25"]').waitFor();
  const escape = async () => { await page.keyboard.press('Escape'); await page.waitForFunction(()=>!document.querySelector('.metric-detail,.cost-popover')); };
  const context=page.locator('[data-od-id="context-capacity"]'),cache=page.locator('[data-od-id="cache-tokens"]');
  assert.equal(await context.innerText(),'');
  assert.equal(await context.locator('.data-filled').count(),1);
  assert.equal(await context.locator('.data-filled').getAttribute('d'),'M10 1.5A8.5 8.5 0 0 1 18.5 10');
  assert.equal(await context.locator('.context-ring.data-track').getAttribute('stroke-dasharray'),null);
  assert.equal(await context.locator('.memory-progress-bars .memory-progress-pending').count(),3);
  await context.click();assert.match(await page.locator('.metric-detail').innerText(),/32,000 \/ 128,000/);assert.match(await page.locator('.metric-detail').innerText(),/待模型用量校准/);
  await escape();assert.ok(await context.evaluate(n=>n===document.activeElement));
  await cache.click();const text=await page.locator('.metric-detail').innerText();for(const value of ['25.0%','25,000','56,250','18,750','最近一次请求'])assert.ok(text.includes(value));
  const method = page.locator('.cache-detail .metric-method');
  assert.equal(await method.locator('summary use').getAttribute('href'), '#i-chevron-down');
  await method.locator('summary').focus(); await page.keyboard.press('Enter');
  assert.equal(await method.getAttribute('open'), '');
  assert.match(await method.innerText(), /本次请求的 Token 命中比例/);
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
  const show=async(usage:unknown,sessionId='parent',active=false)=>{await page.evaluate(({usage,sessionId,active})=>(window as any).show({usage,sessionId,active}),{usage,sessionId,active});};
  const base={input:5000,cacheRead:5000,cacheWrite:0,output:0,total:10000,cost:null,lastRequest:null,context:{tokens:0,window:128000,estimated:false}};
  await show({...base,context:{tokens:175855,window:272000,source:'model-usage'}});
  await context.click();
  assert.match(await page.locator('.metric-detail').innerText(),/模型用量校准＋新增消息估算/);
  assert.match(await page.locator('.metric-detail').innerText(),/与压缩时保存的快照可能不同/);
  await show({...base,context:{tokens:180095,window:272000,source:'model-usage'}});
  await page.waitForFunction(()=>document.querySelector('.metric-detail')?.textContent?.includes('180,095 / 272,000'));
  await escape();
  await show(base); await context.click();
  assert.match(await page.locator('.metric-detail').innerText(),/历史估算（来源未记录）/); await escape();
  const request=(ratio:number)=>({...base,lastRequest:{input:100-ratio,cacheRead:ratio,cacheWrite:0}});
  for(const lastRequest of [undefined,null,{input:0,cacheRead:0,cacheWrite:0},{input:10,cacheWrite:0},{input:-1,cacheRead:1,cacheWrite:0}]) {
    await show({...base,lastRequest});
    await page.waitForFunction(()=>document.querySelector('[data-od-id="cache-tokens"] svg')?.getAttribute('data-value')==='unknown');
    await cache.click();assert.equal(await page.locator('.cache-summary strong').innerText(),'—');await escape();
  }
  await show(request(80));await cache.click();
  assert.equal(await page.locator('.cache-summary strong').innerText(),'80.0%');
  await show(request(20));await page.waitForFunction(()=>document.querySelector('.cache-summary strong')?.textContent==='20.0%');
  assert.deepEqual(await page.locator('.cache-ledger dd').allTextContents(),['20','80','0']);
  await show(request(90),'child');await page.locator('.metric-detail').waitFor({state:'detached'});
  await cache.click();assert.match(await page.locator('.metric-detail').innerText(),/当前子会话 · 最近一次请求/);
  assert.equal(await page.locator('.cache-summary strong').innerText(),'90.0%');
  await show(request(20),'parent');await page.locator('.metric-detail').waitFor({state:'detached'});
  await page.waitForFunction(()=>document.querySelector('[data-od-id="cache-tokens"] svg')?.getAttribute('data-value')==='20');
  await show(base);await page.waitForFunction(()=>document.querySelector('[data-od-id="context-capacity"] svg')?.getAttribute('data-value')==='0');
  assert.equal(await cache.locator('svg.data-icon').getAttribute('data-value'),'unknown');
  await show({...base,input:100,context:{tokens:160000,window:128000,estimated:false}});
  await context.click();assert.match(await page.locator('.metric-detail').innerText(),/125.0%/);assert.match(await page.locator('.metric-detail').innerText(),/超出上下文容量 32,000/);assert.equal(await context.locator('.data-filled').count(),1);assert.equal(await context.locator('.data-filled').getAttribute('d'),await context.locator('.data-track').getAttribute('d'));assert.equal(await context.locator('.memory-progress-lit').count(),0);
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
  assert.equal(await color('[data-od-id="estimated-cost"] svg'),'rgb(138, 143, 152)');
  await page.waitForFunction(()=>document.querySelector('[data-od-id="estimated-cost"] svg')?.getAttribute('data-level')==='1');
  assert.equal(await cost.locator('.cost-axis').getAttribute('d'),'M3 3v16a2 2 0 0 0 2 2h16');
  assert.equal(await cost.locator('.cost-bar').count(),3);
  assert.equal(await cost.locator('.cost-bar[data-pulse="true"]').getAttribute('data-tone'),'warning');
  assert.equal(await cost.locator('[data-od-id="run-duration"]').count(),0);
  assert.equal(await page.locator('.usage-row > button').count(),4);
  await cost.click();
  await page.waitForFunction(()=>document.querySelector('.cost-session-facts dd')?.textContent==='$12.9876');
  assert.match(await page.locator('.cost-session-duration').innerText(),/当前主会话预计费用/);
  assert.match(await page.locator('.cost-session-duration').innerText(),/\$12\.9876/);
  await escape();
  assert.ok(await cost.evaluate(n=>n===document.activeElement));
  assert.deepEqual(await page.locator('.usage-row [data-od-id]').evaluateAll(els=>els.map(el=>el.getAttribute('data-od-id'))),['context-capacity','cache-tokens','estimated-cost']);
  // The context base ring shares the neighboring outlines' effective paint.
  await page.mouse.move(0,0);
  await cost.evaluate(el=>(el as HTMLElement).blur());
  const ringPaint=await context.locator('.context-ring.data-track').evaluate(el=>{const s=getComputedStyle(el);return [s.stroke,s.strokeWidth,s.opacity,s.vectorEffect]});
  assert.deepEqual(ringPaint,await cache.locator('.cache-outline ellipse').evaluate(el=>{const s=getComputedStyle(el);return [s.stroke,s.strokeWidth,s.opacity,s.vectorEffect]}));
  assert.deepEqual(ringPaint,['rgb(138, 143, 152)','1.2px','1','non-scaling-stroke']);
  assert.equal(await cost.locator('svg').evaluate(el=>getComputedStyle(el).stroke),ringPaint[0]);
  assert.equal(await cost.evaluate(el=>getComputedStyle(el).getPropertyValue('--icon-stroke').trim()),'1.2px');
  await context.hover();
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.context-ring.data-track')!).stroke==='rgb(247, 248, 248)');
  await page.mouse.move(0,0);
  for(const ratio of [0,49.99,50,70,70.01,90,90.01,100]) {
    await show(request(ratio));
    await page.waitForFunction(value=>document.querySelector('[data-od-id="cache-tokens"] svg')?.getAttribute('data-value')===String(value),ratio);
    assert.equal(await color('[data-od-id="cache-tokens"] svg'),'rgb(138, 143, 152)');
    const lightning=cache.locator('.cache-lightning');
    const expected=ratio>90?'rgb(39, 166, 68)':ratio>70?'rgb(252, 188, 124)':'rgb(217, 149, 149)';
    assert.equal(await lightning.evaluate(el=>getComputedStyle(el).stroke),expected,`lightning at ${ratio}%`);
    await cache.hover();
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('[data-od-id="cache-tokens"] svg')!).color==='rgb(247, 248, 248)');
    assert.equal(await lightning.evaluate(el=>getComputedStyle(el).stroke),expected,`lightning retains tone on hover at ${ratio}%`);
    await page.mouse.move(0,0);
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('[data-od-id="cache-tokens"] svg')!).color==='rgb(138, 143, 152)');
  }
  // Drive the actual SVG clock at both ends of the opacity cycle, including
  // transitions from breathing to green and back on the same React component.
  for(const reducedMotion of ['no-preference','reduce'] as const) {
    await page.emulateMedia({reducedMotion});
    for(const [ratio,active,breathing] of [[70,true,true],[70.01,true,true],[90,true,true],[90.01,true,false],[100,true,false],[90,true,true],[null,true,true],[70,false,false],[100,false,false]] as const) {
      await show(ratio===null?base:request(ratio),'parent',active);
      await page.waitForFunction(value=>document.querySelector('[data-od-id="cache-tokens"] svg')?.getAttribute('data-value')===value,ratio===null?'unknown':String(ratio));
      assert.equal(await cache.locator('animate').count(),breathing?1:0,`${ratio}% active=${active}`);
      const samples=[];
      for(const time of [0,.9]) samples.push(await cache.locator('svg').evaluate(async(el,time)=>{const svg=el as SVGSVGElement;svg.pauseAnimations();svg.setCurrentTime(time);await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));return Number(getComputedStyle(svg.querySelector('.cache-outline')!).opacity)},time));
      if(breathing) assert.ok(samples[0]-samples[1]>.5,`${reducedMotion}: ${ratio}% breathes: ${samples}`);
      else assert.deepEqual(samples,[1,1],`${reducedMotion}: ${ratio}% stays opaque`);
    }
  }
  await show(base);
  await page.waitForFunction(()=>document.querySelector('[data-od-id="cache-tokens"] svg')?.getAttribute('data-value')==='unknown');
  assert.equal(await color('[data-od-id="cache-tokens"] svg'),'rgb(138, 143, 152)');
  assert.equal(await cache.locator('.cache-lightning').getAttribute('data-tone'),'unknown');
  assert.equal(await cache.locator('.cache-lightning').evaluate(el=>getComputedStyle(el).stroke),'rgb(138, 143, 152)');
  for (const ratio of [0,25,50,90,100,125]) {
    await show({...base,input:100,context:{tokens:ratio*1000,window:100000,estimated:false}});
    await page.waitForFunction(value=>document.querySelector('[data-od-id="context-capacity"] svg')?.getAttribute('data-value')===String(value),ratio);
    assert.equal(await context.locator('.data-filled').count(),ratio===0?0:1);
    if(ratio>0){
      const renderedRatio=await context.evaluate(el=>{
        const fill=el.querySelector<SVGPathElement>('.data-filled')!, track=el.querySelector<SVGPathElement>('.data-track')!;
        return fill.getTotalLength()/track.getTotalLength()*100;
      });
      assert.ok(Math.abs(renderedRatio-Math.min(100,ratio))<.2,`drawn arc length at ${ratio}%: ${renderedRatio}`);
      assert.equal(await context.locator('.data-filled').evaluate(el=>getComputedStyle(el).stroke),'rgb(252, 188, 124)');
      assert.notEqual(await context.locator('.data-track').evaluate(el=>getComputedStyle(el).stroke),'rgb(252, 188, 124)');
      await context.hover();
      assert.equal(await context.locator('.data-filled').evaluate(el=>getComputedStyle(el).stroke),'rgb(252, 188, 124)');
      await page.mouse.move(0,0);
    }
  }
  for(const [estimate,state,bars,valid] of [['约 30%','进行中',0,'30'],['约 40%','进行中',1,'40'],['约 70%','进行中',2,'70'],['约 90%','进行中',2,'90'],['100%','已完成',3,'100'],['100%','进行中',0,'unknown'],['待评估','尚未记录',0,'unknown']] as const) {
    const memory=`# 会话记忆\n\n## 目标与范围\n三等分验证\n\n## 任务进度\n整体状态：${state}\n整体进度：${estimate}\n${state==='已完成'?'- [已完成] 验证进度图标\n':''}`;
    await page.evaluate(memory=>(window as any).show({memory}),memory);
    await page.waitForFunction(value=>document.querySelector('.memory-progress-bars')?.getAttribute('data-progress')===value,valid);
    assert.equal(await context.locator('.memory-progress-lit').count(),bars,estimate+' '+state);
    assert.equal(await context.innerText(),'');
    assert.equal(await context.locator('.data-filled').count(),1);
    assert.equal(await context.locator('.memory-progress-bars path').count(),3);
    assert.ok((await context.locator('.memory-progress-bars path').first().getAttribute('d'))?.includes('l1 1 1.5-2'));
    if(bars){
      assert.equal(await color('.memory-progress-lit'),'rgb(252, 188, 124)');
      assert.equal(await context.locator('.memory-progress-lit').first().evaluate(el=>getComputedStyle(el).stroke),'rgb(252, 188, 124)');
    }
    for(const pending of await context.locator('.memory-progress-pending').all()) assert.equal(await pending.evaluate(el=>getComputedStyle(el).opacity),'0.4');
    await context.screenshot({path:resolve(output,`context-task-${valid}-${state}.png`)});
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
