// Observe/click only an already-verified, separate native ClickAudit session. No IPC replacement.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';
const root=resolve(process.env.AXIOM_NATIVE_AUDIT_ROOT??'../artifacts/native-click-audit-20261025');
const session=JSON.parse(readFileSync(join(root,'active-native-session.json'),'utf8'));
assert.match(session.identifier,/^local\.axiom2\.desktop\.clickaudit(?:\.r\d+)?$/);assert.ok(Number.isSafeInteger(session.pid));
assert.equal(createHash('sha256').update(readFileSync(session.exe)).digest('hex'),session.sha256,'session binary identity changed');
const command=`$p=Get-Process -Id ${session.pid} -ErrorAction Stop;@{Id=$p.Id;Path=$p.Path;Title=$p.MainWindowTitle}|ConvertTo-Json -Compress`;
const identity=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')],{encoding:'utf8'}));
assert.equal(identity.Path.toLowerCase(),session.exe.toLowerCase());
const out=join(session.run,'initial-clicks');mkdirSync(out,{recursive:true});
const browser=await chromium.connectOverCDP(session.endpoint);
const page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url()==='http://tauri.localhost/');assert.ok(page);
page.setDefaultTimeout(15000);
const events=[],steps=[];page.on('pageerror',e=>events.push({type:'pageerror',message:e.message}));page.on('console',m=>{if(['error','warning'].includes(m.type()))events.push({type:m.type(),message:m.text().slice(0,2000)});});
async function snapshot(name){
 const visible=await page.evaluate(()=>[...document.querySelectorAll('button,summary,input,a[aria-label],[role=option]')].filter(e=>{if(!e.checkVisibility({contentVisibilityAuto:true}))return false;for(let d=e.closest('details');d;d=d.parentElement?.closest('details'))if(!d.open&&!d.querySelector(':scope > summary')?.contains(e))return false;return true;}).map(e=>({tag:e.tagName,name:e.getAttribute('aria-label')||e.textContent?.trim()||'',disabled:!!e.disabled,role:e.getAttribute('role')})));
 const errors=await page.locator('[role=alert],.connection-service-detail,.connection-status-tag,.connection-service .connect-message').allTextContents();
 await page.screenshot({path:join(out,name+'.png'),fullPage:true});writeFileSync(join(out,name+'.json'),JSON.stringify({visible,errors},null,2));return {visible,errors};
}
async function click(name,locator,check){
 const step={name,at:new Date().toISOString()};steps.push(step);
 try{assert.equal(await locator.count(),1,'must target exactly one real visible control');if(await locator.isDisabled()){step.outcome='disabled-observed; not clicked';return;}await locator.click();await delay(700);if(check)await check();step.outcome='clicked';}
 catch(error){step.outcome='failed';step.error=String(error);}
 finally{step.observation=await snapshot(String(steps.length).padStart(2,'0')+'-'+name);writeFileSync(join(out,'result.json'),JSON.stringify({session,identity,steps,events},null,2));}
}
await snapshot('00-before-clicks');
await click('theme-light',page.getByRole('button',{name:'切换到白天主题'}),()=>page.getByRole('button',{name:'切换到黑夜主题'}).waitFor());
if(steps.at(-1).outcome==='clicked')await click('theme-dark',page.getByRole('button',{name:'切换到黑夜主题'}),()=>page.getByRole('button',{name:'切换到白天主题'}).waitFor());
else steps.push({name:'theme-dark',outcome:'not-executed; prerequisite theme-light did not complete',at:new Date().toISOString()});
await click('service-refresh',page.getByRole('button',{name:'刷新服务状态'}));
await click('updates-expand',page.locator('summary').filter({hasText:'版本与更新 · Pi 引擎'}));
await click('update-history',page.getByRole('button',{name:'更新任务记录',exact:true}));
console.log(JSON.stringify({out,steps:steps.map(({name,outcome,error})=>({name,outcome,error})),events},null,2));process.exit(steps.some(s=>s.outcome==='failed')?1:0);
