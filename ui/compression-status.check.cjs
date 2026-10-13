// Run: node compression-status.check.cjs
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(__dirname+'/coding-agent-v2-before-subagent-modal-v2.html','utf8');
const css=html.match(/\.compression-status svg\{([^}]+)\}/)[1];
for(const rule of ['width:20px','height:20px','fill:none','stroke:currentColor','stroke-width:2','flex-shrink:0'])assert(css.includes(rule),rule);
assert(html.includes('.compression-status[data-state=running] svg{animation:run-spin 2.8s linear infinite}'));
assert(html.includes('@keyframes run-spin{to{transform:rotate(360deg)}}'));
assert(html.includes('.compression-trigger svg,.compression-status svg{animation:none!important}'));
const source=html.slice(html.indexOf(" const status=$('compression-state');"),html.indexOf(" $('compression-description').textContent="));
let writes=0,markup='';
const status={dataset:{},get innerHTML(){return markup},set innerHTML(value){writes++;markup=value}};
const context=vm.createContext({$:id=>{assert.equal(id,'compression-state');return status},task:{state:'running'},running:true,done:false});
function render(state){context.task.state=state;context.running=state==='running';context.done=state==='completed';vm.runInContext(source,context);assert.equal(status.dataset.state,state);assert.equal((markup.match(/<svg/g)||[]).length,1);}
render('running');assert(markup.includes('M21 12a9'));assert(markup.includes('压缩进行中'));
render('running');assert.equal(writes,1,'定时刷新不应重建图标并重置旋转');
render('completed');assert(markup.includes('m5 12 4 4L19 6'));assert(!markup.includes('M21 12a9'));
render('running');render('cancelled');assert(markup.includes('m6 6 12 12'));assert(markup.includes('压缩已取消'));
render('running');assert(markup.includes('M21 12a9'));render('running');assert.equal(writes,5);
console.log('通过：慢速旋转、可见描边、刷新不中断、完成/取消停止、重试恢复及减少动态效果偏好');
