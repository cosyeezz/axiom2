// 运行："$OD_NODE_BIN" test-account-icons.cjs（无需网络或浏览器）
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(`${__dirname}/account-manager-compact-v2.html`, 'utf8');
const nodes = new Map(), listeners = {};
const node = id => {
  if (!nodes.has(id)) nodes.set(id, {id,innerHTML:'', textContent:'', value:'', open:false, listeners:{},
    focus(){context.document.activeElement=this},select(){this.selectionStart=0;this.selectionEnd=this.value.length},
    setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end},setCustomValidity(value){this.validationMessage=value},reportValidity(){},
    addEventListener(type, fn) {this.listeners[type] = fn}, setAttribute() {},
    showModal() {this.open = true}, close() {this.open = false}});
  return nodes.get(id);
};
const dispatched=[];
const context = vm.createContext({console, structuredClone, Intl, Date, setTimeout, clearTimeout,
  CustomEvent:class {constructor(type,options){this.type=type;this.detail=options.detail}},
  document:{getElementById:node, querySelectorAll:()=>[], dispatchEvent:event=>dispatched.push(event), addEventListener:(type, fn)=>listeners[type]=fn}});
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
assert.equal(scripts.length, 2);
assert(html.includes('width:368px;height:440px'), '所有卡片使用固定宽高');
assert(!/(?:^|[;{])\s*columns:\s*\d|\.account-card\s*\{[^}]*min-height/.test(html), '没有瀑布流或移动端高度覆盖');
assert(html.includes('grid-template-columns:repeat(auto-fill,minmax(0,368px))'), '卡片按行对齐');
assert(html.includes('overflow-y:auto;overflow-x:hidden'), '超出字段仍可内部滚动');
assert(/\.card-body \{[^}]*scrollbar-width:none/.test(html), 'Firefox 隐藏卡片滚动条');
assert(html.includes('.card-body::-webkit-scrollbar {display:none;width:0;height:0}'), 'WebKit 隐藏卡片滚动条');
assert(!html.includes('scrollbar-gutter:stable') && !/\.card-body::-webkit-scrollbar-(?:track|thumb)/.test(html), '不保留轨道占位及可见滑块');
for (const selector of ['.quota-number', '.quota-number.precise']) {
  assert(html.includes(`${selector} {font-size:18px;`), '普通额度与高精度点数均为18px');
}
for (const [, script] of scripts) new vm.Script(script).runInContext(context);
const run = source => vm.runInContext(source, context);
const click = dataset => listeners.click({target:{closest:selector=>selector==='[data-action]'?{dataset}:null}});
(async () => {
  for (const name of ['refresh-cw', 'circle-user-round', 'search', 'plus', 'x', 'arrow-right']) {
    assert(html.includes(`data-icon="lucide:${name}"`), name);
  }
  assert(html.includes('Copyright (c) 2026 Lucide Icons and Contributors'));
  assert(html.includes('Copyright (c) 2013-present Cole Bemis'));
  assert(html.includes('Simple Icons 使用 CC0 1.0'));
  const resolvedSVG=run('Object.values(icons).join("")');
  for (const [svg] of resolvedSVG.matchAll(/<svg\b[\s\S]*?<\/svg>/g)) {
    assert(svg.includes('viewBox="0 0 24 24"'));
    assert(svg.includes('aria-hidden="true"') && svg.includes('focusable="false"'));
    assert(/data-icon="(?:lucide|simple-icons|ri):/.test(svg));
    assert(!/<(?:script|image|foreignObject)\b|\bon\w+=|\bhref=/.test(svg));
  }
  assert(!/content:'→'|>×<|>＋</.test(html), '不再用字符模拟功能图标');
  assert.equal((node('account-grid').innerHTML.match(/simple-icons:openai/g)||[]).length, 6);
  assert(run('renderCard(accounts[6])').includes('lucide:circle-user-round'));
  for (const card of run('accounts.map(renderCard)')) assert(card.includes('tabindex="0" role="region"'), '每张卡片内部可键盘滚动');
  let scrollQueries=0;
  const before={dataset:{account:'acc-sample'},scrollTop:120}, after={dataset:{account:'acc-sample'},scrollTop:0};
  context.document.querySelectorAll=selector=>selector==='.account-card .card-body'?[scrollQueries++===0?before:after]:[];
  run('render()');
  assert.equal(after.scrollTop,120,'刷新后保留每张卡片滚动位置');
  context.document.querySelectorAll=()=>[];
  assert(!run('renderCard({...accounts[0],provider:"其他平台"})').includes('simple-icons:openai'));
  for (const account of run('accounts')) {
    const email=account.modules.profile.data?.email;
    if (email) assert(run(`renderCard(accounts.find(a=>a.id===${JSON.stringify(account.id)}))`).includes(`>${email}</span>`),'邮箱完整显示');
  }
  assert(run('renderCard({...accounts[0],modules:{...accounts[0].modules,profile:empty()}})').includes('>未返回邮箱</span>'));
  assert(run('renderCard({...accounts[0],modules:{...accounts[0].modules,profile:success({email:"<b>@example.com"})}})').includes('>&lt;b&gt;@example.com</span>'));
  for (const card of run('accounts.map(renderCard)')) assert(!/API 账号|订阅账号/.test(card),'卡片不显示账号类型');
  assert(run('renderCard(accounts[2])').includes('$0.00'));
  assert(run('renderCard(accounts[4])').includes('上次数据'));
  assert(!run('renderCard(accounts[6])').includes('$0.00'));
  node('search').listeners.input({target:{value:'生产'}});
  assert.equal((node('account-grid').innerHTML.match(/class="card account-card"/g)||[]).length, 1);
  await click({action:'clear-filters'});
  await click({action:'details',account:'acc-ops'});
  assert(node('detail-dialog').open);
  assert(node('detail-body').innerHTML.includes('/api/accounts/acc-ops/quota'));
  const planBefore = run('JSON.stringify(accounts[4].modules.plan)');
  await click({action:'retry',account:'acc-ops',module:'quota'});
  assert.equal(run('accounts[4].modules.quota.status'), 'success');
  assert.equal(run('JSON.stringify(accounts[4].modules.plan)'), planBefore);
  assert(node('refresh-all').innerHTML.includes('lucide:refresh-cw'));
  assert(!/NaN|undefined/.test(node('account-grid').innerHTML));
  // 卡片顺序、消费进度、信息块及健康状态。
  const sample=run('renderCard(accounts[6])');
  const checkHeader=card=>{
    assert(/<div class="account-heading">(?:<strong\b[^>]*>[\s\S]*?<\/strong>|<input\b[^>]*>)<div class="card-badges">[\s\S]*?<\/div><\/div><span class="email"/.test(card),'名称与标记同属标题行，邮箱独占下一行');
    const aside=card.match(/<div class="card-aside">([\s\S]*?)<\/div><\/div>/)?.[1];
    assert(aside?.startsWith('<div class="card-actions"'),'操作位于标题最右侧');
    assert(!aside.includes('card-badge'),'标记不占用操作区');
  };
  for(const card of run('accounts.map(renderCard)'))checkHeader(card);
  checkHeader(run('renderCard({...accounts[6],label:"长账号名称".repeat(8)})'));
  checkHeader(run('renderCard({...accounts[6],presentation:{...presentation(accounts[6]),badges:[],actions:[]}})'));
  assert(/\.account-heading \{[^}]*flex-wrap:wrap/.test(html),'长名称与多标记可换行，避免覆盖操作');
  assert(/\.card-badges \{[^}]*justify-content:flex-start/.test(html),'标记紧跟名称，不靠右对齐');
  assert(sample.indexOf('class="account-name"')<sample.indexOf('class="card-badges"'));
  assert(sample.indexOf('class="card-badges"')<sample.indexOf('class="email"'));
  assert(sample.indexOf('class="email"')<sample.indexOf('class="card-aside"'));
  assert(sample.indexOf('data-position="above"')<sample.indexOf('class="subscription-progress"'));
  assert(sample.indexOf('class="subscription-progress"')<sample.indexOf('data-position="below"'));
  assert(/\.info-grid \{[^}]*display:flex;flex-wrap:wrap/.test(html),'信息块按内容宽度换行，不强制三等分');
  assert(/\.info-tile \{[^}]*width:max-content;min-width:calc\(\(100% - 24px\)\/3\);max-width:100%/.test(html),'内容决定宽度，每行最多三个，小屏不溢出');
  assert(/\.info-tile dt,\.info-tile dd,\.info-tile small \{white-space:nowrap;overflow-wrap:normal;width:max-content\}/.test(html),'标题、内容与备注均保持单行');
  assert(/\.info-tile \{[^}]*overflow-x:auto;scrollbar-width:none/.test(html),'超长内容可横向查看，不丢失数据或显示滚动条');
  assert(html.includes('自动宽度（每行最多三个）')&&!html.includes('默认每行三个'),'配置文案与自适应布局一致');
  for(const count of [1,2,3,4]) {
    const fields=Array.from({length:count},(_,index)=>({label:`字段${index+1}`,module:'profile',path:'email',format:'text',missing:'hide',position:'above',wide:false}));
    const rendered=run(`renderFields({...accounts[0],presentation:{...presentation(accounts[0]),fields:${JSON.stringify(fields)}}},"above")`);
    assert.equal((rendered.match(/class="info-tile"/g)||[]).length,count,'仅展示已有字段，不补空位或限制总数');
    assert.equal((rendered.match(/class="info-tile" tabindex="0" title=/g)||[]).length,count,'信息块可键盘查看完整内容');
  }
  // 标题图标可选，进度条上下共用渲染；旧配置与非法输入均安全。
  assert(/\.info-tile dt \{[^}]*display:flex;align-items:center;gap:4px/.test(html));
  assert(html.includes('.info-tile dt svg {width:12px;height:12px;flex:none}'));
  for(const [position,icon] of [['above','wallet'],['below','calendar']]) {
    const rendered=run(`renderFields(accounts[6],${JSON.stringify(position)})`);
    assert(rendered.includes(run(`icons[${JSON.stringify(icon)}]`)),'两区均显示标题图标');
  }
  run('var iconField={label:"自定义标题",module:"profile",path:"email",format:"text",missing:"hide",position:"above",wide:false}');
  const fieldMarkup=icon=>run(`renderFields({...accounts[0],presentation:{...presentation(accounts[0]),fields:[{...iconField,icon:${JSON.stringify(icon)??'undefined'}}]}},"above")`);
  for(const icon of [undefined,null,'','openai','__proto__','toString','<svg onload=alert(1)>']) {
    const rendered=fieldMarkup(icon);
    assert(rendered.includes('>自定义标题</dt>'),'未设置或未知图标不占位');
    assert(!rendered.includes('<svg'),'不接受品牌图标、原型属性或任意 SVG');
  }
  for(const icon of Object.keys(run('FIELD_ICONS')).filter(Boolean)) {
    assert(fieldMarkup(icon).includes(run(`icons[${JSON.stringify(icon)}]`)),'可选图标均有内嵌 SVG');
    run(`validatePresentation({...presentation(accounts[0]),fields:[{...iconField,icon:${JSON.stringify(icon)}}]})`);
  }
  for(const icon of ['<svg>','__proto__','toString','openai',false,{}]) {
    assert.throws(()=>run(`validatePresentation({...presentation(accounts[0]),fields:[{...iconField,icon:${JSON.stringify(icon)}}]})`));
  }
  for(const icon of [undefined,null,''])run(`validatePresentation({...presentation(accounts[0]),fields:[{...iconField,icon:${JSON.stringify(icon)??'undefined'}}]})`);
  assert(!run('renderFields({...accounts[0],presentation:{...presentation(accounts[0]),fields:[{...iconField,path:"missing",icon:"wallet"}]}},"above")').includes('<svg'),'隐藏字段不留下孤立图标');
  assert(sample.includes('剩余 48%')&&sample.includes('重置 2026/11/06 12:16:19'));
  assert(sample.includes('62,340.4532700000 点数'));
  assert(sample.includes('data-tone="green"')&&sample.includes('>pro</span>')&&sample.includes('>默认</span>'));
  assert(sample.includes('>监控中</span>'));
  assert(run('renderCard(accounts[2])').includes('封禁 · 无法使用'));
  assert(run('renderCard(accounts[5])').includes('未确认'));
  assert(!run('renderCard(accounts[0])').includes('class="subscription-progress"'),'API 余额不误用为订阅进度');
  assert(!run('renderCard(accounts[3])').includes('class="subscription-progress"'),'订阅未返回周期则收起');
  run('var progressZero=structuredClone(accounts[6]);progressZero.modules.usage=success({windows:[{period:"7天",remainingPercent:0,usedPercent:100}]})');
  assert(run('renderUsage(progressZero)').includes('剩余 0%'));
  run('progressZero.modules.usage={status:"error",data:accounts[6].modules.usage.data};');
  assert(run('renderUsage(progressZero)').includes('上次数据'));
  assert.equal(run('healthStatus({...accounts[0],modules:{...accounts[0].modules,auth:{status:"error",data:{checkStatus:"passed"}}}}).text'),'未确认','查询失败不冒充监控中');
  assert.equal(run('healthStatus({...accounts[0],modules:{...accounts[0].modules,auth:success({accountState:"unknown",checkStatus:"passed"})}}).text'),'未确认');
  assert.throws(()=>run('validateResponse("auth",{status:"success",data:{accountState:"invented"}})'));
  assert.equal(run('fieldValue({zero:0},"zero")'),0);
  assert.equal(run('fieldValue({},"constructor")'),undefined);
  assert.equal(run('fieldValue({},"__proto__.x")'),undefined);
  assert.equal(run('fieldValue({windows:[{remaining:0}]},"windows.0.remaining")'),0);
  assert(!run('renderFields({...accounts[0],presentation:{...presentation(accounts[0]),fields:[{label:"隐藏缺失",module:"profile",path:"absent",format:"text",missing:"hide"}]}})').includes('隐藏缺失'));
  assert(run('renderFields({...accounts[0],presentation:{...presentation(accounts[0]),fields:[{label:"缺失展示",module:"profile",path:"absent",format:"text",missing:"dash"}]}})').includes('>—</dd>'));
  assert(!run('renderFields({...accounts[3],presentation:{...presentation(accounts[3]),fields:[{label:"不支持",module:"quota",path:"remaining",format:"amount",missing:"dash"}]}})').includes('>不支持</dt>'));
  // 双击、键盘、输入法、失焦保存；刷新不覆盖别名。
  const typeName=value=>{node('rename-input').value=value;listeners.input({target:node('rename-input')})};
  const nameKey=(key,isComposing=false)=>listeners.keydown({target:node('rename-input'),key,isComposing,preventDefault(){}});
  listeners.dblclick({target:{closest:()=>({dataset:{renameAccount:'acc-dev'}})}});
  checkHeader(run('renderCard(accounts[1])'));
  assert.equal(node('rename-input').value,'个人开发');typeName('  新名称  ');
  nameKey('Enter',true);assert.equal(run('accounts[1].label'),'个人开发');
  nameKey('Enter');assert.equal(run('accounts[1].label'),'新名称');
  await run('loadModule(accounts[1],"profile")');assert(run('renderCard(accounts[1])').includes('>新名称</strong>'));
  run('beginRename("acc-dev")');typeName('放弃');nameKey('Escape');assert.equal(run('accounts[1].label'),'新名称');
  run('beginRename("acc-dev")');typeName('  ');nameKey('Enter');assert(run('nameEdit!==null'));nameKey('Escape');
  run('beginRename("acc-dev")');typeName('<b>新名称</b>');listeners.focusout({target:node('rename-input')});
  assert(node('rename-input').outerHTML.includes('&lt;b&gt;新名称&lt;/b&gt;'));
  assert.equal(run('nameEdit'),null);
  // 供应商、标记、操作、信息块共用配置入口。
  await click({action:'card-settings',account:'acc-dev'});assert(node('card-settings-dialog').open);
  for(const name of ['OpenAI','Anthropic','Google Gemini','DeepSeek','GitHub Copilot'])assert(node('provider-options').innerHTML.includes(name));
  assert.equal(run('presentation(accounts[1]).actions.map(a=>a.kind).join(",")'),'refresh,delete');
  await click({action:'choose-provider',provider:'Anthropic'});
  await click({action:'add-editor-row',section:'badges'});
  const update=(section,index,key,value)=>listeners.input({target:{dataset:{editorSection:section,index:String(index),key},value}});
  update('badges',2,'label','备用');update('badges',2,'tone','yellow');
  await click({action:'add-editor-row',section:'actions'});update('actions',2,'label','检查授权');update('actions',2,'icon','account');
  await click({action:'add-editor-row',section:'fields'});update('fields',11,'label','联系邮箱');
  assert(node('field-editor').innerHTML.includes('标题小图标')&&node('field-editor').innerHTML.includes('不显示图标'));
  assert.equal(run('editor.draft.fields[11].icon'),'','新信息块图标默认可选');
  listeners.change({target:{dataset:{editorSection:'fields',index:'11',key:'icon'},value:'account'}});
  node('card-settings-form').listeners.submit({preventDefault(){}});
  assert(!node('card-settings-dialog').open);assert.equal(run('accounts[1].provider'),'Anthropic');
  const customized=run('renderCard(accounts[1])');assert(customized.includes('simple-icons:anthropic'));
  assert(customized.includes('data-tone="yellow"')&&customized.includes('>备用</span>'));
  assert(customized.includes('联系邮箱')&&customized.includes('developer@example.com'));
  assert.equal(run('accounts[1].presentation.fields[11].icon'),'account','下拉选择的图标随配置保存');
  assert(/<dt[^>]*><svg[^>]*data-icon="lucide:circle-user-round"[\s\S]*?<\/svg>联系邮箱<\/dt>/.test(customized));
  await click({action:'card-operation',account:'acc-dev',index:'2'});
  assert.equal(dispatched.at(-1).type,'account-card-action');assert.equal(dispatched.at(-1).detail.accountId,'acc-dev');
  assert.throws(()=>run('validatePresentation({...presentation(accounts[1]),fields:[{label:"不安全",module:"profile",path:"__proto__.x",format:"text",missing:"hide"}]})'));
  // 编辑取消不改原卡片；可自由添加、移除操作。
  const configBefore=run('JSON.stringify(accounts[1].presentation)');
  await click({action:'card-settings',account:'acc-dev'});await click({action:'remove-editor-row',section:'actions',index:'2'});
  update('fields',11,'icon','');
  assert.equal(run('editor.draft.actions.length'),2);assert.equal(run('JSON.stringify(accounts[1].presentation)'),configBefore);
  node('card-settings-form').listeners.submit({preventDefault(){}});
  assert.equal(run('accounts[1].presentation.fields[11].icon'),'','可以保存为无图标');
  assert(run('renderFields(accounts[1],"below")').includes('>联系邮箱</dt>'));
  // 删除必须先确认；取消和失败不移除数据。
  const count=run('accounts.length');
  await click({action:'card-operation',account:'acc-dev',index:'1'});
  assert(node('delete-dialog').open);assert.equal(run('accounts.length'),count);assert(node('delete-message').textContent.includes('<b>新名称</b>'));
  listeners.click({target:{closest:selector=>selector==='[data-close]'?{dataset:{close:'delete-dialog'}}:null}});
  assert.equal(run('accounts.length'),count);
  await click({action:'card-operation',account:'acc-dev',index:'1'});await click({action:'confirm-delete'});
  assert.equal(run('accounts.length'),count-1);assert(!node('delete-dialog').open);assert(!run('accounts.some(a=>a.id==="acc-dev")'));
  // 真实模式失败路径：不丢卡片，保留可重试入口。
  const liveNodes=new Map(),liveNode=id=>{
    if(!liveNodes.has(id))liveNodes.set(id,{innerHTML:'',textContent:'',open:false,addEventListener(){},setAttribute(){},showModal(){this.open=true},close(){this.open=false}});
    return liveNodes.get(id);
  };
  const live=vm.createContext({console,structuredClone,Intl,Date,setTimeout,clearTimeout,fetch:async()=>({ok:false}),document:{getElementById:liveNode,querySelectorAll:()=>[],addEventListener(){}}});
  for(const [,script] of scripts)new vm.Script(script.replace('const API_BASE = null;','const API_BASE = "";')).runInContext(live);
  vm.runInContext('requestDelete(accounts[0])',live);await vm.runInContext('deleteAccount()',live);
  assert.equal(vm.runInContext('accounts.length',live),7);assert(liveNode('delete-error').textContent.includes('卡片已保留'));assert(liveNode('delete-dialog').open);
  const ids=[...node('account-grid').innerHTML.matchAll(/data-od-id="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size);
  const staticIds=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  for(const match of html.matchAll(/\$\('([^']+)'\)/g))if(!['rename-input'].includes(match[1]))assert(staticIds.includes(match[1]),`控件存在：${match[1]}`);
  assert(!/NaN|undefined/.test(node('account-grid').innerHTML));
  clearTimeout(run('toastTimer'));
  console.log('通过：可选标题图标、两区显示、旧配置兼容、非法图标校验、配置保存与取消；供应商 SVG、固定卡片、单行信息、邮箱、进度、改名、删除确认与独立重试');
})().catch(error => {console.error(error); process.exitCode = 1});
