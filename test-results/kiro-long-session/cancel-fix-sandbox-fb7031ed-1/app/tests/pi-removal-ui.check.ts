// Browser-only synthetic IPC/button coverage. Never runs a product/helper/install/uninstall.
import assert from 'node:assert/strict';
import { build } from 'vite';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, basename } from 'node:path';
const root=mkdtempSync(join(tmpdir(),'axiom-pi-buttons-')), artifacts=resolve(process.env.AXIOM_TEST_ARTIFACTS??'test-results/pi-removal-ui');
mkdirSync(artifacts,{recursive:true});
await build({configFile:false,root:resolve('src/client'),logLevel:'warn',define:{'process.env.NODE_ENV':'"production"'},build:{outDir:root,emptyOutDir:true,target:'safari15',minify:false,lib:{entry:resolve('tests/fixtures/pi-removal.tsx'),name:'PiRemovalFixture',formats:['iife'],fileName:'fixture'}}});
const files=readdirSync(root), js=files.find(f=>f.endsWith('.js'))!,css=files.find(f=>f.endsWith('.css'))!;
writeFileSync(join(root,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/${css}"><body><div id="root"></div><script src="/${js}"></script></body></html>`);
const server=createServer((req,res)=>{const name=req.url==='/'?'index.html':basename(new URL(req.url!,'http://test').pathname);if(![...files,'index.html'].includes(name)){res.writeHead(404).end();return;}res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(readFileSync(join(root,name)));});
await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
const browser=await chromium.launch({executablePath:process.env.AXIOM_TEST_BROWSER,headless:true});
const calls:any[]=[],passed:string[]=[],errors:string[]=[];
const budgets={headersMs:30000,idleMs:60000,installMs:600000,totalMs:1200000};
const task=(id:string,status='succeeded')=>({id,attemptId:`attempt-${id}`,endpoint:'desktop',scope:'合成按钮测试；无真实删除',resource:'pi-remove-preview',label:'Pi 卸载预览',action:'check',status,phase:'checking',steps:['checking'],completedSteps:status==='succeeded'?1:0,createdAt:Date.now(),startedAt:Date.now(),updatedAt:Date.now(),budgets:{...budgets},capabilities:{cancel:status==='running',extend:status==='running'}});
const preview={installed:true,token:'synthetic-pi-token',version:'1.2.3',packageRoot:'C:/synthetic/npm/node_modules/@earendil-works/pi-coding-agent',items:[{label:'合成程序目录',path:'C:/synthetic/package',state:'remove'},{label:'共享缓存',path:'C:/synthetic/cache',state:'retain'}]};
let activePage:any;
async function scene(name:string,initial:any){
 const page=await browser.newPage();activePage=page;page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
 const context={state:initial,failAction:'',calls:[] as any[],finishOnStatus:false};
 await page.route('**/native',async route=>{
  const input=JSON.parse(route.request().postData()!);assert.equal(input.command,'axiom_update');
  const action=input.args.action,payload=input.args.version===null?null:JSON.parse(input.args.version);const call={scene:name,action,payload};calls.push(call);context.calls.push(call);
  assert.ok(['status','pi-remove-preview','pi-uninstall','cancel','extend','reconcile'].includes(action));
  if(action==='cancel'){assert.equal(payload.id,context.state.job.task.id);context.state={...context.state,job:{...context.state.job,task:{...context.state.job.task,status:'cancelled'},running:false}};}
  if(action==='extend'){assert.equal(payload.id,context.state.job.task.id);context.state={...context.state,job:{...context.state.job,task:{...context.state.job.task,budgets:payload.budgets}}};}
  if(action==='reconcile'){assert.equal(payload.id,context.state.job.task.id);context.state={...context.state,job:{...context.state.job,running:false,task:{...context.state.job.task,status:'cancelled'}}};}
  if(action==='pi-uninstall'){
   assert.deepEqual(payload,{token:'synthetic-pi-token',confirm:true,sessionsClosed:true});
   context.state={pi:{removal:{...preview,token:null}},job:{kind:'pi-uninstall',running:false,message:'合成卸载结果',task:{...task(`${name}-remove`,context.failAction?'unknown':'succeeded'),message:'合成卸载结果'},cleanup:{items:[{label:'合成程序目录',state:'removed'}],complete:!context.failAction}}};
  }
  await new Promise(done=>setTimeout(done,80));
  if(action===context.failAction){await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'合成桥接响应丢失'})});return;}
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(context.state)});
 });
 await page.addInitScript({content:'window.__name = value => value; window.__TAURI_INTERNALS__={invoke:async(command,args)=>{const r=await fetch("/native",{method:"POST",body:JSON.stringify({command,args})});const v=await r.json();if(!r.ok)throw Error(v.error);return v;}};'});
 await page.goto(`http://127.0.0.1:${(server.address() as any).port}/`);
 return {page,section:page.getByRole('region',{name:'终端 Pi 卸载'}),context};
}
function installed(name:string){return{pi:{removal:structuredClone(preview)},job:{kind:'pi-remove-preview',running:false,message:'合成预览',task:task(name)}};}
try{
 {
  const {page,section,context}=await scene('confirmation',installed('confirmation'));
  await section.getByRole('button',{name:'预览 Pi 卸载',exact:true}).evaluate((button:HTMLButtonElement)=>{button.click();button.click();});
  const open=section.getByRole('button',{name:'卸载此终端 Pi',exact:true});await open.waitFor();assert.equal(context.calls.filter(c=>c.action==='pi-remove-preview').length,1);
  await open.click();const group=section.getByRole('group',{name:'确认 Pi 卸载'}),confirm=group.getByRole('button',{name:'确认卸载',exact:true});
  assert.equal(await confirm.isDisabled(),true);await group.getByRole('checkbox').check();assert.equal(await confirm.isEnabled(),true);
  for(const theme of ['dark','light'])for(const width of [360,1200]){await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.setViewportSize({width,height:850});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:join(artifacts,`pi-confirm-${theme}-${width}.png`),fullPage:true});}
  await group.getByRole('button',{name:'返回',exact:true}).click();assert.equal(await group.count(),0);assert.equal(context.calls.filter(c=>c.action==='pi-uninstall').length,0);
  await open.click();assert.equal(await group.getByRole('checkbox').isChecked(),false);assert.equal(await confirm.isDisabled(),true);
  await group.getByRole('checkbox').check();await group.getByRole('checkbox').uncheck();assert.equal(await confirm.isDisabled(),true);await group.getByRole('checkbox').check();
  await confirm.evaluate((button:HTMLButtonElement)=>{button.click();button.click();});
  await section.getByText('合成卸载结果',{exact:true}).waitFor();assert.equal(context.calls.filter(c=>c.action==='pi-uninstall').length,1);assert.equal(await group.count(),0);assert.equal(await open.count(),0);
  passed.push('预览防重复、打开确认、默认禁用、会话勾选/撤回、返回不提交、重开清空勾选、确认payload及防双提交、成功后不再确认、4幅确认截图');await page.close();
 }
 {
  const {page,section,context}=await scene('lost-response',installed('lost-response'));context.failAction='pi-uninstall';
  await section.getByRole('button',{name:'预览 Pi 卸载',exact:true}).click();await section.getByRole('button',{name:'卸载此终端 Pi',exact:true}).click();await section.getByRole('checkbox').check();await section.getByRole('button',{name:'确认卸载',exact:true}).click();
  await section.getByRole('alert').filter({hasText:'合成桥接响应丢失'}).waitFor();assert.equal(await section.getByRole('button',{name:'卸载此终端 Pi',exact:true}).count(),0);
  await page.waitForTimeout(2300);assert.equal(context.calls.filter(c=>c.action==='pi-uninstall').length,1);
  await section.getByRole('button',{name:'读取清理任务',exact:true}).click();await section.getByRole('button',{name:'核实中断任务',exact:true}).waitFor();assert.equal(context.calls.filter(c=>c.action==='pi-uninstall').length,1);
  passed.push('合成响应丢失后不自动重放卸载、消费确认、读取原任务、unknown提供核实而非重复删除');await page.close();
 }
 {
  const value=installed('other-job');value.job.kind='check';const {page,section}=await scene('other-job',value);
  await section.getByRole('button',{name:'读取清理任务',exact:true}).click();await section.getByRole('status').filter({hasText:'暂无终端 Pi 卸载任务'}).waitFor();assert.equal(await section.getByRole('button',{name:'卸载此终端 Pi',exact:true}).count(),0);passed.push('其他类型任务不能复用旧Pi预览授权');await page.close();
 }
 {
  const value=installed('npm-failed');value.job.task={...task('npm-failed','failed'),error:{code:'operation',phase:'checking',message:'合成npm检查失败'}} as any;value.pi.removal=null as any;
  const {page,section}=await scene('npm-failed',value);await section.getByRole('button',{name:'预览 Pi 卸载',exact:true}).click();await section.getByRole('alert').filter({hasText:'合成npm检查失败'}).waitFor();assert.equal(await section.getByRole('button',{name:'卸载此终端 Pi',exact:true}).count(),0);passed.push('真实检查失败不伪装为空安装，不提供删除确认（合成UI）');await page.close();
 }
 {
  const value=installed('cancel-id');value.job.running=true;value.job.task=task('cancel-id','running');const {page,section,context}=await scene('cancel-id',value);
  await section.getByRole('button',{name:'读取清理任务',exact:true}).click();await section.getByRole('button',{name:'取消任务',exact:true}).click();await section.getByRole('status',{name:''}).filter({hasText:'已取消'}).waitFor();
  assert.deepEqual(context.calls.find(c=>c.action==='cancel').payload,{id:'cancel-id'});const before=context.calls.length;await page.waitForTimeout(2300);assert.equal(context.calls.length,before);passed.push('Pi取消桥接action/id绑定，终态停止轮询（合成）');await page.close();
 }
 {
  const value=installed('extend-id');value.job.running=true;value.job.task=task('extend-id','running');const {page,section,context}=await scene('extend-id',value);
  await section.getByRole('button',{name:'读取清理任务',exact:true}).click();await section.getByText('时限与任务详情',{exact:true}).click();const inputs=section.getByRole('spinbutton');await inputs.first().fill('60');await section.getByRole('button',{name:'延长本次时限',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector<HTMLInputElement>('input[type=number]')?.value==='60');
  await page.waitForTimeout(250);const call=context.calls.find(c=>c.action==='extend');assert.ok(call);assert.equal(call.payload.id,'extend-id');assert.equal(call.payload.budgets.headersMs,60000);assert.equal(context.calls.filter(c=>c.action==='pi-remove-preview').length,0);passed.push('Pi延时桥接action/id/budgets绑定，不重启任务（合成）');await page.close();
 }
 {
  const value=installed('reconcile-id');value.job.task=task('reconcile-id','unknown');const {page,section,context}=await scene('reconcile-id',value);
  await section.getByRole('button',{name:'读取清理任务',exact:true}).click();await section.getByRole('button',{name:'核实中断任务',exact:true}).click();await section.getByRole('status').filter({hasText:'已取消'}).waitFor();assert.deepEqual(context.calls.find(c=>c.action==='reconcile').payload,{id:'reconcile-id'});assert.equal(context.calls.filter(c=>c.action==='pi-remove-preview').length,0);passed.push('Pi核实桥接action/id绑定，不重跑卸载（合成）');await page.close();
 }
 assert.deepEqual(errors,[]);writeFileSync(join(artifacts,'result.json'),JSON.stringify({passed:true,level:'Browser fixture only; synthetic IPC and data; no helper/native/system changes',scenarios:passed,calls,errors},null,2));console.log(JSON.stringify({passed:true,scenarios:passed.length,artifacts}));
}catch(error){writeFileSync(join(artifacts,'failure.json'),JSON.stringify({error:String(error),passed,calls,errors},null,2));await activePage?.screenshot({path:join(artifacts,'failure.png'),fullPage:true}).catch(()=>{});throw error;}
finally{await browser.close();await new Promise<void>(done=>server.close(()=>done()));}
