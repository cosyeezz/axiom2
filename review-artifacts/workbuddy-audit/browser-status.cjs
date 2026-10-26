const {spawnSync}=require('node:child_process');
const {writeFileSync}=require('node:fs');
const cli='C:/Users/dane/AppData/Roaming/npm/node_modules/@jackwener/opencli/dist/src/main.js';
function run(...args){const p=spawnSync(process.execPath,[cli,...args],{encoding:'utf8',timeout:15000});let r;try{r=JSON.parse(p.stdout)}catch{throw Error('OpenCLI returned no JSON (exit '+p.status+')')}if(!r.ok)throw Error(r.error?.message||'OpenCLI failed');return r.data;}
const tabs=run('browser','chrome','call','tabs.query','[{}]');
const t=tabs.find(t=>t.url?.startsWith('http://127.0.0.1:4317/'));if(!t)throw Error('No main Axiom tab');
const active=tabs.find(x=>x.windowId===t.windowId&&x.active);
try{
 run('browser','chrome','call','windows.update',JSON.stringify([t.windowId,{focused:true}]));
 run('browser','chrome','call','tabs.update',JSON.stringify([t.id,{active:true}]));
 run('browser','unbind','--session','workbuddy-status');
 run('browser','bind','--session','workbuddy-status');
 const data=run('browser','eval',`({origin:location.origin,path:location.pathname,title:document.title,headings:[...document.querySelectorAll('h1,h2,h3,[role=heading]')].map(e=>e.textContent),dialogs:[...document.querySelectorAll('[role=dialog]')].map(e=>e.innerText.slice(0,6000)),buttons:[...document.querySelectorAll('button')].map(e=>({text:e.textContent,label:e.getAttribute('aria-label'),title:e.getAttribute('title')})).filter(e=>/模型|供应|CodeBuddy|WorkBuddy|Qoder|保存|设置|登录|连接/.test(JSON.stringify(e))).slice(0,40)})`,'--session','workbuddy-status');
 const result={checkedAt:new Date().toISOString(),...data};writeFileSync(__dirname+'/browser-main-status.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{if(active)run('browser','chrome','call','tabs.update',JSON.stringify([active.id,{active:true}]));}
