// Native OS window resize/minimize + real theme IPC, only for our separate audit PID.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';
const root=resolve(process.env.AXIOM_NATIVE_AUDIT_ROOT??'../artifacts/native-click-audit-20261025-layout-r2'),session=JSON.parse(readFileSync(join(root,'active-native-session.json'),'utf8'));
assert.match(session.identifier,/^local\.axiom2\.desktop\.clickaudit\.r\d+$/);assert.ok(Number.isSafeInteger(session.pid));assert.equal(createHash('sha256').update(readFileSync(session.exe)).digest('hex'),session.sha256);
const out=mkdtempSync(join(session.run,'layout-clicks-'));
function windowAction(action,args=[]){return JSON.parse(execFileSync('powershell.exe',['-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',join(import.meta.dirname,'fixtures/native-owned-window.ps1'),'-TargetPid',String(session.pid),'-ExpectedExe',session.exe,'-Action',action,...args.map(String)],{encoding:'utf8',timeout:30000}));}
const original=windowAction('inspect');assert.equal(original.responding,true);
const browser=await chromium.connectOverCDP(session.endpoint),page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url()==='http://tauri.localhost/');assert.ok(page);page.setDefaultTimeout(20000);
const steps=[];
async function responsive(name,native){
 assert.equal(native.responding,true,'native message loop unresponsive');const before=page.getByRole('button',{name:/切换到(?:白天|黑夜)主题/});assert.equal(await before.count(),1);const nameBefore=await before.getAttribute('aria-label');await before.click();await page.getByRole('button',{name:nameBefore.includes('白天')?'切换到黑夜主题':'切换到白天主题'}).waitFor();
 const viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,documentWidth:document.documentElement.scrollWidth}));assert.ok(Math.abs(viewport.width*viewport.dpr-native.clientWidth)<=3,'real native child width must track actual OS client bounds');assert.ok(Math.abs(viewport.height*viewport.dpr-native.clientHeight)<=3,'real native child height must track actual OS client bounds');assert.ok(viewport.documentWidth<=viewport.width+2,'no horizontal document overflow');
 await page.screenshot({path:join(out,name+'.png'),fullPage:false});const row={name,native,viewport,themeIPC:true};steps.push(row);writeFileSync(join(out,'result.json'),JSON.stringify({session,original,steps},null,2));
}
let failure;
try{
 for(const [width,height] of [[1440,1000],[900,900],[600,950],[1400,900]]){const native=windowAction('resize',['-Width',width,'-Height',height]);await delay(600);await responsive('resize-'+width+'x'+height,native);}
 const minimized=windowAction('minimize');assert.equal(minimized.minimized,true);const restored=windowAction('restore');assert.equal(restored.minimized,false);await delay(600);await responsive('minimize-restore',restored);
}catch(error){failure=String(error);writeFileSync(join(out,'failure.json'),JSON.stringify({failure,session,steps},null,2));}
finally{const restored=windowAction('resize',['-Width',original.width,'-Height',original.height,'-Left',original.left,'-Top',original.top]);await delay(500);if(!failure)await responsive('original-bounds-restored',restored);else writeFileSync(join(out,'restore-after-failure.json'),JSON.stringify(restored,null,2));}
console.log(JSON.stringify({out,steps:steps.map(s=>({name:s.name,native:s.native,viewport:s.viewport,themeIPC:s.themeIPC})),failure},null,2));process.exit(failure?1:0);
