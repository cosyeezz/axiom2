// Run: node reasoning-levels.check.cjs — no browser or dependencies.
const fs=require('node:fs'),assert=require('node:assert/strict');
const html=fs.readFileSync(__dirname+'/model-config-before-unified-save-v2.html','utf8');
const source=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));
const levels=['none','minimal','low','medium','high','xhigh','max'];
const group=html.match(/<div id="reasoning-level-options"[\s\S]*?<\/div>/)[0];
assert.deepEqual([...group.matchAll(/type="checkbox"[^>]*value="([^"]+)"/g)].map(m=>m[1]),levels);
assert(!group.includes('<select'));
function create(storage=new Map()){
 const nodes=new Map();
 const node=id=>{
  assert(ids.has(id),'Missing node: '+id);
  if(!nodes.has(id))nodes.set(id,{id,value:id==='new-model-reasoning'?'none':'',name:id.startsWith('reasoning-')&&levels.includes(id.slice(10))?'model-reasoning-level':'',checked:id==='reasoning-none',hidden:id==='model-editor',innerHTML:'',textContent:'',listeners:{},attributes:{},isConnected:true,querySelector(){return null;},querySelectorAll(){return levels.map(v=>node('reasoning-'+v));},focus(){doc.activeElement=this;},setAttribute(k,v){this.attributes[k]=v;},setCustomValidity(){},addEventListener(k,fn){this.listeners[k]=fn;},showModal(){this.open=true;},close(){this.open=false;}});
  return nodes.get(id);
 };
 for(const value of levels)node('reasoning-'+value).value=value;
 const doc={activeElement:null,getElementById:node,querySelectorAll:()=>[]};
 const api=new Function('document','window','localStorage','crypto',source+'\nreturn {openModel,isModelDirty,currentProvider,validProviders,initialProviders,storageKey};')(doc,{addEventListener(){}},{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)},{randomUUID:()=> 'test-id'});
 const choose=value=>{
  const checkbox=node('reasoning-'+value);checkbox.checked=!checkbox.checked;
  node('reasoning-level-options').listeners.change({target:checkbox});
 };
 const save=()=>node('model-form').onsubmit({preventDefault(){}});
 return {api,node,storage,choose,save};
}
const app=create();
const combinations=[['none'],['low','high','max'],levels,[]];
for(const [i,selected] of combinations.entries()){
 assert(app.api.openModel());
 assert.equal(app.node('new-model-reasoning').value,'none');
 assert(!app.api.isModelDirty());
 app.node('new-model-id').value='test-'+i;
 // Toggle each checkbox independently, including deselecting none.
 for(const level of levels)if(app.node('reasoning-'+level).checked!==selected.includes(level))app.choose(level);
 const expected=i===0?'none':selected;
 assert.deepEqual(levels.filter(v=>app.node('reasoning-'+v).checked),selected);
 assert(app.api.isModelDirty());app.save();
 assert(app.node('model-editor').hidden);
 assert.deepEqual(app.api.currentProvider().models[i].reasoning,expected);
 const restored=create(app.storage);assert(restored.api.openModel(i));
 assert.deepEqual(levels.filter(v=>restored.node('reasoning-'+v).checked),selected);
 assert(!restored.api.isModelDirty());restored.choose('max');
 assert(restored.api.isModelDirty());
 assert(!restored.node('models-body').innerHTML.includes('undefined'));
}
// Saving another provider field must preserve all model selections.
app.node('provider-name').value='OpenAI 配置测试';app.node('provider-form').onsubmit({preventDefault(){}});
assert.deepEqual(app.api.currentProvider().models[1].reasoning,['low','high','max']);
// Cancel must not persist a changed selection.
assert(app.api.openModel(1));app.choose('max');app.node('cancel-model-edit').onclick();
assert.deepEqual(app.api.currentProvider().models[1].reasoning,['low','high','max']);
// Legacy scalar values must stay unchanged until the user explicitly edits them.
for(const legacy of [...levels,'levels','toggle','auto']){
 const providers=structuredClone(app.api.initialProviders);
 providers[0].models=[{id:'legacy',name:'旧模型',reasoning:legacy}];
 const old=create(new Map([[app.api.storageKey,JSON.stringify({version:1,providers,selected:'openai'})]]));
 assert(old.api.openModel(0));assert(!old.api.isModelDirty());
 assert.equal(old.node('reasoning-legacy-note').hidden,levels.includes(legacy));
 old.save();assert.equal(old.api.currentProvider().models[0].reasoning,legacy);
 assert(old.api.openModel(0));old.choose('high');old.save();
 const expected=levels.filter(v=>v===legacy&&v!=='high'||v==='high'&&legacy!=='high');
 assert.deepEqual(old.api.currentProvider().models[0].reasoning,expected);
}
for(const reasoning of ['unlimited',['unlimited'],['low','low'],['auto'],null,{},[1]]){
 const invalid=structuredClone(app.api.initialProviders);
 invalid[0].models=[{id:'bad',name:'非法值',reasoning}];assert(!app.api.validProviders(invalid));
}
assert(html.includes('#model-reasoning-field{grid-column:1 / -1;'));
assert(html.includes('#reasoning-level-options input:checked+span::before{content:"✓";'));
assert(html.includes('#reasoning-level-options input:focus-visible+span'));
assert(!group.includes('type="radio"'));assert(!html.includes('scrollIntoView'));
console.log('通过：七档多选、取消勾选、全选与空选、保存恢复、编辑回填、取消保护、旧值兼容、非法值校验与独立行样式');
