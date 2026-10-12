// Run: node model-copy.check.cjs — no browser or dependencies.
const fs=require('node:fs'),assert=require('node:assert/strict');
const html=fs.readFileSync(__dirname+'/model-config-before-unified-save-v2.html','utf8');
const source=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));
const nodes=new Map(),writes=[],timers=[],storage=new Map();
let nativeFails=false,legacyWorks=true,legacyCalls=0,temporary;
const node=id=>{
 assert(ids.has(id),'Missing node: '+id);
 if(!nodes.has(id))nodes.set(id,{id,value:'',hidden:id==='model-editor',innerHTML:'',textContent:'',listeners:{},attributes:{},querySelector(){return null;},querySelectorAll(){return [];},focus(){},setAttribute(k,v){this.attributes[k]=v;},setCustomValidity(){},addEventListener(k,fn){this.listeners[k]=fn;},append(input){temporary=input;}});
 return nodes.get(id);
};
const document={getElementById:node,querySelectorAll:()=>[],createElement:()=>({style:{},setAttribute(){},select(){},remove(){temporary=null;}}),execCommand(command){assert.equal(command,'copy');legacyCalls++;writes.push(temporary.value);return legacyWorks;}};
const navigator={clipboard:{async writeText(value){if(nativeFails)throw Error('Denied');writes.push(value);}}};
const api=new Function('document','window','localStorage','crypto','navigator','setTimeout',source+'\nreturn {currentProvider,renderModels,isDirty};')(document,{addEventListener(){}},{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)},{randomUUID:()=> 'test-id'},navigator,fn=>timers.push(fn));
const models=[{name:'另一模型',id:'first',reasoning:'none'},{name:'测试 <名称> & "完整"',id:'namespace/model-id',reasoning:['high','max']}];
api.currentProvider().models.push(...models);api.renderModels();
const saved=JSON.stringify([...storage]);
const copy=async(field,index='1')=>{
 const button={dataset:{copyField:field,copyModel:index},innerHTML:'original-icon',attributes:{},setAttribute(k,v){this.attributes[k]=v;},focus(){}};
 await node('configured-model-table').listeners.click({target:{closest:()=>button}});return button;
};
(async()=>{
 for(const [field,value] of [['name',models[1].name],['id',models[1].id]]){
  const button=await copy(field);assert.equal(writes.at(-1),value);assert(!button.disabled);assert.equal(button.title,'已复制');assert(button.innerHTML.includes('m5 12'));
  assert(node('model-copy-feedback').textContent.includes('已复制'));timers.pop()();assert.equal(button.innerHTML,'original-icon');
 }
 node('model-filter').value='namespace';api.renderModels();
 const row=node('models-body').innerHTML;assert(!row.includes('另一模型'));assert(row.includes('data-copy-model="1"'));assert(row.includes('copy-model-id-openai-1-mobile'));assert(row.includes('&lt;名称&gt;'));
 await copy('id');assert.equal(writes.at(-1),models[1].id);
 nativeFails=true;await copy('name');assert.equal(writes.at(-1),models[1].name);assert.equal(legacyCalls,1);assert.equal(temporary,null);
 legacyWorks=false;const failed=await copy('id');assert(!failed.disabled);assert.equal(failed.innerHTML,'original-icon');assert(node('model-copy-feedback').textContent.includes('复制失败'));assert.equal(temporary,null);
 const count=writes.length;await copy('url');await copy('name','999');assert.equal(writes.length,count);
 assert.equal(JSON.stringify([...storage]),saved,'Copy must not persist configuration');
 assert(html.includes('#configured-model-table .copy-model-value:focus-visible'));assert(html.includes('#configured-model-table .mobile-model-id .copy-model-value{display:inline-grid}'));
 console.log('通过：名称与 ID 精确复制、过滤索引、窄屏按钮、成功反馈恢复、剪贴板回退、失败提示、无配置写入');
})().catch(error=>{console.error(error);process.exitCode=1;});
