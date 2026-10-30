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
const prohibited=/确认(?:卸载|清理|安装|更新|恢复|关闭)|安装并启动服务|^(?:安装|下载和安装|安装 Node.js|安装 Tailscale|打开安装向导)$/;
async function poll(condition,message,ms=30000){const until=Date.now()+ms;do{if(await condition())return;await delay(150);}while(Date.now()<until);throw Error(message);}
async function snapshot(name){const visible=await page.evaluate(()=>[...document.querySelectorAll('button,summary,input,[role=option]')].filter(e=>e.checkVisibility({contentVisibilityAuto:true})&&(!e.closest('dialog')||e.closest('dialog').open)).filter(e=>{for(let d=e.closest('details');d;d=d.parentElement?.closest('details'))if(!d.open&&!d.querySelector(':scope > summary')?.contains(e))return false;return true;}).map(e=>({tag:e.tagName,name:e.getAttribute('aria-label')||e.textContent?.trim()||'',disabled:!!e.disabled,value:e.tagName==='INPUT'?e.value:undefined})));const alerts=await page.getByRole('alert').allTextContents();await page.screenshot({path:join(out,name+'.png'),fullPage:true});writeFileSync(join(out,name+'.json'),JSON.stringify({visible,alerts,url:page.url()},null,2));return {alerts,visible};}
async function step(name,operation){const row={name,at:new Date().toISOString()};steps.push(row);try{row.evidence=await operation();row.outcome='verified';}catch(error){row.outcome='failed';row.error=String(error);}finally{row.snapshot=await snapshot(String(steps.length).padStart(2,'0')+'-'+name);writeFileSync(join(out,'result.json'),JSON.stringify({session,identity,steps,events,limits:'No system install/update/stop/uninstall/delete, no clipboard operations, no mocked installation state'},null,2));}return row;}
async function click(locator){assert.equal(await locator.count(),1,'exactly one native UI target');await locator.waitFor({state:'visible'});await poll(async()=>!await locator.isDisabled(),'control remained disabled after waiting for real in-flight native work');assert.ok(!prohibited.test((await locator.textContent())?.trim()??''),'system-changing submission prohibited');await locator.click();await delay(250);}
async function settled(locator){await poll(async()=>await locator.count()===1&&!await locator.isDisabled(),'native request did not settle');}
async function expand(summary){if(!await summary.evaluate(e=>e.parentElement.open))await click(summary);assert.equal(await summary.evaluate(e=>e.parentElement.open),true);}
await step('component-maintenance-without-center',async()=>{
 await section('版本与更新').waitFor();
 assert.equal(await section('版本与更新').locator('.update-component').count(),3);
 assert.equal(await page.getByRole('dialog',{name:'下载与维护'}).count(),0);
 assert.equal(await page.getByRole('button',{name:/^(更新任务记录|安装任务记录|关闭下载与维护)$/}).count(),0);
});
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
await step('preparation-expand',async()=>{await expand(page.locator('.startup-preparation > summary'));});
const preparation=section('本地连接准备');
for(const name of ['Node.js 与 npm安装维护','后台服务安装维护'])await step('preparation-card-'+name,async()=>{const card=preparation.getByRole('region',{name,exact:true});await card.waitFor();await expand(card.locator('summary').filter({hasText:'手动安装'}));assert.equal(await card.locator('.startup-command-block').count()>0,true);return {installationNotSubmitted:true,copyNotTested:'requires lossless RAM-only clipboard guard'};});
await step('environment-expand',async()=>{await expand(page.locator('.startup-maintenance > summary').filter({hasText:'组件管理'}));});
const pi=section('终端 Pi 卸载');
await step('pi-preview-empty',async()=>{assert.equal(existsSync(session.prefix),false,'keep real empty prefix, never fabricate installation');await click(button('卸载',pi));await settled(button('卸载',pi));const text=await pi.innerText();assert.ok(text.includes('未安装'),text);assert.equal(await pi.getByRole('alert').count(),0);assert.equal(await pi.getByRole('group',{name:'确认 Pi 卸载'}).count(),0);assert.equal(existsSync(session.prefix),false);return {empty:true,prefixNotCreated:true};});
await step('component-uninstall-cards',async()=>{const scope=section('已安装组件');assert.ok(await scope.locator('.component-card').count()>0);assert.equal(await scope.locator('.environment-cleanup-row,.environment-item').count(),0);return {text:await scope.innerText(),submissionNotAttempted:true};});
await step('tools-inventory',async()=>{const scope=section('工具与资源卸载'),target=button('刷新组件列表',scope);await click(target);await settled(target);return {text:await scope.innerText()};});
const finalIdentity=ps(`$p=Get-Process -Id ${session.pid} -ErrorAction Stop;@{Path=$p.Path;Responding=$p.Responding}|ConvertTo-Json -Compress`);assert.equal(finalIdentity.Responding,true);
writeFileSync(join(out,'final.json'),JSON.stringify({steps:steps.map(({name,outcome,error})=>({name,outcome,error})),finalIdentity,events},null,2));console.log(JSON.stringify({out,verified:steps.filter(s=>s.outcome==='verified').length,failed:steps.filter(s=>s.outcome==='failed').map(({name,error})=>({name,error})),finalIdentity,events},null,2));process.exit(steps.some(s=>s.outcome==='failed')?1:0);
