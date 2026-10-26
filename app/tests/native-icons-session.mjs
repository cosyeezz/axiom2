// Real production-behaviour Tauri/WebView2 session. No IPC mocks or test-instance build.
// Launch only the separate clickaudit binary; never attach to/close the installed or user test app.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, openSync, closeSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { join, resolve, dirname } from 'node:path';
import { chromium } from 'playwright';
const root=resolve(process.env.AXIOM_NATIVE_AUDIT_ROOT??'../artifacts/native-click-audit-20261025');
const source=join(root,'source');
const config=JSON.parse(readFileSync(join(source,'app/desktop/pake.json'),'utf8'));
assert.match(config.identifier,/^local\.axiom2\.desktop\.clickaudit(?:\.r\d+)?$/);assert.match(config.name,/^Axiom2-ClickAudit(?:-R\d+)?$/);
const exe=join(source,'app',config.name+'.exe');
assert.ok(existsSync(exe),'build completion and static verification are prerequisites');
const bytes=readFileSync(exe);assert.equal(bytes.readUInt16LE(0),0x5a4d);
const built=JSON.parse(readFileSync(join(root,'04-artifacts.json'),'utf8').replace(/^\uFEFF/,'')).artifacts.find(item=>item.path.toLowerCase()===exe.toLowerCase());
assert.ok(built,'verified build artifact must exist');assert.equal(createHash('sha256').update(bytes).digest('hex'),built.sha256);assert.ok(bytes.includes(Buffer.from(config.identifier)),'must be distinct native identity');
for(const forbidden of ['axiom_test_probe','axiom-test-installer-launches.jsonl','AXIOM_DESKTOP_DEBUG_PORT'])assert.ok(!bytes.includes(Buffer.from(forbidden)),`test hook forbidden: ${forbidden}`);
if(process.argv.includes('--preflight')){console.log(JSON.stringify({stage:'read-only preflight; no launch',exe,identifier:config.identifier,sha256:built.sha256}));process.exit(0);}
const run=mkdtempSync(join(root,'native-session-')),data=join(run,'data'),prefix=join(run,'isolated npm ! & prefix'),profile=join(run,'webview-profile');
for(const path of [data,profile])mkdirSync(path,{recursive:true});
const userconfig=join(run,'empty-user.npmrc'),globalconfig=join(run,'empty-global.npmrc');writeFileSync(userconfig,'');writeFileSync(globalconfig,'');
const portServer=createServer();await new Promise(done=>portServer.listen(0,'127.0.0.1',done));const port=portServer.address().port;await new Promise(done=>portServer.close(done));
const endpoint=`http://127.0.0.1:${port}`;
const env={...Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.toLowerCase().startsWith('npm_config_'))),AXIOM_DATA_DIR:data,NPM_CONFIG_PREFIX:prefix,NPM_CONFIG_CACHE:join(run,'npm-cache'),NPM_CONFIG_USERCONFIG:userconfig,NPM_CONFIG_GLOBALCONFIG:globalconfig,WEBVIEW2_USER_DATA_FOLDER:profile,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1`};
env.PATH=`${prefix};${env.PATH??env.Path??''}`;delete env.AXIOM_DESKTOP_DEBUG_PORT;
const log=openSync(join(run,'native-process.log'),'a');
const child=spawn(exe,[],{cwd:dirname(exe),env,windowsHide:false,detached:true,stdio:['ignore',log,log]});closeSync(log);child.unref();
const session={createdAt:new Date().toISOString(),run,exe,sha256:createHash('sha256').update(bytes).digest('hex'),pid:child.pid,identifier:config.identifier,data,prefix,profile,endpoint,transport:'actual WebView2 CDP + real Tauri IPC; no page.route or __TAURI_INTERNALS__ replacement',testInstance:false,debugging:'standard external WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS; loopback only',userAndFormalClientsUntouched:true};
writeFileSync(join(root,'active-native-session.json'),JSON.stringify(session,null,2)+'\n');
try{
 let version;
 for(let n=0;n<120;n++){try{const response=await fetch(endpoint+'/json/version',{signal:AbortSignal.timeout(700)});if(response.ok){version=await response.json();break;}}catch{}await delay(500);}
 assert.ok(version,'WebView2 CDP endpoint did not become available; inspect native-process.log, do not claim native coverage');
 const browser=await chromium.connectOverCDP(endpoint);
 let page;
 for(let n=0;n<60;n++){page=browser.contexts().flatMap(c=>c.pages()).find(p=>/tauri|localhost/.test(p.url()));if(page)break;await delay(500);}
 assert.ok(page,'native controller target not found');
 await page.waitForLoadState('domcontentloaded');await page.locator('.startup-title').waitFor({timeout:60000});
 await delay(2500);
 const targets=await page.evaluate(()=>[...document.querySelectorAll('button,[role=combobox],summary,input,a[aria-label]')].filter(e=>{if(!e.checkVisibility({contentVisibilityAuto:true}))return false;for(let d=e.closest('details');d;d=d.parentElement?.closest('details'))if(!d.open&&!d.querySelector(':scope > summary')?.contains(e))return false;return true;}).map(e=>({tag:e.tagName,role:e.getAttribute('role'),name:e.getAttribute('aria-label')||e.textContent?.trim()||'',disabled:!!e.disabled,type:e.getAttribute('type'),text:e.tagName==='INPUT'?undefined:e.textContent?.trim()})));
 await page.screenshot({path:join(run,'00-native-initial.png'),fullPage:true});
 writeFileSync(join(run,'00-native-initial.json'),JSON.stringify({session,version,pageUrl:page.url(),targets},null,2)+'\n');
 console.log(JSON.stringify({passed:true,stage:'native session started and observed; no functional clicks yet',run,pid:child.pid,endpoint,url:page.url(),targets},null,2));
 // Explicit process exit disconnects CDP only. Keep this owned native app alive for later click stages.
 process.exit(0);
}catch(error){writeFileSync(join(run,'startup-failure.json'),JSON.stringify({error:String(error),session},null,2));console.error(String(error));process.exit(1);}
