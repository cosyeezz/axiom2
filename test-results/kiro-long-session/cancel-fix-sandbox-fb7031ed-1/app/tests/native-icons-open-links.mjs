// Real OS link/application openings only; no install commands, clipboard access or VPN configuration.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';
const root=resolve(process.env.AXIOM_NATIVE_AUDIT_ROOT??'../artifacts/native-click-audit-20261025-layout-r2'),session=JSON.parse(readFileSync(join(root,'active-native-session.json'),'utf8'));
assert.match(session.identifier,/^local\.axiom2\.desktop\.clickaudit\.r\d+$/);assert.ok(Number.isSafeInteger(session.pid));assert.equal(createHash('sha256').update(readFileSync(session.exe)).digest('hex'),session.sha256);
const ps=command=>JSON.parse(execFileSync('powershell.exe',['-NoProfile','-EncodedCommand',Buffer.from("$ProgressPreference='SilentlyContinue';"+command,'utf16le').toString('base64')],{encoding:'utf8',timeout:30000}));
const identity=ps(`$p=Get-Process -Id ${session.pid} -ErrorAction Stop;@{Path=$p.Path;Responding=$p.Responding}|ConvertTo-Json -Compress`);assert.equal(identity.Path.toLowerCase(),session.exe.toLowerCase());assert.equal(identity.Responding,true);
const out=mkdtempSync(join(session.run,'open-links-')),browser=await chromium.connectOverCDP(session.endpoint),page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url()==='http://tauri.localhost/');assert.ok(page);page.setDefaultTimeout(20000);
const button=(name,scope=page)=>scope.getByRole('button',{name,exact:true}),section=name=>page.getByRole('region',{name,exact:true}),steps=[];
async function poll(predicate,message,ms=40000){const end=Date.now()+ms;do{if(await predicate())return;await delay(200);}while(Date.now()<end);throw Error(message);}
async function click(target){assert.equal(await target.count(),1);await target.waitFor();await poll(async()=>!await target.isDisabled(),'control did not settle');assert.ok(!/复制|安装并启动|^安装 Node.js$|^安装 Tailscale$|确认(?:安装|更新|卸载|清理|关闭)/.test((await target.innerText())+' '+(await target.getAttribute('aria-label')??'')));await target.click();await delay(500);}
async function step(name,operation){const row={name,at:new Date().toISOString()};steps.push(row);try{row.evidence=await operation();row.outcome=row.evidence?.unavailable?'unavailable; not passed':'verified';}catch(error){row.outcome='failed';row.error=String(error);}await page.screenshot({path:join(out,String(steps.length).padStart(2,'0')+'-'+name+'.png'),fullPage:true});row.alerts=await page.getByRole('alert').allTextContents();writeFileSync(join(out,'result.json'),JSON.stringify({session,steps,limits:'Opened real default-browser public URLs and existing Tailscale GUI only; did not configure VPN, close browser or install anything'},null,2));return row;}
function observeSite(site){return JSON.parse(execFileSync('powershell.exe',['-NoProfile','-STA','-ExecutionPolicy','Bypass','-File',join(import.meta.dirname,'fixtures/native-foreground-site.ps1'),'-Site',site],{encoding:'utf8',timeout:30000}));}
async function openSite(site,target,scope){await click(target);const observed=observeSite(site);assert.equal(await scope.getByRole('alert').count(),0);return {...observed,unavailable:!observed.matchedAddress||!observed.matchedTitle};}
const summary=page.locator('summary').filter({hasText:'安装与准备'});if(!await summary.evaluate(e=>e.parentElement.open))await click(summary);
const local=section('本地连接准备');
await step('node-download-navigation',()=>click(local.getByRole('navigation',{name:'准备步骤'}).getByRole('button',{name:/运行环境/})));
await step('node-open-real-download-url',()=>openSite('node',button('打开Node.js 下载地址',local),local));
await step('service-download-navigation',()=>click(local.getByRole('navigation',{name:'准备步骤'}).getByRole('button',{name:/后台服务/})));
await step('service-open-real-release-url',()=>openSite('release',local.getByRole('link',{name:'打开服务下载地址',exact:true}),local));
await step('remote-manual-select',async()=>{await click(page.getByRole('combobox',{name:'连接设备'}));await click(page.getByRole('option',{name:/手动输入地址/}));await section('远程连接准备').waitFor();});
const remote=section('远程连接准备');
await step('remote-network-navigation',()=>click(remote.getByRole('navigation',{name:'准备步骤'}).getByRole('button',{name:/连接环境/})));
await step('tailscale-open-real-download-url',()=>openSite('tailscale',button('打开Tailscale 下载地址',remote),remote));
await step('open-existing-tailscale',async()=>{const target=button('打开 Tailscale',remote);if(!await target.count())return {unavailable:true,reason:'Tailscale not installed; installation not permitted in this test'};const before=ps("@{processes=@(Get-Process -Name tailscale-ipn -ErrorAction SilentlyContinue|ForEach-Object{$_.Id})}|ConvertTo-Json -Compress");await click(target);await poll(async()=>!await target.isDisabled(),'Tailscale open did not return');assert.equal(await remote.getByRole('alert').count(),0);const after=ps("@{processes=@(Get-Process -Name tailscale-ipn -ErrorAction SilentlyContinue|ForEach-Object{$_.Id})}|ConvertTo-Json -Compress");return {before,after,unavailable:after.processes.length===0,configurationNotChangedByTest:true,guiVisibilityNotAsserted:true};});
await step('return-local',async()=>{await click(page.getByRole('combobox',{name:'连接设备'}));await click(page.getByRole('option',{name:/本地电脑/}));await local.waitFor();});
console.log(JSON.stringify({out,steps},null,2));process.exit(steps.some(s=>s.outcome==='failed')?1:0);
