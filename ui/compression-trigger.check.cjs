// Run: node compression-trigger.check.cjs
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(__dirname+'/coding-agent-v2-before-subagent-modal-v2.html','utf8');
assert(html.includes('.compression-trigger[data-state=running] svg{animation:run-spin 2.8s linear infinite}'));
const initial=html.match(/<button[^>]*id="compression-trigger"[\s\S]*?<\/button>/)[0];
const initialShapes=initial.match(/<g data-state="idle">([\s\S]*?)<\/g>/)[1];
const icon={dataset:{state:'idle'},innerHTML:initialShapes};
const nodes=new Map();
function node(id){if(!nodes.has(id))nodes.set(id,{dataset:{},textContent:'',open:false,setAttribute(k,v){this[k]=v},querySelector(selector){assert.equal(selector,'svg > g');return icon},focus(){},close(){this.open=false},showModal(){this.open=true},addEventListener(){}});return nodes.get(id)}
let now=1000,next=0;const timers=new Map();
const source=html.slice(html.indexOf('const compressions=new Map();'),html.indexOf('function updateContextCapacity('));
const setup="let active='a';const sessions=new Map([['a',{id:'a',messages:[{role:'user',text:'测试'}]}],['b',{id:'b',messages:[]}]]);const findSession=id=>sessions.get(id),current=()=>findSession(active);";
const context=vm.createContext({$:node,Date:{now:()=>now},estimateTokens:t=>t.length,setInterval:fn=>{timers.set(++next,fn);return next},clearInterval:id=>timers.delete(id)});
vm.runInContext(setup+source,context);
const run=code=>vm.runInContext(code,context),button=node('compression-trigger');
function check(state,path){assert.equal(button.dataset.state,state);assert.equal(icon.dataset.state,state);if(state==='idle'||state==='completed'){assert.equal(icon.innerHTML,initialShapes);assert.equal((icon.innerHTML.match(/<rect/g)||[]).length,2)}else{assert.equal(icon.innerHTML,`<path d="${path}"/>`);assert(!icon.innerHTML.includes('<rect'));assert.equal((icon.innerHTML.match(/<path/g)||[]).length,1)}const shapes=icon.innerHTML;run('renderCompression()');assert.equal(icon.innerHTML,shapes)}
run('renderCompression()');check('idle');assert.equal(button.disabled,false);
button.onclick();check('running','M21 12a9 9 0 1 1-9-9');assert.equal(timers.size,1);assert.match(button['aria-label'],/进行中/);
// Background work remains owned by its session; empty sessions restore the original icon.
run("active='b';renderCompression()");check('idle');assert.equal(button.disabled,true);
now+=15000;[...timers.values()].forEach(fn=>fn());check('idle');assert.equal(timers.size,0);
run("active='a';renderCompression()");check('completed');assert.match(button['aria-label'],/已完成/);
// Second click opens details instead of starting another job. Keep the panel closed in this button-only check.
node('compression-page').showModal=function(){this.modalCalls=(this.modalCalls||0)+1};
button.onclick();assert.equal(node('compression-page').modalCalls,1);assert.equal(timers.size,0);assert.equal(run('compressionViewId'),'a');
node('compression-action').onclick();check('running','M21 12a9 9 0 1 1-9-9');assert.equal(timers.size,1);
node('compression-action').onclick();check('cancelled','m6 6 12 12m0-12L6 18');assert.equal(timers.size,0);assert.match(button['aria-label'],/已取消/);
node('compression-action').onclick();check('running','M21 12a9 9 0 1 1-9-9');
now+=15000;[...timers.values()].forEach(fn=>fn());check('completed');
run("active='b';renderCompression()");check('idle');
console.log('通过：压缩中慢速旋转、完成恢复列表图标、取消与重试、跨会话恢复、重复渲染、二次点击查看');
