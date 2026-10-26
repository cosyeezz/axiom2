// Real preparation navigation/checks and owned log path reveal. Never copy or install anything.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';
const root=resolve(process.env.AXIOM_NATIVE_AUDIT_ROOT??'../artifacts/native-click-audit-20261025-layout-r2'),session=JSON.parse(readFileSync(join(root,'active-native-session.json'),'utf8'));
assert.match(session.identifier,/^local\.axiom2\.desktop\.clickaudit\.r\d+$/);assert.ok(Number.isSafeInteger(session.pid));assert.equal(createHash('sha256').update(readFileSync(session.exe)).digest('hex'),session.sha256);
function ps(command){return JSON.parse(execFileSync('powershell.exe',['-NoProfile','-STA','-EncodedCommand',Buffer.from("$ProgressPreference='SilentlyContinue';"+command,'utf16le').toString('base64')],{encoding:'utf8',timeout:30000}));}
const identity=ps(`$p=Get-Process -Id ${session.pid} -ErrorAction Stop;@{Path=$p.Path;Responding=$p.Responding}|ConvertTo-Json -Compress`);assert.equal(identity.Path.toLowerCase(),session.exe.toLowerCase());assert.equal(identity.Responding,true);
const out=mkdtempSync(join(session.run,'preparation-clicks-')),browser=await chromium.connectOverCDP(session.endpoint),page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url()==='http://tauri.localhost/');assert.ok(page);page.setDefaultTimeout(20000);
const steps=[],button=(name,scope=page)=>scope.getByRole('button',{name,exact:true}),section=name=>page.getByRole('region',{name,exact:true});
async function poll(predicate,message,ms=40000){const end=Date.now()+ms;do{if(await predicate())return;await delay(200);}while(Date.now()<end);throw Error(message);}
async function click(target){assert.equal(await target.count(),1);await target.waitFor();await poll(async()=>!await target.isDisabled(),'control stayed disabled');assert.ok(!/确认(?:安装|更新|卸载|清理|关闭)|安装并启动服务|^安装 Node.js$|^安装 Tailscale$/.test(await target.innerText()));await target.click();await delay(400);}
async function expand(target){if(!await target.evaluate(e=>e.parentElement.open))await click(target);}
async function step(name,operation){const row={name,at:new Date().toISOString()};steps.push(row);try{row.evidence=await operation();row.outcome=row.evidence?.unavailable?'unavailable; not passed':'verified';}catch(error){row.outcome='failed';row.error=String(error);}await page.screenshot({path:join(out,String(steps.length).padStart(2,'0')+'-'+name+'.png'),fullPage:true});row.alerts=await page.getByRole('alert').allTextContents();writeFileSync(join(out,'result.json'),JSON.stringify({session,steps,limits:'No clipboard input, no install/stop/uninstall; no external-browser URL click yet'},null,2));return row;}
await step('preparation-open',()=>expand(page.locator('summary').filter({hasText:'安装与准备'})));
const local=section('本地连接准备');
await step('local-runtime',()=>click(local.getByRole('navigation',{name:'准备步骤'}).getByRole('button',{name:/运行环境/})));
await step('local-revalidate-environment',async()=>{const target=button('重新验证环境',local);await click(target);await poll(async()=>!await target.isDisabled(),'environment did not finish');assert.ok((await local.locator('.startup-check-result').innerText()).includes('npm 已就绪'));});
await step('local-next-service',async()=>{await click(button('下一步',local));await button('重新验证服务',local).waitFor();});
await step('local-revalidate-service',async()=>{const target=button('重新验证服务',local);await click(target);await poll(async()=>!await target.isDisabled(),'service status did not settle');assert.ok((await page.locator('.connection-service').innerText()).includes('未安装'));});
await step('setup-budget-open',()=>expand(local.locator('summary').filter({hasText:'首次安装下载设置'})));
const budget=local.locator('.maintenance-budget'),original=await budget.getByRole('spinbutton').evaluateAll(nodes=>nodes.map(n=>n.value)),changed=String(Number(original[0])+2);
await step('setup-budget-save-change',async()=>{await budget.getByRole('spinbutton').first().fill(changed);await click(button('保存设置',budget));await poll(async()=>!await button('保存设置',budget).isDisabled(),'budget save did not settle');assert.equal(await budget.getByRole('alert').count(),0);});
await step('setup-budget-native-reload',async()=>{await page.reload();await page.locator('.startup-title').waitFor();await expand(page.locator('summary').filter({hasText:'安装与准备'}));await expand(local.locator('summary').filter({hasText:'首次安装下载设置'}));await poll(async()=>await budget.getByRole('spinbutton').first().inputValue()===changed,'setup budget did not persist');return {seconds:await budget.getByRole('spinbutton').evaluateAll(nodes=>nodes.map(n=>n.value))};});
await step('setup-budget-restore',async()=>{for(let i=0;i<original.length;i++)await budget.getByRole('spinbutton').nth(i).fill(original[i]);await click(button('保存设置',budget));await poll(async()=>!await button('保存设置',budget).isDisabled(),'setup budget restore did not settle');assert.equal(await budget.getByRole('alert').count(),0);});
await step('remote-select-manual',async()=>{await click(page.getByRole('combobox',{name:'连接设备'}));await click(page.getByRole('option',{name:/手动输入地址/}));await section('远程连接准备').waitFor();});
const remote=section('远程连接准备');
await step('remote-network-step',()=>click(remote.getByRole('navigation',{name:'准备步骤'}).getByRole('button',{name:/连接环境/})));
await step('remote-revalidate-environment',async()=>{const target=button('重新验证环境',remote);await click(target);await poll(async()=>!await target.isDisabled(),'remote environment did not settle');return {status:await remote.locator('.startup-check-result').innerText()};});
await step('remote-next-connect',async()=>{const target=button('下一步',remote);if(!await target.count())return {unavailable:true,reason:'Tailscale not installed; do not install it'};await click(target);assert.equal(await remote.getByRole('navigation',{name:'准备步骤'}).getByRole('button',{name:/连接工作台/}).getAttribute('aria-current'),'step');});
await step('remote-return-network',()=>click(remote.getByRole('navigation',{name:'准备步骤'}).getByRole('button',{name:/连接环境/})));
await step('return-local-device',async()=>{await click(page.getByRole('combobox',{name:'连接设备'}));await click(page.getByRole('option',{name:/本地电脑/}));await local.waitFor();});
await step('updates-open',()=>expand(page.locator('summary').filter({hasText:'版本与更新 · Pi 引擎'})));
const updates=section('版本与更新'),logActions=updates.locator(':scope > .connect-log .local-path');
const expectedDirectory=join(session.data,'updates'),encodedDirectory=Buffer.from(expectedDirectory,'utf8').toString('base64');
function explorer(){return ps(`$s=New-Object -ComObject Shell.Application;$expected=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedDirectory}'));$matches=@();foreach($w in $s.Windows()){try{if(([Uri]$w.LocationURL).LocalPath -ieq $expected){$matches+=@{handle=[long]$w.HWND;path=([Uri]$w.LocationURL).LocalPath}}}catch{}};@{matches=$matches}|ConvertTo-Json -Compress -Depth 4`);}
await step('open-existing-log-folder',async()=>{assert.equal(await logActions.count(),1);assert.equal(existsSync(join(expectedDirectory,'update.log')),true);const before=explorer();await logActions.hover();await click(button('打开所在文件夹',logActions));await poll(async()=>!await button('打开所在文件夹',logActions).isDisabled(),'reveal did not return');assert.equal(await logActions.getByRole('alert').count(),0);let after;await poll(()=>{after=explorer();return after.matches.length>0;},'Explorer did not show the actual log directory',20000);return {before,after,folderOnly:true};});
await step('pi-location-expand',()=>expand(updates.locator('.connect-pi-location > summary')));
await step('missing-pi-folder-refusal',async()=>{const path=updates.locator('.connect-pi-location .local-path'),target=button('打开所在文件夹',path),packageRoot=await path.locator('.local-path-text').innerText();if(existsSync(packageRoot))return {unavailable:true,reason:'Not a missing path; no synthetic failure fixture used'};await path.hover();await click(target);await path.getByRole('alert').waitFor();const message=await path.getByRole('alert').innerText();assert.ok(message.length&&!message.includes('客户端响应超时'));assert.equal(existsSync(packageRoot),false);return {expectedMissingPathRefused:true,message};});
console.log(JSON.stringify({out,steps:steps.map(({name,outcome,error,evidence})=>({name,outcome,error,evidence}))},null,2));process.exit(steps.some(s=>s.outcome==='failed')?1:0);
