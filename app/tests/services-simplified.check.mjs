// B-level interaction regression: real React/Vite/Chromium, explicitly simulated native IPC.
// Never launches the native app, installs software, touches the clipboard, or calls a live backend.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const output = resolve(process.env.AXIOM_SIMPLIFIED_OUTPUT || 'test-results/services-simplified/browser');
await mkdir(output, { recursive: true });
const server = await createServer({ configFile: resolve('desktop/vite.config.ts'), server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const origin = server.resolvedUrls.local[0];
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER || undefined, headless: true });
const results = [], pages = [];
async function persist() { await writeFile(resolve(output, 'results.json'), JSON.stringify({ level: 'B', nativeIPC: 'simulated', results }, null, 2)); }
async function scenario(name, fn) {
  if (process.env.AXIOM_SIMPLIFIED_FILTER && !new RegExp(process.env.AXIOM_SIMPLIFIED_FILTER).test(name)) return;
  try { await fn(); results.push({ name, passed: true }); console.log('PASS', name); }
  catch (error) { results.push({ name, passed: false, error: String(error.stack || error) }); console.error('FAIL', name, error); for (const page of pages) if (!page.isClosed()) await page.screenshot({ path: resolve(output, `${name}-failure.png`), fullPage: true }).catch(() => {}); }
  finally { await persist(); for (const page of pages.splice(0)) await page.context().close(); }
}
async function fresh(config = {}) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await context.newPage(); page.setDefaultTimeout(6000); pages.push(page);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  page.fixtureErrors = errors;
  await page.addInitScript(config => {
    Object.defineProperty(navigator, 'platform', { value: config.platform || 'Win32' });
    const timer = window.setTimeout.bind(window), interval = window.setInterval.bind(window);
    window.setTimeout = (fn, ms, ...args) => timer(fn, [25000,55000,65000,75000,95000].includes(ms) ? 90 : ms === 1500 ? 70 : ms, ...args);
    window.setInterval = (fn, ms, ...args) => interval(fn, [1500,2000,3000].includes(ms) ? 80 : ms, ...args);
    const budgets = { headersMs:30000, idleMs:60000, installMs:600000, totalMs:1200000 };
    const state = {
      node: config.node !== false, downloaded: config.downloaded === true, service: config.service || 'missing', view: 'control', calls: [], unexpected: [], setupJob: null,
      update: { clientVersion:'0.4.1', serviceVersion:['running','stopped'].includes(config.service)?'0.4.1':null, managed:true, clientSupported:true, release:null, recovery:false, log:'', job:null,
        pi:{runtimeVersion:null,cli:{version:null},release:null} },
      setupMode: 'normal', removalMode: 'normal', updateMode: 'normal', cleanupMode: 'normal', controlsFailures: 0,
      holdRemote: false, remoteFailure: false, publish: true, held: {}, sequence: 0, revision: 0,
      tools: { resources:{revision:'r1',items:[],scopes:[],warnings:[]}, rea:{revision:'r1',version:null,engines:[]}, rtk:{revision:'r1'}, opencli:{revision:'r1',configured:true,cleanup:{revision:'a'.repeat(64),paths:['C:/isolated-test/opencli']}}, modelProxy:{revision:'r1',installations:{}} },
    };
    const clone = value => value === undefined ? undefined : structuredClone(value);
    function task(kind, status='running', id=`test-${++state.sequence}`) {
      const time=Date.now(); return {id,resource:kind,label:kind,action:kind,endpoint:'desktop',scope:'isolated-fixture',attemptId:id,status,phase:'downloading',steps:['downloading','verifying','installing'],completedSteps:status==='succeeded'?3:0,createdAt:time,startedAt:time,updatedAt:time,message:status==='running'?'仍在后台下载…':status==='failed'?'确定的测试失败':'测试记录已更新',budgets,capabilities:{cancel:status==='running',extend:status==='running'},...(status==='failed'?{error:{code:'network',message:'确定的下载失败',phase:'downloading'}}:{})};
    }
    function job(kind,status='running') {const t=task(kind,status); return {kind,action:kind,id:t.id,startedAt:t.createdAt,running:status==='running',phase:status==='succeeded'?'done':status==='failed'?'error':status==='unknown'?'interrupted':'running',message:t.message,task:t,lines:[]};}
    function hold(key,value) {return new Promise((resolve,reject)=>{state.held[key]={resolve:()=>resolve(clone(value)),reject:reason=>reject(reason)};});}
    state.makeJob=job;
    state.finishSetup=()=>{if(state.setupJob.action==='node')state.node=true;if(state.setupJob.action==='service'){state.service='stopped';state.downloaded=true;}state.setupJob={...state.setupJob,running:false,phase:'done',message:'安装完成',task:{...state.setupJob.task,status:'succeeded',completedSteps:3}};};
    state.publishPending=()=>{state.update.job=state.pendingJob;};
    state.release=(key,error)=>{const h=state.held[key];if(!h)throw Error(`No held invocation ${key}`); delete state.held[key];if(error)h.reject(error);else h.resolve();};
    window.fixture=state;
    if(config.interrupted)state.setupJob={...job('service','unknown'),repairable:config.repairable===true};
    if(config.oldJob) {state.update.job=job(config.oldJob,'succeeded');state.update.job.task.createdAt=1;}
    window.__TAURI_INTERNALS__={invoke:async(name,args={})=>{
      state.calls.push({name,args:clone(args)});
      if(name==='axiom_theme')return {theme:args.theme||'dark',revision:1};
      if(name==='axiom_setup') {
        if(args.action==='check')return {nodeReady:state.node,nodeVersion:'v24.19.0',writable:true,tailscale:true,platform:config.platform==='Linux'?'linux':'windows'};
        if(args.action==='status') {const snapshot={job:clone(state.setupJob),budgets};if(state.statusMode==='hold-once'){state.statusMode='normal';return hold(`status-${++state.sequence}`,snapshot);}return snapshot;}
        if(args.action==='uninstall-settings')return {opened:true};
        if(['service','node','tailscale'].includes(args.action)) {
          const next={...job(args.action),foreground:args.action==='service'&&config.foreground===true}; state.pendingSetup=next; if(state.setupMode==='malformed')return {job:{}}; if(state.setupMode!=='unaccepted')state.setupJob=next;
          if(state.setupMode!=='normal')return hold(`setup-${next.id}`,{job:next});
          return {job:clone(next)};
        }
        if(args.action==='reconcile-service') {state.setupJob={...state.setupJob,phase:'error',running:false,task:{...state.setupJob.task,status:'failed'}};return {job:clone(state.setupJob)};}
        return {opened:true};
      }
      if(name==='axiom_service') {
        if(args.action==='start'){if(state.startFailure)throw '测试启动失败';state.service='running';}
        if(args.action==='stop')state.service='stopped';
        return {state:state.service,active:[],desktopView:state.view,artifact:{download:{state:state.downloaded?'verified':'absent'},installation:{state:state.service==='missing'?'absent':'verified'}}};
      }
      if(name==='axiom_peers')return {peers:[{name:'Studio',ip:'100.64.0.8'},{name:'Laptop',ip:'100.70.1.2'}]};
      if(name==='axiom_controls') { ++state.revision;if(state.controlsFailures-->0)throw '测试屏障拒绝';state.view='control';return; }
      if(name==='axiom_connection')return 'connected';
      if(name==='axiom_local'||name==='axiom_remote') {
        const url=`http://${name==='axiom_local'?'127.0.0.1':args.address.replace(/^https?:\/\//,'')}:${args.port}/`;
        if(state.holdRemote)return hold(`remote-${++state.sequence}`,{url});
        if(state.remoteFailure)throw '测试目标连接失败';state.view='workbench';return {url};
      }
      if(name==='axiom_update') {
        const action=args.action;
        if(action==='service-remove-preview') {
          state.update.serviceRemoval={token:'service-token',version:'0.4.1',packageRoot:'/isolated-test/service',items:[{label:'后台程序',path:'/isolated-test/service',state:'remove'},{label:'项目与会话',state:'retain'}]};
          state.update.job=job(action,'succeeded');return clone(state.update);
        }
        if(action==='archive-preview') {
          state.update.archiveCleanup={token:'archive-token',items:[{id:'a'.repeat(64)+'-axiom2.tgz',label:'后台下载包',path:'/isolated-test/archive/axiom2.tgz',size:1024,state:'remove'}]};
          state.update.job=job(action,'succeeded');return clone(state.update);
        }
        if(action==='pi-remove-preview') {
          state.update.pi.removal={token:'once-only-token',installed:true,version:'0.61.0',packageRoot:'C:/isolated-test/npm/pi',items:[{label:'终端程序',path:'C:/isolated-test/npm/pi',state:'remove'},{label:'个人设置',path:'C:/isolated-test/settings',state:'retain'}]};
          state.update.job=job(action,'succeeded');return clone(state.update);
        }
        if(['pi-uninstall','service-uninstall','archive-remove','pi','service','client','recover'].includes(action)) {
          const next=job(action); state.pendingJob=next;
          if((['pi-uninstall','service-uninstall','archive-remove'].includes(action)?state.removalMode:state.updateMode)==='malformed')return {clientVersion:'0.4.1',job:{}};
          if(state.publish)state.update.job=next;
          const snapshot={...clone(state.update),job:clone(next)};
          if((['pi-uninstall','service-uninstall','archive-remove'].includes(action)?state.removalMode:state.updateMode)!=='normal')return hold(`update-${next.id}`,snapshot);
          return snapshot;
        }
        if(['cancel','reconcile','extend'].includes(action))return clone(state.update);
        if(action==='check') {state.update.release={version:'0.4.2',checkedAt:Date.now(),assets:{'Axiom2.msi':{url:'https://fixture.invalid/Axiom2.msi'}}};return clone(state.update);}
        if(action==='pi-check') {state.update.pi.release={version:'0.61.0',checkedAt:Date.now(),token:'pi-update-token'};return clone(state.update);}
        return clone(state.update);
      }
      if(name==='axiom_cleanup') {
        const {op,requestId}=args.request;
        if(op.endsWith('.get'))return {requestId,data:clone(state.tools[op.slice(0,-4)])};
        if(op==='opencli.uninstall') {
          const accepted={...clone(state.tools.opencli),job:{id:requestId,running:true,message:'正在卸载'}};
          if(state.cleanupMode==='hold')return hold(`cleanup-${requestId}`,{requestId,data:accepted});
          state.tools.opencli=accepted;return {requestId,data:clone(accepted)};
        }
      }
      if(name==='axiom_environment')return null; // Read-only inventory is deliberately unverified, never deletion evidence.
      state.unexpected.push({name,args});throw Error(`Unexpected simulated IPC ${name}`);
    }};
  }, config);
  await page.goto(origin); await page.locator('.startup-connect-button').waitFor();
  await page.waitForFunction(()=>window.fixture.calls.some(c=>c.name==='axiom_setup'&&c.args.action==='check'));
  await page.waitForTimeout(120);
  return page;
}
const primary = page=>page.locator('.startup-connect-button, .connection-primary-button:not([hidden])').last();
async function select(page,name) {await page.getByRole('combobox',{name:'连接设备',exact:true}).click();await page.getByRole('option',{name,exact:false}).click();}
async function calls(page,name,action) {return page.evaluate(({name,action})=>fixture.calls.filter(c=>c.name===name&&(action===undefined||c.args.action===action)),{name,action});}
async function waitFor(page,fn) {await page.waitForFunction(fn,undefined,{timeout:5000});}
async function noErrors(page) {assert.deepEqual(page.fixtureErrors,[]);assert.deepEqual(await page.evaluate(()=>fixture.unexpected),[]);}
async function environment(page) {await page.locator('.startup-maintenance > summary').filter({hasText:'组件管理'}).click();}
async function updates(page) {await page.locator('.updates-simple').scrollIntoViewIfNeeded();}
try {
  await scenario('missing-runtime-direct',async()=>{
    const p=await fresh({node:false});assert.equal(await primary(p).textContent(),'下载和安装');await primary(p).click();
    await waitFor(p,()=>fixture.setupJob?.action==='node');assert.equal((await calls(p,'axiom_setup','service')).length,0);
    assert.equal((await calls(p,'axiom_setup','node')).length,1);assert.equal(await p.locator('.startup-preparation').getAttribute('open'),null);
    await select(p,'Studio');await p.evaluate(()=>fixture.finishSetup());await waitFor(p,()=>fixture.setupJob?.action==='service');
    assert.equal((await calls(p,'axiom_setup','service')).length,1);await select(p,'本地电脑');await p.evaluate(()=>fixture.finishSetup());
    await primary(p).filter({hasText:'启动'}).waitFor();assert.equal((await calls(p,'axiom_service','start')).length,0);await noErrors(p);
  });
  await scenario('direct-install-switch-preserves-task',async()=>{
    const p=await fresh();assert.equal(await primary(p).textContent(),'下载和安装');await primary(p).click();
    await waitFor(p,()=>fixture.setupJob?.running);assert.equal((await calls(p,'axiom_setup','service')).length,1);
    assert.equal(await p.getByRole('combobox',{name:'连接设备'}).isEnabled(),true);assert.equal(await p.locator('.startup-preparation').getAttribute('open'),null);
    await select(p,'Studio');await p.getByRole('button',{name:'连接工作台',exact:true}).waitFor();
    await select(p,'本地电脑');assert.match(await primary(p).textContent(),/正在安装/);assert.equal((await calls(p,'axiom_setup','service')).length,1);
    await p.evaluate(()=>fixture.finishSetup());await primary(p).filter({hasText:'启动'}).waitFor();await noErrors(p);
  });
  await scenario('default-port-enter-connects-without-install',async()=>{
    const p=await fresh({node:false});await p.getByLabel('本地端口',{exact:true}).press('Enter');
    await p.locator('.desktop-workbench-bar:not([hidden])').waitFor();
    assert.equal((await calls(p,'axiom_local')).at(-1).args.port,4317);
    for(const action of ['node','service','reconcile-service'])assert.equal((await calls(p,'axiom_setup',action)).length,0);
    await noErrors(p);
  });
  for(const state of ['missing','unmanaged','interrupted','installing'])await scenario(`independent-default-connect-during-${state}`,async()=>{
    const p=await fresh({node:false,service:state==='unmanaged'?'unmanaged':'missing',interrupted:state==='interrupted'});
    if(state==='installing') {await p.evaluate(()=>fixture.setupJob=fixture.makeJob('service','running'));await p.waitForTimeout(160);}
    const connect=p.getByRole('button',{name:'连接工作台',exact:true});assert.equal(await connect.count(),1);assert.equal(await connect.isEnabled(),true);
    assert.match(await connect.textContent(),/连接/);const box=await connect.boundingBox();assert.ok(box&&box.height>=44);
    await connect.click();await p.locator('.desktop-workbench-bar:not([hidden])').waitFor();
    assert.equal((await calls(p,'axiom_local')).at(-1).args.port,4317);
    for(const action of ['node','service','reconcile-service'])assert.equal((await calls(p,'axiom_setup',action)).length,0);
    await noErrors(p);
  });
  await scenario('stopped-starts-running-closes-and-connection-remains-independent',async()=>{
    const p=await fresh({service:'stopped'});assert.equal(await primary(p).textContent(),'启动');await primary(p).click();
    await primary(p).filter({hasText:'关闭'}).waitFor();assert.equal((await calls(p,'axiom_service','start')).length,1);
    await primary(p).click();await p.getByRole('dialog').waitFor();assert.equal((await calls(p,'axiom_service','stop')).length,0);
    await p.getByRole('button',{name:'确认关闭服务',exact:true}).click();await primary(p).filter({hasText:'启动'}).waitFor();
    assert.equal((await calls(p,'axiom_service','stop')).length,1);assert.equal((await calls(p,'axiom_setup','service')).length,0);
    await p.getByRole('button',{name:'连接工作台',exact:true}).click();await p.locator('.desktop-workbench-bar:not([hidden])').waitFor();assert.equal((await calls(p,'axiom_local')).length,1);await noErrors(p);
  });
  await scenario('downloaded-package-installs-once-and-stays-installed-after-start-failure',async()=>{
    const p=await fresh({downloaded:true,foreground:true});assert.equal(await primary(p).textContent(),'安装');
    await primary(p).click();await waitFor(p,()=>fixture.setupJob?.running);
    const writes=await calls(p,'axiom_setup','service');assert.equal(writes.length,1);assert.equal(writes[0].args.confirmed,false);
    await p.evaluate(()=>fixture.finishSetup());await primary(p).filter({hasText:'启动'}).waitFor();
    await select(p,'Studio');await select(p,'本地电脑');await p.waitForTimeout(250);
    assert.equal(await primary(p).textContent(),'启动');assert.equal((await calls(p,'axiom_setup','service')).length,1);
    await p.evaluate(()=>fixture.startFailure=true);await primary(p).click();
    await p.getByText('测试启动失败',{exact:false}).first().waitFor();
    await primary(p).filter({hasText:'启动'}).waitFor();assert.equal((await calls(p,'axiom_service','start')).length,1);
    assert.equal((await calls(p,'axiom_setup','service')).length,1);
    await p.reload();await primary(p).filter({hasText:'安装'}).waitFor();
    assert.equal((await calls(p,'axiom_setup','service')).length,0);await noErrors(p);
  });
  await scenario('development-port-does-not-install',async()=>{
    const p=await fresh({node:false});await p.getByLabel('本地端口',{exact:true}).fill('8123');await primary(p).filter({hasText:'连接'}).waitFor();await primary(p).click();
    await p.locator('.desktop-workbench-bar:not([hidden])').waitFor();assert.equal((await calls(p,'axiom_setup','service')).length,0);assert.equal((await calls(p,'axiom_local')).at(-1).args.port,8123);await noErrors(p);
  });
  await scenario('legacy-unknown-explicit-foreground-repair-without-replay',async()=>{
    const p=await fresh({interrupted:true,repairable:true,foreground:true});
    assert.equal((await calls(p,'axiom_setup','service')).length,0);
    await primary(p).filter({hasText:'下载和安装'}).click();await waitFor(p,()=>fixture.setupJob?.running);
    assert.equal((await calls(p,'axiom_setup','reconcile-service')).length,0);
    assert.equal((await calls(p,'axiom_setup','service')).length,1);assert.equal((await calls(p,'axiom_setup','node')).length,0);
    await p.getByText('安装在可见终端执行，可以切换设备',{exact:true}).waitFor();await noErrors(p);
  });
  await scenario('explicit-reinstall-needs-consent-and-submits-once',async()=>{
    const p=await fresh({service:'stopped',foreground:true});await p.locator('.startup-preparation > summary').click();
    await p.getByRole('button',{name:'重新安装服务',exact:true}).click();
    await p.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();
    assert.equal((await calls(p,'axiom_setup','service')).length,0);
    await p.getByRole('button',{name:'重新安装服务',exact:true}).click();
    await p.getByRole('dialog').getByRole('button',{name:'前台重新安装',exact:true}).click();
    await waitFor(p,()=>fixture.setupJob?.running);
    assert.equal((await calls(p,'axiom_setup','service')).length,1);assert.equal((await calls(p,'axiom_setup','service'))[0].args.confirmed,true);assert.equal((await calls(p,'axiom_setup','reconcile-service')).length,0);
    assert.equal((await calls(p,'axiom_service','stop')).length,0);await noErrors(p);
  });
  await scenario('foreground-install-finished-does-not-claim-service-ready',async()=>{
    const p=await fresh({foreground:true});await primary(p).filter({hasText:'下载和安装'}).click();
    await waitFor(p,()=>fixture.setupJob?.running);
    await p.evaluate(()=>{fixture.setupJob={...fixture.setupJob,running:false,phase:'done',task:{...fixture.setupJob.task,status:'succeeded',completedSteps:3}};fixture.service='starting';});
    await primary(p).filter({hasText:'正在启动'}).waitFor();assert.equal(await primary(p).isDisabled(),true);
    assert.equal(await p.locator('.startup-connect-button').isEnabled(),true);assert.equal((await calls(p,'axiom_local')).length,0);
    assert.equal((await calls(p,'axiom_setup','service')).length,1);await noErrors(p);
  });
  await scenario('interrupted-primary-recovers-then-installs',async()=>{
    const p=await fresh({interrupted:true});await primary(p).filter({hasText:'下载和安装'}).waitFor();await primary(p).click();
    await waitFor(p,()=>fixture.setupJob?.running);assert.equal((await calls(p,'axiom_setup','reconcile-service')).length,1);
    assert.equal((await calls(p,'axiom_setup','service')).length,1);await noErrors(p);
  });
  await scenario('node-late-ack-survives-obsolete-status-without-replay',async()=>{
    const p=await fresh({node:false});await p.evaluate(()=>fixture.setupMode='unaccepted');await primary(p).click();
    await waitFor(p,()=>Object.keys(fixture.held).some(k=>k.startsWith('setup-')));await p.evaluate(()=>fixture.statusMode='hold-once');
    await waitFor(p,()=>Object.keys(fixture.held).some(k=>k.startsWith('status-')));
    await p.evaluate(()=>{fixture.setupJob=fixture.pendingSetup;fixture.setupMode='normal';fixture.release(Object.keys(fixture.held).find(k=>k.startsWith('setup-')));});
    await p.waitForTimeout(10);await p.evaluate(()=>fixture.release(Object.keys(fixture.held).find(k=>k.startsWith('status-'))));
    await p.evaluate(()=>fixture.finishSetup());await waitFor(p,()=>fixture.setupJob?.action==='service');
    assert.equal((await calls(p,'axiom_setup','node')).length,1);assert.equal((await calls(p,'axiom_setup','service')).length,1);await noErrors(p);
  });
  await scenario('failed-node-does-not-install-service',async()=>{
    const p=await fresh({node:false});await primary(p).click();await waitFor(p,()=>fixture.setupJob?.action==='node');
    await p.evaluate(()=>{fixture.setupJob.running=false;fixture.setupJob.phase='error';fixture.setupJob.message='系统安装被取消，请重试。';fixture.setupJob.task.status='failed';});
    await primary(p).filter({hasText:'下载和安装'}).waitFor();assert.equal((await calls(p,'axiom_setup','service')).length,0);
    assert.equal(await primary(p).isEnabled(),true);await noErrors(p);
  });
  await scenario('automatic-recovery-checking-continues-current-intent',async()=>{
    const p=await fresh({interrupted:true});await p.evaluate(()=>fixture.setupJob.recovery={state:'checking'});await p.waitForTimeout(100);
    await primary(p).click();await p.waitForTimeout(80);assert.equal((await calls(p,'axiom_setup','service')).length,0);
    await p.evaluate(()=>{fixture.setupJob.running=false;fixture.setupJob.phase='error';fixture.setupJob.task.status='failed';delete fixture.setupJob.recovery;});
    await waitFor(p,()=>fixture.setupJob?.running);assert.equal((await calls(p,'axiom_setup','reconcile-service')).length,0);
    assert.equal((await calls(p,'axiom_setup','service')).length,1);await noErrors(p);
  });
  await scenario('pi-install-prepares-version-before-single-confirmation',async()=>{
    const p=await fresh();await updates(p);await p.getByRole('button',{name:'安装终端 Pi',exact:true}).click();
    await p.getByRole('dialog').waitFor();assert.equal((await calls(p,'axiom_update','pi-check')).length,1);assert.equal((await calls(p,'axiom_update','pi')).length,0);
    await p.getByRole('button',{name:'确认安装 Pi',exact:true}).click();await waitFor(p,()=>fixture.update.job?.kind==='pi');
    const writes=await calls(p,'axiom_update','pi');assert.equal(writes.length,1);assert.equal(writes[0].args.version,'pi-update-token');await noErrors(p);
  });
  await scenario('service-update-prepares-version-before-single-confirmation',async()=>{
    const p=await fresh({service:'running'});await updates(p);await p.getByRole('button',{name:'更新后台服务',exact:true}).click();
    await p.getByRole('dialog').waitFor();assert.equal((await calls(p,'axiom_update','check')).length,1);assert.equal((await calls(p,'axiom_update','service')).length,0);
    await p.getByRole('button',{name:'确认更新服务',exact:true}).click();await waitFor(p,()=>fixture.update.job?.kind==='service');
    const writes=await calls(p,'axiom_update','service');assert.equal(writes.length,1);assert.equal(writes[0].args.version,'0.4.2');await noErrors(p);
  });
  await scenario('service-confirmation-binds-original-version',async()=>{
    const p=await fresh({service:'running'});await updates(p);await p.getByRole('button',{name:'更新后台服务',exact:true}).click();
    const dialog=p.getByRole('dialog');await dialog.waitFor();assert.match(await dialog.textContent(),/0\.4\.2/);
    await p.evaluate(()=>fixture.update.release.version='0.4.3');await p.waitForTimeout(220);
    assert.match(await dialog.textContent(),/更新后台至 0\.4\.2/);assert.equal(await dialog.getByRole('button',{name:'确认更新服务',exact:true}).isDisabled(),true);
    assert.equal((await calls(p,'axiom_update','service')).length,0);await noErrors(p);
  });
  for(const maintenance of ['pi-running','client-unconfirmed'])await scenario(`healthy-connect-during-${maintenance}`,async()=>{
    const p=await fresh({service:'running'});await updates(p);
    if(maintenance==='pi-running') {await p.evaluate(()=>fixture.update.job=fixture.makeJob('pi','running'));await p.waitForTimeout(200);}
    else {await p.evaluate(()=>{fixture.update.release={version:'0.4.2',checkedAt:Date.now(),assets:{'Axiom2.msi':{url:'https://fixture.invalid/Axiom2.msi'}}};fixture.updateMode='hold';fixture.publish=false;});await p.getByRole('button',{name:'下载客户端更新',exact:true}).click();await p.waitForTimeout(220);}
    const connect=p.getByRole('button',{name:'连接工作台',exact:true});assert.equal(await connect.textContent(),'连接');assert.equal(await connect.isEnabled(),true);
    await connect.click();await p.locator('.desktop-workbench-bar:not([hidden])').waitFor();
    assert.equal((await calls(p,'axiom_local')).length,1);assert.equal((await calls(p,'axiom_setup','service')).length,0);await noErrors(p);
  });
  await scenario('first-screen-is-status-and-actions-only',async()=>{
    const p=await fresh({oldJob:'check'});assert.equal(await p.getByRole('heading',{name:'服务与更新',exact:true}).count(),1);
    assert.equal(await p.locator('.updates-simple').getByText('任务完成',{exact:true}).count(),0);
    assert.equal(await p.locator('.startup-steps').count(),0);assert.equal(await p.locator('.updates-simple').isVisible(),true);
    for(const selector of ['.startup-preparation','.update-details','.startup-maintenance'])assert.equal(await p.locator(selector).first().getAttribute('open'),null);
    assert.equal(await p.locator('.connect-details:visible').count(),0);await noErrors(p);
  });
  await scenario('failed-barrier-can-retry',async()=>{
    const p=await fresh();await p.evaluate(()=>fixture.controlsFailures=1);await select(p,'Studio');
    await p.getByRole('button',{name:'连接工作台',exact:true}).click();await p.locator('.desktop-workbench-bar:not([hidden])').waitFor();
    assert.equal((await calls(p,'axiom_controls')).length,2);assert.equal((await calls(p,'axiom_remote')).length,1);await noErrors(p);
  });
  for(const reject of [false,true])await scenario(`old-remote-${reject?'error':'success'}-ignored`,async()=>{
    const p=await fresh();await p.evaluate(()=>fixture.holdRemote=true);await select(p,'Studio');await p.getByLabel('远程端口',{exact:true}).fill('7001');
    await p.getByRole('button',{name:'连接工作台',exact:true}).click();await waitFor(p,()=>Object.keys(fixture.held).some(k=>k.startsWith('remote-')));
    const key=await p.evaluate(()=>Object.keys(fixture.held).find(k=>k.startsWith('remote-')));await select(p,'Laptop');
    await p.evaluate(({key,reject})=>{fixture.holdRemote=false;fixture.release(key,reject?'旧设备错误':null);},{key,reject});
    await p.waitForTimeout(100);assert.equal(await p.locator('.connect-page').isVisible(),true);assert.equal(await p.getByText('旧设备错误',{exact:true}).count(),0);
    assert.equal(await p.getByRole('button',{name:'连接工作台',exact:true}).isEnabled(),true);
    await select(p,'Studio');await waitFor(p,()=>document.querySelector('input[aria-label="远程端口"]').value==='7001');assert.equal(await p.getByLabel('远程端口',{exact:true}).inputValue(),'7001');await noErrors(p);
  });
  await scenario('setup-late-running-cannot-revert-completed',async()=>{
    const p=await fresh();await p.evaluate(()=>fixture.setupMode='hold');await primary(p).click();
    await waitFor(p,()=>Object.keys(fixture.held).some(k=>k.startsWith('setup-')));await p.waitForTimeout(130);
    await p.evaluate(()=>fixture.finishSetup());await primary(p).filter({hasText:'启动'}).waitFor();
    await p.evaluate(()=>fixture.release(Object.keys(fixture.held).find(k=>k.startsWith('setup-'))));await p.waitForTimeout(100);
    assert.equal(await primary(p).textContent(),'启动');assert.equal((await calls(p,'axiom_setup','service')).length,1);await noErrors(p);
  });
  await scenario('setup-unconfirmed-refusal-unlocks-safely',async()=>{
    const p=await fresh();await p.evaluate(()=>fixture.setupMode='unaccepted');await primary(p).click();await p.waitForTimeout(130);
    assert.equal(await primary(p).isDisabled(),true);assert.equal(await p.getByRole('combobox',{name:'连接设备'}).isEnabled(),true);
    await p.evaluate(()=>fixture.release(Object.keys(fixture.held).find(k=>k.startsWith('setup-')),'已有安装任务正在执行或结果待核实。'));
    await primary(p).filter({hasText:'下载和安装'}).waitFor();assert.equal(await primary(p).isEnabled(),true);assert.equal((await calls(p,'axiom_setup','service')).length,1);await noErrors(p);
  });
  await scenario('component-list-and-once-confirmation',async()=>{
    const p=await fresh({service:'running'});await environment(p);
    const pi=p.getByRole('region',{name:'终端 Pi 卸载'});await pi.getByRole('button',{name:'卸载',exact:true}).click();await p.getByRole('group',{name:'确认 Pi 卸载'}).waitFor();
    assert.equal((await calls(p,'axiom_update','pi-uninstall')).length,0);await p.getByRole('group',{name:'确认 Pi 卸载'}).getByRole('button',{name:'取消',exact:true}).click();assert.equal((await calls(p,'axiom_update','pi-uninstall')).length,0);
    await pi.getByRole('button',{name:'卸载',exact:true}).click();await p.getByRole('group',{name:'确认 Pi 卸载'}).getByRole('checkbox').check();await p.getByRole('button',{name:'确认卸载',exact:true}).click();
    assert.equal((await calls(p,'axiom_update','pi-uninstall')).length,1);assert.equal(await p.getByRole('region',{name:'托管后台卸载'}).getByRole('button',{name:'卸载',exact:true}).isDisabled(),true);
    assert.equal(await p.getByRole('region',{name:'下载归档清理',includeHidden:true}).isVisible(),false);
    assert.equal(await p.getByRole('button',{name:/扫描|预览/}).count(),0);await noErrors(p);
  });
  await scenario('old-cleanup-controls-cannot-unlock-new-submit',async()=>{
    const p=await fresh();await environment(p);const pi=p.getByRole('region',{name:'终端 Pi 卸载'});
    await pi.getByRole('button',{name:'卸载',exact:true}).click();await p.getByRole('group',{name:'确认 Pi 卸载'}).getByRole('checkbox').check();
    await p.evaluate(()=>{fixture.removalMode='hold';fixture.publish=false;});await p.getByRole('button',{name:'确认卸载',exact:true}).click();await p.waitForTimeout(180);
    assert.equal(await pi.getByRole('button',{name:'正在核实…',exact:true}).isDisabled(),true);
    await p.evaluate(()=>{fixture.update.job.task.status='unknown';fixture.update.job.phase='interrupted';});
    await pi.getByRole('button',{name:'核实中断任务',exact:true}).click();await p.waitForTimeout(100);
    assert.equal(await pi.getByRole('button',{name:'正在核实…',exact:true}).isDisabled(),true);assert.equal((await calls(p,'axiom_update','pi-uninstall')).length,1);await noErrors(p);
  });
  for(const kind of ['pi','service','archive'])await scenario(`${kind}-late-A-cannot-unlock-B`,async()=>{
    const p=await fresh({service:'running',platform:'Linux'});await environment(p);
    const name={pi:'终端 Pi 卸载',service:'托管后台卸载',archive:'下载归档清理'}[kind],action={pi:'pi-uninstall',service:'service-uninstall',archive:'archive-remove'}[kind];
    const section=p.getByRole('region',{name});
    async function submit() {
      await section.getByRole('button',{name:kind==='archive'?'清理':'卸载',exact:true}).first().click();
      const confirmation=section.getByRole('group',{name:kind==='archive'?'确认归档清理':kind==='service'?'确认后台卸载':'确认 Pi 卸载',exact:true});await confirmation.waitFor();
      if(kind!=='archive')await confirmation.getByRole('checkbox').check();
      await confirmation.getByRole('button',{name:kind==='archive'?'确认清理':kind==='service'?'确认卸载后台':'确认卸载',exact:true}).click();
    }
    await p.evaluate(()=>{fixture.removalMode='hold';});await submit();await p.waitForTimeout(200);
    const first=await p.evaluate(()=>Object.keys(fixture.held).find(key=>key.startsWith('update-')));
    await p.evaluate(()=>{const old=fixture.update.job;fixture.update.job={...old,running:false,phase:'error',task:{...old.task,status:'failed',error:{code:'operation',message:'第一次清理未完成',phase:'removing'}}};});
    await section.getByRole('button',{name:kind==='archive'?'清理':'卸载',exact:true}).first().waitFor();
    await p.evaluate(()=>fixture.publish=false);await submit();await p.waitForTimeout(200);
    await p.evaluate(key=>fixture.release(key),first);await p.waitForTimeout(100);
    assert.equal(await section.getByRole('button',{name:'正在核实…',exact:true}).isDisabled(),true);assert.equal((await calls(p,'axiom_update',action)).length,2);await noErrors(p);
  });
  for(const kind of ['pi','service','archive'])await scenario(`${kind}-reconciled-removal-allows-fresh-preflight-only`,async()=>{
    const p=await fresh({service:'running',platform:'Linux'});await environment(p);
    const name={pi:'终端 Pi 卸载',service:'托管后台卸载',archive:'下载归档清理'}[kind],action={pi:'pi-uninstall',service:'service-uninstall',archive:'archive-remove'}[kind],previewAction={pi:'pi-remove-preview',service:'service-remove-preview',archive:'archive-preview'}[kind];
    const section=p.getByRole('region',{name}),start=section.getByRole('button',{name:kind==='archive'?'清理':'卸载',exact:true}).first();
    const confirmation=()=>section.getByRole('group',{name:kind==='archive'?'确认归档清理':kind==='service'?'确认后台卸载':'确认 Pi 卸载',exact:true});
    await start.click();await confirmation().waitFor();if(kind!=='archive')await confirmation().getByRole('checkbox').check();
    await p.evaluate(()=>fixture.removalMode='hold');await confirmation().getByRole('button',{name:kind==='archive'?'确认清理':kind==='service'?'确认卸载后台':'确认卸载',exact:true}).click();await p.waitForTimeout(200);
    await p.evaluate(()=>{fixture.update.job.running=false;fixture.update.job.phase='interrupted';fixture.update.job.task.status='interrupted';});await p.waitForTimeout(180);assert.equal(await start.isDisabled(),true);
    await p.evaluate(()=>fixture.update.job.reconciled=true);await start.waitFor();await waitFor(p,()=>Array.from(document.querySelectorAll('.environment-item button')).some(b=>['卸载','清理'].includes(b.textContent)&&!b.disabled));await p.waitForTimeout(120);assert.equal(await start.isEnabled(),true);
    assert.equal((await calls(p,'axiom_update',action)).length,1);await start.click();await confirmation().waitFor();assert.equal((await calls(p,'axiom_update',previewAction)).length,2);assert.equal((await calls(p,'axiom_update',action)).length,1);await noErrors(p);
  });
  for(const rejection of [false,true])await scenario(`update-late-A-${rejection?'rejection':'snapshot'}-cannot-unlock-B`,async()=>{
    const p=await fresh();await updates(p);
    await p.evaluate(()=>{fixture.update.release={version:'0.4.2',checkedAt:Date.now(),assets:{'Axiom2.msi':{url:'https://fixture.invalid/Axiom2.msi'}}};fixture.updateMode='hold';});
    const download=p.getByRole('button',{name:'下载客户端更新',exact:true});await download.click();await p.waitForTimeout(200);
    const first=await p.evaluate(()=>Object.keys(fixture.held).find(key=>key.startsWith('update-')));
    await p.evaluate(()=>{const old=fixture.update.job;fixture.update.job={...old,running:false,phase:'error',task:{...old.task,status:'failed',error:{code:'network',message:'第一次下载未完成',phase:'downloading'}}};fixture.publish=false;});
    await waitFor(p,()=>Array.from(document.querySelectorAll('button')).some(b=>b.getAttribute('aria-label')==='下载客户端更新'&&!b.disabled));await download.click();await p.waitForTimeout(200);
    await p.evaluate(({first,rejection})=>fixture.release(first,rejection?'已有更新正在进行，请等待完成。':null),{first,rejection});await p.waitForTimeout(100);
    assert.equal(await download.isDisabled(),true);assert.equal((await calls(p,'axiom_update','client')).length,2);await noErrors(p);
  });
  await scenario('tool-unknown-keeps-submit-lock',async()=>{
    const p=await fresh({service:'running'});await environment(p);const tool=p.getByRole('region',{name:'工具与资源卸载'});await tool.getByText('OpenCLI',{exact:true}).waitFor();
    await tool.locator('.environment-cleanup-row').filter({hasText:'OpenCLI'}).getByRole('button',{name:'卸载',exact:true}).click();
    await p.getByRole('group',{name:'确认工具清理范围'}).waitFor();await p.evaluate(()=>fixture.cleanupMode='hold');await tool.getByRole('button',{name:'确认卸载',exact:true}).click();await p.waitForTimeout(180);
    assert.equal(await tool.getByRole('button',{name:'关闭',exact:true}).count(),0);assert.equal(await tool.locator('.environment-cleanup-row').filter({hasText:'OpenCLI'}).getByRole('button',{name:'卸载',exact:true}).isDisabled(),true);
    assert.equal(await p.evaluate(()=>JSON.parse(sessionStorage.getItem('axiom.desktop.cleanup.pending')).accepted),false);
    assert.equal((await calls(p,'axiom_cleanup')).filter(c=>c.args.request.op==='opencli.uninstall').length,1);await noErrors(p);
  });
  await scenario('unknown-and-running-not-failed',async()=>{
    const p=await fresh();await updates(p);await p.evaluate(()=>{fixture.update.job=fixture.makeJob('pi','running');fixture.update.job.task.error={code:'idle-timeout',message:'未核实的旧错误',phase:'downloading'};});
    await p.getByText('仍在后台下载…',{exact:false}).first().waitFor();assert.equal(await p.getByRole('alert').filter({hasText:'未核实的旧错误'}).count(),0);
    await p.evaluate(()=>{fixture.update.job=fixture.makeJob('pi','unknown');});await p.getByText('任务结果待核实',{exact:false}).first().waitFor();
    assert.equal(await p.getByRole('alert').filter({hasText:'任务结果待核实'}).count(),0);
    await p.evaluate(()=>{fixture.update.job=fixture.makeJob('pi','failed');});await p.getByRole('alert').filter({hasText:'确定的下载失败'}).first().waitFor();await noErrors(p);
  });
  await scenario('tailscale-fixed-settings-not-success-claim',async()=>{
    const p=await fresh();await environment(p);const row=p.getByRole('region',{name:'Tailscale 卸载'});await row.getByRole('button',{name:'卸载',exact:true}).click();
    await row.getByText('已打开系统应用列表，请选择 Tailscale 完成卸载。',{exact:true}).waitFor();assert.equal((await calls(p,'axiom_setup','uninstall-settings')).length,1);assert.equal(await row.getByText('已卸载',{exact:true}).count(),0);await noErrors(p);
  });
  await scenario('malformed-setup-ack-keeps-unknown-lock',async()=>{
    const p=await fresh();await p.evaluate(()=>fixture.setupMode='malformed');await primary(p).click();await p.waitForTimeout(200);
    assert.equal(await primary(p).isDisabled(),true);assert.equal((await calls(p,'axiom_setup','service')).length,1);assert.equal(await p.getByRole('combobox',{name:'连接设备'}).isEnabled(),true);assert.equal(await p.getByRole('alert').filter({hasText:'响应不完整'}).count(),0);await noErrors(p);
  });
  await scenario('malformed-removal-ack-keeps-unknown-lock',async()=>{
    const p=await fresh();await environment(p);const pi=p.getByRole('region',{name:'终端 Pi 卸载'});
    await pi.getByRole('button',{name:'卸载',exact:true}).click();await p.getByRole('group',{name:'确认 Pi 卸载'}).getByRole('checkbox').check();
    await p.evaluate(()=>fixture.removalMode='malformed');await p.getByRole('button',{name:'确认卸载',exact:true}).click();await p.waitForTimeout(200);
    assert.equal(await pi.getByRole('button',{name:'正在核实…',exact:true}).isDisabled(),true);assert.equal((await calls(p,'axiom_update','pi-uninstall')).length,1);assert.equal(await pi.getByRole('alert').count(),0);await noErrors(p);
  });
  await scenario('reconciled-update-can-check-and-only-recover-pending-service',async()=>{
    const p=await fresh();await updates(p);await p.evaluate(()=>fixture.update.job=fixture.makeJob('pi','unknown'));
    const check=p.getByRole('button',{name:'检查 Pi 更新',exact:true});await waitFor(p,()=>Array.from(document.querySelectorAll('button')).some(b=>b.getAttribute('aria-label')==='检查 Pi 更新'&&b.disabled));
    await p.evaluate(()=>{fixture.update.job.reconciled=true;fixture.update.job.task.status='interrupted';});
    await waitFor(p,()=>Array.from(document.querySelectorAll('button')).some(b=>b.getAttribute('aria-label')==='检查 Pi 更新'&&!b.disabled));assert.equal(await check.isEnabled(),true);
    await p.evaluate(()=>{fixture.update.job.servicePending=true;fixture.update.recovery=true;});await p.getByRole('button',{name:'恢复旧版本',exact:true}).waitFor();await waitFor(p,()=>Array.from(document.querySelectorAll('button')).some(b=>b.getAttribute('aria-label')==='检查 Pi 更新'&&b.disabled));
    assert.equal(await check.isDisabled(),true);assert.equal(await p.getByRole('button',{name:'恢复旧版本',exact:true}).isEnabled(),true);await noErrors(p);
  });
  await scenario('responsive-dark-light',async()=>{
    const p=await fresh();
    for(const theme of ['dark','light'])for(const width of [1440,1100,600,390,360]) {
      await p.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await p.setViewportSize({width,height:900});
      assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${theme}/${width}: no horizontal overflow`);
      const box=await primary(p).boundingBox();assert.ok(box&&box.width>=width*.45&&box.height>=44,`${theme}/${width}: prominent accessible primary`);
      await p.screenshot({path:resolve(output,`${theme}-${width}.png`),fullPage:true});
      await p.getByRole('combobox',{name:'连接设备'}).click();const menu=await p.locator('.device-menu').boundingBox();assert.ok(menu&&menu.x>=0&&menu.x+menu.width<=width+1);await p.keyboard.press('Escape');
    }
    await noErrors(p);
  });
} finally { await persist();await browser.close();await server.close(); }
const failed=results.filter(r=>!r.passed);console.log(`${results.length-failed.length}/${results.length} scenarios passed; B-level only. ${output}`);if(failed.length)process.exitCode=1;
