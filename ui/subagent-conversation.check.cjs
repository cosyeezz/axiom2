// Run: node subagent-conversation.check.cjs — no browser or dependencies.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const target = process.argv[2] || 'coding-agent-v2.html';
const html = fs.readFileSync(require('node:path').resolve(__dirname, target), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
new vm.Script(script);
const storage = new Map(), nodes = new Map(), timers = new Map();
let now = 1000, timerId = 0, copied = '';
function element(id = '') {
 const listeners = new Map(), attrs = new Map();let markup='';
 const el = {id, value:'', textContent:'', htmlWrites:0,
  get innerHTML(){return markup},set innerHTML(value){markup=value;this.htmlWrites++},style:{}, dataset:{}, files:[],
  scrollTop:0, scrollHeight:400, clientHeight:400, open:false, parent:null,
  classList:{add(){},remove(){},toggle(){},contains(){return false}},
  get attributes(){return [...attrs].map(([name,value])=>({name,value}))},
  setAttribute(k,v){attrs.set(k,String(v));this[k]=v},
  getAttribute(k){return attrs.get(k)}, removeAttribute(k){attrs.delete(k)},
  querySelectorAll(){return []}, querySelector(){return null}, contains(){return false},
  closest(){return null}, replaceChildren(){}, select(){}, click(){},
  focus(){context.document.activeElement=this},
  addEventListener(type,fn){listeners.set(type,[...(listeners.get(type)||[]),fn])},
  fire(type,event={}){for(const fn of listeners.get(type)||[])fn(event)},
  append(child){child.parent=this;if(child.id)nodes.set(child.id,child)},
  before(sibling){sibling.parent=this.parent},
  replaceWith(child){child.parent=this.parent;this.removed=true},
  remove(){nodes.delete(this.id)},
  cloneNode(){const copy=element();copy.parent=this.parent;copy.querySelector=()=>element();return copy},
  showModal(){this.open=true},close(){this.open=false;this.fire('close')}
 };
 return el;
}
function node(id){if(!nodes.has(id))nodes.set(id,element(id));return nodes.get(id)}
const context=vm.createContext({
 document:{activeElement:null,visibilityState:'visible',getElementById:id=>id==='run-state'?nodes.get(id):node(id),createElement:()=>element(),addEventListener(){}},
 window:{},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
 navigator:{clipboard:{async writeText(text){copied=text}}},
 matchMedia:()=>({matches:false,addEventListener(){}}),Date:class extends Date{static now(){return now}},structuredClone,console,
 setInterval:fn=>{timers.set(++timerId,fn);return timerId},clearInterval:id=>timers.delete(id),setTimeout,clearTimeout
});
const markdownEngine=html.match(/<script id="markdown-engine">([\s\S]*?)<\/script>/)?.[1];
if(markdownEngine)vm.runInContext(markdownEngine,context);
vm.runInContext(script,context);
const run=code=>vm.runInContext(code,context);
const send=()=>node('composer').onsubmit({preventDefault(){}});
const tick=ms=>{now+=ms;[...timers.values()].forEach(fn=>fn())};
const open=id=>run(`openSubagent(${JSON.stringify(id)}, {dataset:{agent:${JSON.stringify(id)}}})`);
const close=()=>node('subagent-dialog').close();
(async()=>{
 assert.equal(run('active'),'sample-subagents');
 assert.equal(run('current().subagents.length'),2);
 const parentMessages=run('current().messages.length');
 const cards=run('subagentConversation(1)');
 assert.equal((cards.match(/class="subagent"/g)||[]).length,2);
 assert(!cards.includes('<details'),'cards show tool calls without any disclosure');
 assert.equal((cards.match(/class="agent-tools"/g)||[]).length,2,'both cards show tool calls inline');
 const cardButtons=[...cards.matchAll(/<button\b[^>]*class="subagent"[\s\S]*?<\/button>/g)].map(m=>m[0]);
 for(const button of cardButtons){
  assert.match(button,/<small>[^<]*<span class="agent-tools"[^>]*> · 工具调用 2 次<\/span><\/small>/,'count shares the existing metadata line');
  assert(!button.includes('useDebounce.ts')&&!button.includes('clearTimeout(timer)'),'cards show counts, not tool details');
 }
 assert(html.includes('.agent-tools{display:inline;white-space:nowrap;'),'count does not add a row');
 assert(!cards.includes('展开记录'),'no expansion prompt on cards');
 assert.equal((cards.match(/class="subagent-card"/g)||[]).length,2);
 assert.equal(run('current().messages.find(m=>m.subagentDemo).activity'),undefined,'remove the standalone parent tool records');
 const fullRecords=run('executionDetails(current().subagents[0].messages.find(m=>m.activity).activity,"check")');
 assert(fullRecords.includes('src/hooks/useDebounce.ts')&&fullRecords.includes('useEffect 返回 clearTimeout(timer)'),'full tool input and output remain in the child conversation');
 run(`current().subagents[0].messages.push({role:'assistant',text:'状态检查',activity:[{label:'失败检查',status:'failed'},{label:'执行检查',status:'running'},'<unsafe>']})`);
 const liveSummary=run('agentToolSummary(current().subagents[0],1)');
 assert(liveSummary.includes('工具调用 5 次'),'count includes all tool records across messages');
 assert(!liveSummary.includes('失败检查')&&!liveSummary.includes('<unsafe>'),'tool details never appear in count');
 assert(run('agentToolSummary({id:"empty",messages:[{role:"user",text:"检查"}]},1)').includes('工具调用 0 次'),'empty agents show zero');
 run('current().subagents[0].messages.pop()');
 const exploreCalls=run('current().subagents[0].messages.find(m=>m.activity).activity');
 assert.equal(exploreCalls.length,2,'do not duplicate the original read/search summaries');
 assert.equal(exploreCalls[0].status,'completed');
 run('seedSubagentSessions()');
 assert.equal(run('current().subagents[0].messages.find(m=>m.activity).activity.length'),2,'migration is idempotent');
 assert(cards.includes('1 / 2 已完成 · 1 待确认'));
 assert(cards.includes('aria-haspopup="dialog"'));
 assert(cards.includes('演示记录'));
 assert(cards.includes('<header class="subagents-head"><svg'),'retain the delegation diagram');
 assert.equal((cards.match(/class="agent-state-label"/g)||[]).length,2,'each card retains a text status alongside its icon');
 assert(html.includes('.subagent .agent-state svg{grid-column:1'),'status icons lead the cards');
 for(const state of ['completed','waiting','failed','running'])assert(html.includes(`.subagent:has([data-state=${state}])`),'card tint follows live state');
 assert(html.includes('@media(max-width:480px){.subagent{grid-template-columns:32px minmax(0,1fr) 16px}'),'narrow cards reflow their status label');
 for(const state of ['idle','queued','running','waiting','completed','failed','stopped']){
  const setup=state==='running'?'demoRunning:true':state==='completed'?"messages:[{role:'assistant',text:'完成'}]":state==='stopped'?"messages:[{role:'assistant',text:'停止',stopped:true}]":`agentStatus:'${state}'`;
  assert(run(`agentStatusBadge({id:'check',parentId:'parent',messages:[],${setup}})`).includes(`data-state="${state}"`));
 }
 assert.equal(context.window.runSessionStatusChecks(),'会话状态检查通过','parent status contract unchanged');
 assert.equal(run('validSessions(sessions)'),true);
 assert.equal(run("validSessions([{id:'bad',title:'坏数据',workspaceId:'personal',messages:[],subagents:[null]}])"),false);
 const ids=[...cards.matchAll(/data-od-id="([^"]+)"/g)].map(m=>m[1]);
 assert.equal(ids.length,new Set(ids).size);
 const panel=node('content'),composer=node('composer'),messages=node('messages');
 const originalParent=element('app');panel.parent=originalParent;
 const handlers={submit:composer.onsubmit,copy:messages.onclick,model:node('model-list').onclick};
 node('prompt').value='主会话草稿';node('thread').scrollTop=123;
 run("attachment={name:'parent.ts',text:'parent file'}");
 open('invalid');assert.equal(run('active'),'sample-subagents');
 await messages.onclick({target:{closest:selector=>selector==='[data-agent]'?{dataset:{agent:'subagent-review'}}:null}});
 assert.equal(node('subagent-dialog').open,true,'card click opens the shared conversation dialog');
 assert.equal(node('content'),panel,'same live panel, not a new UI');
 assert.equal(panel.parent,node('subagent-dialog'));
 assert.equal(node('composer'),composer);
 assert.equal(composer.onsubmit,handlers.submit);
 assert.equal(messages.onclick,handlers.copy);
 assert.equal(node('model-list').onclick,handlers.model);
 assert.equal(run('active'),'subagent-review');
 assert.equal(run('attachment'),null);
 assert.equal(node('prompt').value,'');
 assert(node('messages').innerHTML.includes('class="activity"'));
 assert(node('messages').innerHTML.includes('message-body user-text'));
 assert(node('subagent-dialog-state').innerHTML.includes('待确认'));
 const closedEsc={key:'Escape',stopPropagation(){},preventDefault(){this.prevented=true}};
 node('model-picker').open=true;node('subagent-dialog').fire('keydown',closedEsc);
 assert(closedEsc.prevented);assert.equal(node('model-picker').open,false);
 assert.equal(node('subagent-dialog').open,true,'first Esc closes model picker only');
 const shortcut={key:'k',ctrlKey:true,stopPropagation(){},preventDefault(){this.prevented=true}};
 node('subagent-dialog').fire('keydown',shortcut);assert(shortcut.prevented);
 await messages.onclick({target:{closest:s=>s==='[data-copy]'?{dataset:{copy:'2'}}:null}});
 assert(copied.includes('Vitest'),'shared copy handler resolves child message');
 if(markdownEngine){
  const codeButton={closest:()=>({querySelector:()=>({textContent:'const value = "<safe>";\n'})})};
  await messages.onclick({target:{closest:s=>s==='[data-code-copy]'?codeButton:null}});
  assert.equal(copied,'const value = "<safe>";\n','code copy preserves literal characters and newlines');
 }
 node('prompt').value='使用 Vitest，继续细化测试';send();
 assert.equal(run('runs.has("subagent-review")'),true);
 assert.equal(node('send')['aria-label'],'停止生成');
 assert(node('subagent-dialog-state').innerHTML.includes('运行中'));
 const badgeWrites=node('subagent-dialog-state').htmlWrites;tick(1000);
 assert.equal(node('subagent-dialog-state').htmlWrites,badgeWrites,'timer updates must not reset spinner or live announcement');
 assert.equal(JSON.parse(storage.get('coding-agent-workspaces-v1')).active,'sample-subagents','reload returns to parent, not orphan child');
 node('prompt').value='子代理草稿';close();
 assert.equal(panel.parent,originalParent);
 assert.equal(run('active'),'sample-subagents');
 assert.equal(run('current().messages.length'),parentMessages,'child messages never enter parent');
 assert.equal(node('prompt').value,'主会话草稿');
 assert.equal(run('attachment.name'),'parent.ts');
 assert.equal(node('thread').scrollTop,123);
 assert.equal(run('runs.has("subagent-review")'),true,'closing dialog must not cancel child');
 assert(node('messages').innerHTML.includes('运行中'));
 tick(13000);
 assert.equal(run('runs.size'),0);
 assert.equal(run('sessionState(findSession("subagent-review"))'),'completed');
 open('subagent-review');
 assert.equal(node('prompt').value,'子代理草稿');
 assert(node('messages').innerHTML.includes('没有调用模型'));
 assert.equal(node('composer').onsubmit,handlers.submit,'reopening does not multiply handlers');
 send();tick(8000);send();
 assert.equal(run('sessionState(current())'),'stopped');
 assert(node('subagent-dialog-state').innerHTML.includes('已停止'));
 close();
 assert.equal(node('prompt').value,'主会话草稿');
 run("selectSession('sample-debounce')");
 assert.equal(node('chat-title').textContent,'为搜索输入添加防抖');
 assert(node('messages').innerHTML.includes('useDebounce.ts'));
 run("selectSession('sample-subagents');seedSubagentExample()");
 assert.equal(run('sessions.filter(s=>s.id==="sample-subagents").length'),1);
 assert.equal(run('current().subagents.length'),2);
 const saved=JSON.parse(storage.get('coding-agent-workspaces-v1'));
 assert.equal(saved.sessions.find(s=>s.id==='sample-subagents').subagents[1].messages.at(-1).stopped,true);
 const staticIds=[...html.matchAll(/\sid="([^"]+)"/g)].map(m=>m[1]);
 assert.equal(new Set(staticIds).size,staticIds.length,'static IDs unique');
 assert(!html.includes('class="agent-conversation"'));
 assert.equal((html.match(/id="composer"/g)||[]).length,1);
 assert.equal((html.match(/id="messages"/g)||[]).length,1);
 assert(!html.includes('scrollIntoView('));
 console.log('通过：工具调用仅显示数量、复用卡片现有信息行、无下方重复区域或展开入口、数量更新与零值、完整记录保留、会话交互与持久化');
})().catch(error=>{console.error(error);process.exitCode=1;});
