// Actual UI input in the owned production WebView2 session. No synthetic IPC and no system-changing submission.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';
const root=resolve(process.env.AXIOM_NATIVE_AUDIT_ROOT??'../artifacts/native-click-audit-20261025-layout-r2');
const session=JSON.parse(readFileSync(join(root,'active-native-session.json'),'utf8'));
assert.match(session.identifier,/^local\.axiom2\.desktop\.clickaudit\.r\d+$/);assert.ok(Number.isSafeInteger(session.pid));
assert.equal(createHash('sha256').update(readFileSync(session.exe)).digest('hex'),session.sha256);
function ps(command){return JSON.parse(execFileSync('powershell.exe',['-NoProfile','-EncodedCommand',Buffer.from("$ProgressPreference='SilentlyContinue';"+command,'utf16le').toString('base64')],{encoding:'utf8',timeout:30000}));}
const identity=ps(`$p=Get-Process -Id ${session.pid} -ErrorAction Stop;@{Id=$p.Id;Path=$p.Path;Responding=$p.Responding}|ConvertTo-Json -Compress`);
assert.equal(identity.Path.toLowerCase(),session.exe.toLowerCase());assert.equal(identity.Responding,true,'host must respond before further native input');
const out=mkdtempSync(join(session.run,'controls-clicks-')),browser=await chromium.connectOverCDP(session.endpoint);
const page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url()==='http://tauri.localhost/');assert.ok(page);page.setDefaultTimeout(20000);
const steps=[],events=[];page.on('pageerror',error=>events.push({type:'pageerror',message:String(error)}));page.on('console',message=>{if(['error','warning'].includes(message.type()))events.push({type:message.type(),message:message.text().slice(0,1500)});});
const button=(name,scope=page)=>scope.getByRole('button',{name,exact:true});
const section=name=>page.getByRole('region',{name,exact:true});
const prohibited=/确认(?:卸载|清理|安装|更新|恢复|关闭)|安装并启动服务|^安装 Node.js$|^安装 Tailscale$|^打开安装向导$/;
async function poll(condition,message,ms=30000){const until=Date.now()+ms;do{if(await condition())return;await delay(150);}while(Date.now()<until);throw Error(message);}
async function snapshot(name){const visible=await page.evaluate(()=>[...document.querySelectorAll('button,summary,input,[role=option]')].filter(e=>e.checkVisibility({contentVisibilityAuto:true})&&(!e.closest('dialog')||e.closest('dialog').open)).filter(e=>{for(let d=e.closest('details');d;d=d.parentElement?.closest('details'))if(!d.open&&!d.querySelector(':scope > summary')?.contains(e))return false;return true;}).map(e=>({tag:e.tagName,name:e.getAttribute('aria-label')||e.textContent?.trim()||'',disabled:!!e.disabled,value:e.tagName==='INPUT'?e.value:undefined})));const alerts=await page.getByRole('alert').allTextContents();await page.screenshot({path:join(out,name+'.png'),fullPage:true});writeFileSync(join(out,name+'.json'),JSON.stringify({visible,alerts,url:page.url()},null,2));return {alerts,visible};}
async function step(name,operation){const row={name,at:new Date().toISOString()};steps.push(row);try{row.evidence=await operation();row.outcome='verified';}catch(error){row.outcome='failed';row.error=String(error);}finally{row.snapshot=await snapshot(String(steps.length).padStart(2,'0')+'-'+name);writeFileSync(join(out,'result.json'),JSON.stringify({session,identity,steps,events,limits:'No system install/update/stop/uninstall/delete, no clipboard operations, no mocked installation state'},null,2));}return row;}
async function click(locator){assert.equal(await locator.count(),1,'exactly one native UI target');await locator.waitFor({state:'visible'});await poll(async()=>!await locator.isDisabled(),'control remained disabled after waiting for real in-flight native work');assert.ok(!prohibited.test((await locator.textContent())?.trim()??''),'system-changing submission prohibited');await locator.click();await delay(250);}
async function settled(locator){await poll(async()=>await locator.count()===1&&!await locator.isDisabled(),'native request did not settle');}
async function expand(summary){if(!await summary.evaluate(e=>e.parentElement.open))await click(summary);assert.equal(await summary.evaluate(e=>e.parentElement.open),true);}
const dialog=()=>page.getByRole('dialog',{name:'下载与维护'});
await step('updates-expand-precondition',async()=>{await expand(page.locator('summary').filter({hasText:'版本与更新 · Pi 引擎'}));});
if(!await dialog().count())await step('history-open',async()=>{await click(button('更新任务记录'));});
if(await dialog().count()){ 
 await step('history-native-loaded',async()=>{await dialog().locator('[data-online=true]').waitFor();assert.ok((await dialog().innerText()).includes('Pi 安装状态'));});
 for(const label of ['进行中','需处理','已结束','全部'])await step('history-filter-'+label,async()=>{const target=dialog().getByRole('navigation',{name:'任务筛选'}).getByRole('button',{name:new RegExp('^'+label)});await click(target);assert.equal(await target.getAttribute('aria-pressed'),'true');});
 await step('history-reread',async()=>{await click(button('重新读取',dialog()));await dialog().locator('[data-online=true]').waitFor();});
 await step('history-task-select',async()=>{const target=dialog().getByRole('navigation',{name:'下载任务'}).getByRole('button').first();await click(target);assert.equal(await target.getAttribute('aria-current'),'true');});
 await step('history-task-details',async()=>{const target=dialog().locator('summary').filter({hasText:'查看任务详情'});await expand(target);});
 await step('history-source',async()=>{await click(button('来源页面',dialog()));await dialog().waitFor({state:'detached'});});
}
await step('history-close-icon',async()=>{await click(button('更新任务记录'));await dialog().locator('[data-online=true]').waitFor();await click(button('关闭下载与维护',dialog()));await dialog().waitFor({state:'detached'});});
const localPort=page.getByRole('textbox',{name:'本地端口'}),originalPort=await localPort.inputValue();
for(const value of ['0','65536','abc'])await step('local-invalid-port-'+value,async()=>{await localPort.fill(value);await click(button('连接工作台'));await page.getByRole('alert').filter({hasText:'1–65535'}).waitFor();});
const lease=createServer();await new Promise(done=>lease.listen(0,'127.0.0.1',done));const closedPort=lease.address().port;await new Promise(done=>lease.close(done));
await step('local-closed-port',async()=>{await localPort.fill(String(closedPort));await click(button('连接工作台'));await settled(button('连接工作台'));const text=await page.locator('.target-connect [role=alert]').innerText();assert.ok(text.length);assert.ok(!text.includes('客户端响应超时'));assert.equal(page.url(),'http://tauri.localhost/');return {closedPort,error:text};});
await localPort.fill(originalPort);
await step('device-menu',async()=>{await click(page.getByRole('combobox',{name:'连接设备'}));await page.getByRole('listbox',{name:'连接设备列表'}).waitFor();});
await step('device-refresh',async()=>{await click(button('刷新设备'));await settled(button('刷新设备'));return {discoveryNotice:await page.locator('.device-discovery-error').allTextContents()};});
await step('device-manual',async()=>{await click(page.getByRole('option',{name:/手动输入地址/}));await page.getByRole('textbox',{name:'远程连接地址'}).waitFor();});
await step('remote-invalid-port',async()=>{await page.getByRole('textbox',{name:'远程连接地址'}).fill('127.0.0.1');await page.getByRole('textbox',{name:'远程端口'}).fill('0');await click(button('连接工作台'));await page.getByRole('alert').filter({hasText:'1–65535'}).waitFor();});
await step('device-return-local',async()=>{await click(page.getByRole('combobox',{name:'连接设备'}));await click(page.getByRole('option',{name:/本地电脑/}));await localPort.waitFor();});
await step('preparation-expand',async()=>{await expand(page.locator('summary').filter({hasText:'安装与准备'}));});
const preparation=section('本地连接准备');
for(const title of ['运行环境','后台服务','连接工作台'])await step('preparation-step-'+title,async()=>{const target=preparation.getByRole('navigation',{name:'准备步骤'}).getByRole('button',{name:new RegExp(title)});await click(target);assert.equal(await target.getAttribute('aria-current'),'step');});
await step('preparation-service-return',async()=>{await click(preparation.getByRole('navigation',{name:'准备步骤'}).getByRole('button',{name:/后台服务/}));await expand(preparation.locator('summary').filter({hasText:'手动安装与开发运行'}));assert.equal(await button('安装并启动服务',preparation).count(),1);return {installationNotSubmitted:true,copyNotTested:'requires lossless RAM-only clipboard guard'};});
await step('setup-history-open-close',async()=>{await click(button('安装任务记录',preparation));await dialog().locator('[data-online=true]').waitFor();assert.ok((await dialog().innerText()).includes('暂无任务'));await click(button('重新读取',dialog()));await click(button('关闭下载与维护',dialog()));await dialog().waitFor({state:'detached'});});
await step('environment-expand',async()=>{await expand(page.locator('summary').filter({hasText:'卸载与环境清理'}));});
const pi=section('终端 Pi 卸载');
await step('pi-read-no-task',async()=>{await click(button('读取清理任务',pi));await settled(button('读取清理任务',pi));assert.ok((await pi.innerText()).includes('暂无终端 Pi 卸载任务'));});
await step('pi-preview-empty',async()=>{assert.equal(existsSync(session.prefix),false,'keep real empty prefix, never fabricate installation');await click(button('预览 Pi 卸载',pi));await settled(button('预览 Pi 卸载',pi));const text=await pi.innerText();assert.ok(text.includes('未安装'),text);assert.equal(await pi.getByRole('alert').count(),0);assert.equal(await button('卸载此终端 Pi',pi).count(),0);assert.equal(existsSync(session.prefix),false);return {empty:true,prefixNotCreated:true};});
await step('pi-reread-preview-task',async()=>{await click(button('读取清理任务',pi));await settled(button('读取清理任务',pi));assert.equal(await pi.getByRole('alert').count(),0);});
for(const [name,label,read] of [['service','托管后台卸载','读取后台清理任务'],['archive','下载归档清理','读取归档清理任务']]){
 await step(name+'-preview',async()=>{const scope=section(label),target=button(name==='service'?'预览后台卸载':'预览下载归档',scope);await click(target);await settled(target);return {text:await scope.innerText(),submissionNotAttempted:true};});
 await step(name+'-read',async()=>{const scope=section(label),target=button(read,scope);await click(target);await settled(target);return {text:await scope.innerText()};});
}
const environment=section('安装环境扫描');
await step('environment-scan',async()=>{await click(button('扫描安装与残留',environment));await settled(button('重新扫描',environment));assert.equal(await environment.locator(':scope > [role=alert]').count(),0);await environment.locator('.environment-root').first().waitFor();});
const summaries=environment.locator('.environment-items > details > summary');
for(let i=0;i<await summaries.count();i++)await step('environment-item-'+i,async()=>{await expand(summaries.nth(i));return {name:await summaries.nth(i).innerText()};});
for(const title of ['候选命令来源','安装暂存与恢复材料','扫描范围与限制'])await step('environment-details-'+title,async()=>{await expand(environment.locator('summary').filter({hasText:title}));});
await step('environment-selected-missing',async()=>{const scope=section('指定旧目录只读扫描'),path=join(session.run,'nonexistent-read-only-target');assert.equal(existsSync(path),false);await scope.getByRole('textbox',{name:'旧目录完整路径'}).fill(path);await click(button('只读扫描指定目录',scope));await settled(button('只读扫描指定目录',scope));assert.equal(existsSync(path),false);return {text:await scope.innerText(),didNotCreateTarget:true};});
await step('tools-inventory',async()=>{const scope=section('工具与资源卸载'),target=button('读取可卸载项目',scope);await click(target);await settled(target);return {text:await scope.innerText()};});
const finalIdentity=ps(`$p=Get-Process -Id ${session.pid} -ErrorAction Stop;@{Path=$p.Path;Responding=$p.Responding}|ConvertTo-Json -Compress`);assert.equal(finalIdentity.Responding,true);
writeFileSync(join(out,'final.json'),JSON.stringify({steps:steps.map(({name,outcome,error})=>({name,outcome,error})),finalIdentity,events},null,2));console.log(JSON.stringify({out,verified:steps.filter(s=>s.outcome==='verified').length,failed:steps.filter(s=>s.outcome==='failed').map(({name,error})=>({name,error})),finalIdentity,events},null,2));process.exit(steps.some(s=>s.outcome==='failed')?1:0);
