// Run: node model-config.check.cjs — dependency-free, no browser.
const fs=require('node:fs'),assert=require('node:assert/strict');
const html=fs.readFileSync(__dirname+'/model-config.html','utf8');
const source=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));
function create(storage=new Map()){
 const nodes=new Map(),callbacks=new Map();let fail=false,writes=0,serial=0;
 const node=id=>{
  assert(ids.has(id),'Missing control: '+id);
  if(!nodes.has(id))nodes.set(id,{id,value:'',type:'password',innerHTML:'',textContent:'',hidden:id==='model-editor',disabled:false,isConnected:true,attributes:{},listeners:{},querySelector(){return null;},focus(){doc.activeElement=this;},setAttribute(k,v){this.attributes[k]=v;},setCustomValidity(v){this.validity=v;},addEventListener(k,fn){this.listeners[k]=fn;},showModal(){this.open=true;},close(){this.open=false;this.listeners.close?.();}});
  return nodes.get(id);
 };
 const links=[...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>/g)].map(m=>({listeners:{},getAttribute:()=>m[1],addEventListener(k,fn){this.listeners[k]=fn;}}));
 const doc={activeElement:null,getElementById:node,querySelectorAll:s=>s==='dialog'?[node('confirm-dialog')]:s==='a'?links:[]};
 const win={addEventListener:(k,fn)=>callbacks.set(k,fn),location:{href:''}};
 const localStorage={getItem:k=>storage.get(k)??null,setItem(k,v){if(fail)throw Error('storage full');writes++;storage.set(k,v);}};
 const api=new Function('document','window','localStorage','crypto',source+'\nreturn {overrideError,validEndpoint,validProviders,initialProviders,saveProvider,switchProvider,switchConfigTab,isDirty,isModelDirty,hasUnsavedChanges,openModel,closeModel,currentProvider,modelEntries,state:()=>({providers,selected,draft,keys,savedProviders,savedKeys}),key:storageKey};')(doc,win,localStorage,{randomUUID:()=> '00000000-0000-4000-8000-'+String(++serial).padStart(12,'0')});
 const input=(id,value)=>{node(id).value=value;node(id).listeners.input?.();};
 const confirm=()=>node('confirm-action').onclick();
 const discard=()=>{node('reset-provider').onclick();assert(node('confirm-dialog').open);confirm();};
 const model=(id,name='',reasoning='none')=>{input('new-model-id',id);input('new-model-name',name);input('new-model-reasoning',reasoning);};
 const finish=()=>node('model-form').onsubmit({preventDefault(){}});
 const removeModel=i=>node('models-body').onclick({target:{closest:s=>s==='[data-delete-model]'?{dataset:{deleteModel:String(i)}}:null}});
 const add=(scope,kind)=>node(scope+'-'+kind+'-overrides').onclick({target:{closest:s=>s==='[data-add-override]'?{}:null}});
 const field=(scope,kind,index,field,value)=>node(scope+'-'+kind+'-overrides').listeners.input({target:{dataset:{overrideIndex:String(index),overrideField:field},value}});
 return {api,node,input,confirm,discard,model,finish,removeModel,add,field,storage,callbacks,links,win,writes:()=>writes,setFailure:v=>fail=v};
}
const x=create(),{api,node,input,storage}=x;
const persisted=()=>storage.get(api.key),saved=()=>JSON.parse(persisted()).providers;
const before=persisted(),writes=x.writes();
assert(api.validProviders(api.initialProviders));assert(api.currentProvider().configured&&api.openModel());api.closeModel();
assert(node('save-provider').disabled&&node('reset-provider').disabled);
// Connection edits and keys are pending; navigation preserves them without writes.
input('provider-name','OpenAI 私有接口');input('provider-key','saved-key');
assert(api.isDirty()&&!node('save-provider').disabled);api.switchConfigTab('models');assert(!node('provider-toolbar-actions').hidden);
api.switchProvider('anthropic');assert.equal(api.state().selected,'anthropic');assert(!node('confirm-dialog').open);
api.switchProvider('openai');assert.equal(node('provider-name').value,'OpenAI 私有接口');assert.equal(node('provider-key').value,'saved-key');
assert.equal(persisted(),before);assert.equal(x.writes(),writes);assert.equal(create(storage).api.currentProvider().name,'OpenAI');
assert(api.saveProvider());assert(!api.hasUnsavedChanges());assert(!persisted().includes('saved-key'));assert.equal(api.state().savedKeys.get('openai'),'saved-key');
input('provider-key','discard-key');x.discard();assert.equal(node('provider-key').value,'saved-key');
// Finish editing only stages. Top Save also captures an open editor on another tab.
const beforeModel=persisted();assert(api.openModel());x.model('first','第一个模型','levels');x.finish();
assert(node('model-editor').hidden&&api.isDirty());assert(node('models-body').innerHTML.includes('待保存'));assert.equal(persisted(),beforeModel);
assert(api.saveProvider());assert.equal(saved()[0].models[0].id,'first');assert(!node('models-body').innerHTML.includes('待保存'));
assert(api.openModel());x.model('second','第二个模型');api.switchConfigTab('suppliers');assert(api.saveProvider());assert.equal(saved()[0].models.length,2);
api.openModel(0);x.model('first-updated','<img src=x onerror=alert(1)>');x.finish();assert(!node('models-body').innerHTML.includes('<img src=x'));assert.equal(saved()[0].models[0].id,'first');
x.discard();assert.equal(api.currentProvider().models[0].id,'first');
// Model cancel warns and preserves unrelated connection edits.
input('provider-name','连接草稿');api.openModel(0);x.model('changed');node('cancel-model-edit').onclick();assert(node('confirm-dialog').open);
node('confirm-dialog').close();assert(!node('model-editor').hidden);node('cancel-model-edit').onclick();x.confirm();assert.equal(node('provider-name').value,'连接草稿');x.discard();
// Delete model stages, can be cancelled/restored, and only persists on Save.
const beforeDelete=persisted();x.removeModel(0);node('confirm-dialog').close();assert.equal(api.currentProvider().models.length,2);
x.removeModel(0);x.confirm();assert.equal(api.currentProvider().models.length,1);assert.equal(persisted(),beforeDelete);x.discard();assert.equal(api.currentProvider().models.length,2);
x.removeModel(1);x.confirm();assert(api.saveProvider());assert.equal(saved()[0].models.length,1);
// Switch supplier stages a valid model without committing any provider.
api.openModel();x.model('cross-supplier');const preSwitch=persisted();api.switchProvider('anthropic');assert.equal(api.state().selected,'anthropic');assert.equal(persisted(),preSwitch);
assert(node('add-model').disabled&&!api.openModel());assert(!node('save-provider').disabled);assert(api.saveProvider());assert(api.currentProvider().configured);assert(api.openModel());x.model('anthropic-only');x.finish();
api.switchProvider('openai');assert(!node('models-body').innerHTML.includes('anthropic-only'));assert(api.saveProvider());assert.equal(saved().find(p=>p.id==='anthropic').models.length,1);
// Invalid connection anywhere blocks the entire transaction, preserving other drafts.
input('provider-url','javascript:alert(1)');api.switchProvider('anthropic');input('provider-name','Anthropic 草稿');const invalidBefore=persisted();assert(!api.saveProvider());assert.equal(persisted(),invalidBefore);assert.equal(api.state().selected,'openai');assert(node('feedback').textContent.includes('HTTP'));x.discard();
api.openModel();x.model('first');assert(!api.saveProvider());assert(node('model-error').textContent.includes('已存在'));assert(!node('models-screen').hidden);api.closeModel();
api.openModel();x.model('', '没有 ID');api.switchConfigTab('suppliers');assert(!api.saveProvider());assert(!node('models-screen').hidden);api.closeModel();
// Failed explicit save retains ALL staged changes for retry.
api.openModel();x.model('retry');x.finish();input('provider-name','重试连接');x.removeModel(0);x.confirm();const preFailure=persisted();
x.setFailure(true);assert(!api.saveProvider());assert(api.isDirty());assert.equal(persisted(),preFailure);assert(node('toolbar-save-state').textContent.includes('失败'));
x.setFailure(false);assert(api.saveProvider());assert(saved()[0].models.some(m=>m.id==='retry'));assert(!saved()[0].models.some(m=>m.id==='first'));
// Supplier additions live in the left list, save before model editing, and preserve other drafts.
input('provider-name','与新增一起保存');const preAdd=persisted();node('add-supplier').onclick();const newId=api.state().draft.id;
assert(node('supplier-list').innerHTML.includes('supplier-draft'));assert(!api.openModel());assert.equal(persisted(),preAdd);
node('add-supplier').onclick();assert.equal(api.state().draft.id,newId);input('provider-name','Anthropic');input('provider-url','http://localhost:11434/v1');assert(!api.saveProvider());assert(node('feedback').textContent.includes('已存在'));
input('provider-name','本地供应商');input('provider-key','local-key');assert(api.saveProvider());assert(api.openModel());x.model('local');assert(api.saveProvider());assert.equal(saved().find(p=>p.id===newId).models[0].id,'local');
assert(!persisted().includes('local-key'));assert.equal(create(storage).api.state().keys.size,0);
const mixed=create();mixed.input('provider-url','invalid');mixed.node('add-supplier').onclick();const pendingId=mixed.api.state().draft.id;mixed.input('provider-name','待保存的新供应商');mixed.input('provider-url','http://localhost:11434/v1');assert(!mixed.api.saveProvider());assert.equal(mixed.api.state().selected,'openai');assert(mixed.api.state().providers.some(p=>p.id===pendingId));mixed.input('provider-url','https://api.openai.com/v1');mixed.api.switchProvider(pendingId);assert(!mixed.api.openModel());assert(mixed.api.saveProvider());assert(mixed.api.openModel());
// Supplier deletion, including last supplier, is a pending transaction and rollback works.
const preSupplierDelete=persisted();node('delete-supplier').onclick();x.confirm();assert(!api.state().providers.some(p=>p.id===newId));assert.equal(persisted(),preSupplierDelete);x.discard();assert(api.state().providers.some(p=>p.id===newId));
while(api.state().providers.length){node('delete-supplier').onclick();x.confirm();}
assert(!node('provider-toolbar-actions').hidden&&!node('save-provider').disabled&&node('provider-tabs').hidden);assert.equal(persisted(),preSupplierDelete);
x.setFailure(true);assert(!api.saveProvider());x.setFailure(false);x.discard();assert.equal(api.state().providers.length,4);
while(api.state().providers.length){node('delete-supplier').onclick();x.confirm();}assert(api.saveProvider());assert.equal(create(storage).api.state().providers.length,0);
// Request overrides: no implicit writes, precedence isolation, validation and sensitive redaction.
const o=create(),oa=o.api,on=o.node;
const override=(scope,kind,key,value)=>{o.add(scope,kind);o.field(scope,kind,0,'key',key);o.field(scope,kind,0,'value',value);};
const overrideBefore=o.storage.get(oa.key);override('provider','header','X-Client','AXIOM');override('provider','body','temperature','0.4');assert.equal(o.storage.get(oa.key),overrideBefore);assert(oa.saveProvider());
oa.openModel();o.model('override');override('model','header','x-client','Model');override('model','body','temperature','0.2');o.finish();assert.equal(JSON.parse(o.storage.get(oa.key)).providers[0].models.length,0);assert(oa.saveProvider());
assert.equal(oa.currentProvider().headerOverrides[0].value,'AXIOM');assert.equal(create(o.storage).api.currentProvider().models[0].bodyOverrides[0].value,'0.2');
oa.openModel(0);o.add('model','header');o.field('model','header',1,'key','X-Client');o.field('model','header',1,'value','duplicate');assert(!oa.saveProvider());assert(on('model-error').textContent.includes('重复'));oa.closeModel();
o.add('provider','header');o.field('provider','header',1,'key','Authorization');o.field('provider','header',1,'value','Bearer private');o.add('provider','body');o.field('provider','body',1,'key','metadata');o.field('provider','body',1,'value','{"access_token":"nested-private"}');assert(oa.saveProvider());
assert(!o.storage.get(oa.key).includes('private'));assert.equal(oa.currentProvider().headerOverrides[1].value,'Bearer private');assert.equal(create(o.storage).api.currentProvider().headerOverrides[1].value,'');
assert(oa.overrideError([{key:'bad header',value:'x'}],'header'));assert(oa.overrideError([{key:'X-Test',value:'a\r\nb'}],'header'));assert(oa.overrideError([{key:'',value:'x'}],'body'));
assert(oa.overrideError([{key:'X-Test',value:'a'},{key:'x-test',value:'b'}],'header'));assert(!oa.overrideError([{key:'temperature',value:'0.4'},{key:'Temperature',value:'0.8'}],'body'));
// Leaving protects drafts, tab keyboard controls work, Ctrl/Cmd+S commits explicitly.
o.input('provider-name','离开前草稿');let warned=false;o.callbacks.get('beforeunload')({preventDefault(){warned=true;}});assert(warned);
let prevented=false;o.links[0].listeners.click({preventDefault(){prevented=true;}});assert(prevented&&on('confirm-dialog').open);on('confirm-dialog').close();assert.equal(o.win.location.href,'');
oa.switchConfigTab('suppliers');on('suppliers-tab').listeners.keydown({key:'ArrowRight',preventDefault(){}});assert.equal(on('models-tab').attributes['aria-selected'],'true');
on('models-tab').listeners.keydown({key:'Home',preventDefault(){}});assert.equal(on('suppliers-tab').attributes.tabindex,'0');
o.callbacks.get('keydown')({key:'s',ctrlKey:true,preventDefault(){}});assert(!oa.hasUnsavedChanges());
const navigation=create();navigation.input('provider-key','leaving-key');navigation.api.openModel();navigation.model('leave-model');navigation.links[0].listeners.click({preventDefault(){}});navigation.confirm();assert(navigation.win.location.href);assert(!navigation.api.hasUnsavedChanges(),'Confirmed departure must not trigger a second unload prompt');
// Existing schema, corrupt storage, legacy preset and capacities remain supported.
const bad='{"version":1,"providers":[null]}',corrupt=create(new Map([[oa.key,bad]]));assert(corrupt.node('feedback').textContent.includes('读取失败'));assert.equal(corrupt.storage.get(oa.key),bad);
const legacy=structuredClone(oa.initialProviders);legacy[0].configured=false;assert(create(new Map([[oa.key,JSON.stringify({version:1,providers:legacy})]])).api.currentProvider().configured);
const full={...oa.initialProviders[0],models:Array.from({length:200},(_,i)=>({id:'m-'+i,name:'模型 '+i,reasoning:'none'}))};
const limit=create(new Map([[oa.key,JSON.stringify({version:1,selected:'openai',providers:[full]})]]));assert(!limit.api.openModel());assert(limit.api.openModel(0));limit.model('updated');assert(limit.api.saveProvider());assert.equal(limit.api.currentProvider().models.length,200);
// Local UI contract: one primary Save, no old instant-save claim or unwanted layout changes.
assert.equal([...html.matchAll(/class="btn btn-primary"/g)].length,1);assert(html.includes('>完成编辑</button>')&&!html.includes('即时保存'));
assert(!html.includes('scrollIntoView')&&!ids.has('model-dialog'));assert(html.includes('@media(pointer:coarse)')&&html.includes('@media(max-width:600px)'));
assert(html.includes('@container(min-width:720px)')&&html.includes('height:34px;min-height:34px'));assert.equal([...html.matchAll(/class="override-grid"/g)].length,2);
assert(html.includes('select.input::picker(select){appearance:base-select;background:var(--surface);color:var(--fg)'));assert(html.includes(':focus-visible'));
assert(!html.includes('[REPLACE]')&&!html.includes('{{'));assert.equal([...html.matchAll(/<script>/g)].length,[...html.matchAll(/<\/script>/g)].length);
console.log('通过：统一手动保存、跨供应商草稿、编辑与删除回滚、全局校验、保存失败重试、密钥草稿、覆盖项校验与脱敏、导航保护、快捷键、预置与旧存储兼容、空状态及紧凑布局约束');
