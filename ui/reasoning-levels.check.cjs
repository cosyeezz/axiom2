// Run: node reasoning-levels.check.cjs — checks the active page, no browser or dependencies.
const fs=require('node:fs'),assert=require('node:assert/strict');
const html=fs.readFileSync(__dirname+'/model-config.html','utf8');
const source=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const ids=new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m=>m[1]));
const levels=['none','minimal','low','medium','high','xhigh','max'];
const group=html.match(/<div id="reasoning-level-options"[\s\S]*?<\/div>/)[0];
assert.deepEqual([...group.matchAll(/type="checkbox"[^>]*value="([^"]+)"/g)].map(m=>m[1]),levels);
assert(!group.includes('<select'));
function create(storage=new Map()){
 const nodes=new Map();let fail=false;
 const node=id=>{
  assert(ids.has(id),'Missing node: '+id);
  if(!nodes.has(id))nodes.set(id,{id,value:'',name:id.startsWith('reasoning-')&&levels.includes(id.slice(10))?'model-reasoning-level':'',checked:false,hidden:id==='model-editor',innerHTML:'',textContent:'',listeners:{},attributes:{},isConnected:true,querySelector(){return null;},querySelectorAll(){return levels.map(v=>node('reasoning-'+v));},focus(){doc.activeElement=this;},setAttribute(k,v){this.attributes[k]=v;},setCustomValidity(){},addEventListener(k,fn){this.listeners[k]=fn;},showModal(){this.open=true;},close(){this.open=false;}});
  return nodes.get(id);
 };
 for(const value of levels)node('reasoning-'+value).value=value;
 const doc={activeElement:null,getElementById:node,querySelectorAll:()=>[]};
 const api=new Function('document','window','localStorage','crypto',source+'\nreturn {openModel,isModelDirty,hasUnsavedChanges,currentProvider,validProviders,initialProviders,storageKey,saveProvider,switchConfigTab,switchProvider};')(doc,{addEventListener(){}},{getItem:k=>storage.get(k)??null,setItem:(k,v)=>{if(fail)throw Error('storage full');storage.set(k,v);}},{randomUUID:()=> 'test-id'});
 const choose=value=>{const checkbox=node('reasoning-'+value);checkbox.checked=!checkbox.checked;node('reasoning-level-options').listeners.change({target:checkbox});};
 const selected=()=>levels.filter(v=>node('reasoning-'+v).checked);
 const finish=()=>node('model-form').onsubmit({preventDefault(){}});
 const discard=()=>{node('reset-provider').onclick();node('confirm-action').onclick();};
 return {api,node,storage,choose,selected,finish,discard,setFailure:value=>fail=value};
}
const app=create();
for(const [i,selected] of [['none'],['low','high','max'],levels,[]].entries()){
 assert(app.api.openModel());assert(!app.api.isModelDirty());assert.deepEqual(app.selected(),['none']);
 app.node('new-model-id').value='test-'+i;
 for(const level of levels)if(app.node('reasoning-'+level).checked!==selected.includes(level))app.choose(level);
 const expected=i===0?'none':selected,before=app.storage.get(app.api.storageKey);
 assert.deepEqual(app.selected(),selected);assert(app.api.isModelDirty());app.finish();
 assert(app.node('model-editor').hidden);assert.deepEqual(app.api.currentProvider().models[i].reasoning,expected);
 assert.equal(app.storage.get(app.api.storageKey),before,'Finish must only stage');
 assert(app.api.saveProvider());assert(!app.api.hasUnsavedChanges());
 const restored=create(app.storage);assert(restored.api.openModel(i));assert.deepEqual(restored.selected(),selected);
 assert(!restored.api.isModelDirty());restored.choose('max');assert(restored.api.isModelDirty());
 assert.equal(restored.node('toolbar-save-state').attributes['data-dirty'],'true');assert(!restored.node('save-provider').disabled);
 assert(!restored.node('models-body').innerHTML.includes('undefined'));
}
// Top Save captures an open editor, even on the connection tab; failure preserves a retryable draft.
assert(app.api.openModel(1));app.choose('minimal');app.api.switchConfigTab('suppliers');
const beforeFailure=app.storage.get(app.api.storageKey);app.setFailure(true);assert(!app.api.saveProvider());
assert.equal(app.storage.get(app.api.storageKey),beforeFailure);assert(app.api.hasUnsavedChanges());
app.setFailure(false);assert(app.api.saveProvider());assert.deepEqual(create(app.storage).api.currentProvider().models[1].reasoning,['minimal','low','high','max']);
// Cancel changes only the current editor; global discard restores the saved array.
assert(app.api.openModel(1));app.choose('max');app.node('cancel-model-edit').onclick();assert(app.node('confirm-dialog').open);
app.node('confirm-action').onclick();assert.deepEqual(app.api.currentProvider().models[1].reasoning,['minimal','low','high','max']);
assert(app.api.openModel(1));app.choose('none');app.finish();app.discard();
assert.deepEqual(app.api.currentProvider().models[1].reasoning,['minimal','low','high','max']);
// Switching supplier stages the selection without saving, then restores it on re-edit.
assert(app.api.openModel(1));app.choose('high');const beforeSwitch=app.storage.get(app.api.storageKey);
app.api.switchProvider('anthropic');assert.equal(app.storage.get(app.api.storageKey),beforeSwitch);
app.api.switchProvider('openai');assert(app.api.openModel(1));assert.deepEqual(app.selected(),['minimal','low','max']);app.discard();
// Existing scalar and legacy modes are retained until a checkbox is changed.
for(const legacy of [...levels,'levels','toggle','auto']){
 const providers=structuredClone(app.api.initialProviders);providers[0].models=[{id:'legacy',name:'旧模型',reasoning:legacy}];
 const old=create(new Map([[app.api.storageKey,JSON.stringify({version:1,providers,selected:'openai'})]]));
 assert(old.api.openModel(0));assert(!old.api.isModelDirty());assert.equal(old.node('reasoning-legacy-note').hidden,levels.includes(legacy));
 old.node('new-model-name').value='旧模型改名';assert(old.api.saveProvider());assert.equal(old.api.currentProvider().models[0].reasoning,legacy);
 assert(old.api.openModel(0));old.choose('high');assert(old.api.saveProvider());
 const expected=levels.filter(v=>v===legacy&&v!=='high'||v==='high'&&legacy!=='high');
 assert.deepEqual(old.api.currentProvider().models[0].reasoning,expected);
}
for(const reasoning of ['unlimited',['unlimited'],['low','low'],['auto'],null,{},[1]]){
 const invalid=structuredClone(app.api.initialProviders);invalid[0].models=[{id:'bad',name:'非法值',reasoning}];assert(!app.api.validProviders(invalid));
}
assert(html.includes('#model-reasoning-field{grid-column:1 / -1;'));
assert(html.includes('.inline-model-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));'));
assert(html.includes('#reasoning-level-options input:checked+span::before{background:var(--accent);'));
assert(html.includes('#reasoning-level-options input:checked+span::after{content:"";'));
assert(html.includes('box-shadow:inset 0 -2px 0 var(--accent)'));
assert(!html.match(/#reasoning-level-options \[data-od-id=/),'Shared style must cover every level');
assert(!html.includes('content:"✓"'));assert(html.includes('#reasoning-level-options input:focus-visible+span'));
assert(!group.includes('type="radio"'));assert(!html.includes('scrollIntoView'));
assert(!html.includes('[REPLACE]')&&!html.includes('{{'));
assert.equal([...html.matchAll(/\sid="([^"]+)"/g)].length,ids.size,'Unique control IDs');
console.log('通过：当前页七档多选、全选与空选、独立行与勾号色带、统一手动保存、失败重试、刷新回填、取消与放弃、跨供应商草稿、旧值兼容及校验');
