const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, 'coding-agent-v2-before-subagent-modal-v2.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
new vm.Script(script);
const element = () => ({attrs:{},dataset:{},setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];}});
const metric=element(),ring=element(),track=element(),fill=element(),text=element();
ring.querySelector=()=>track;
const elements={'context-ring':ring,'context-ring-fill':fill,'context-percent':text};
const sandbox={$:id=>elements[id],document:{querySelector:()=>metric}};
vm.createContext(sandbox);
vm.runInContext(script.slice(script.indexOf('function updateContextCapacity('),script.indexOf('function updateUsage(')),sandbox);
for(const [used,expected] of [[0,0],[25,25],[50,50],[100,100],[150,100]]){
 sandbox.updateContextCapacity(used,100);
 assert.equal(fill.attrs['stroke-dashoffset'],String(100-expected));
 assert.equal(ring.attrs['aria-valuenow'],String(expected));
 assert.equal(text.textContent,`· ${expected}%`);
 assert.equal(track.attrs['stroke-dasharray'],undefined);
}
for(const limit of [undefined,0,-1,NaN,Infinity,'错误']){
 sandbox.updateContextCapacity(20,limit);
 assert.equal(ring.attrs['aria-valuenow'],undefined);
 assert.equal(text.textContent,'· —%');
 assert.equal(track.attrs['stroke-dasharray'],'2 3');
}
metric.dataset.contextLimit='200';
sandbox.updateContextCapacity(100);
assert.equal(fill.attrs['stroke-dashoffset'],'50');
assert.equal(text.textContent,'· 50%');
// 走一次消息统计更新，确保圆环读取同一份 Token 总量。
elements['context-usage']=element();elements['duration-usage']=element();elements['cost-usage']=element();
Object.assign(sandbox,{renderCompression(){},current:()=>({messages:[{role:'user',text:'a'},{role:'assistant',text:'b'}],modelConfig:{contextWindowTokens:100}}),runs:new Map(),active:'test',estimateTokens:()=>25,formatDuration:()=> '—',formatEstimatedCost:()=> '—'});
vm.runInContext(script.slice(script.indexOf('function updateUsage('),script.indexOf('function updateRunning(')),sandbox);
sandbox.updateUsage();
assert.equal(elements['context-usage'].textContent,'50');
assert.equal(text.textContent,'· 50%');
sandbox.runs.set('test',{partial:'c',started:Date.now()});
sandbox.updateUsage();
assert.equal(elements['context-usage'].textContent,'75');
assert.equal(text.textContent,'· 75%');
assert.ok(html.includes('pathLength="100" stroke-dasharray="100 100" stroke-dashoffset="100"'));
const region=html.match(/<span class="usage-metric" data-od-id="context-capacity"[\s\S]*?<\/strong><\/span>/)[0];
assert.ok(!region.includes('gauge-needle'));
console.log('圆环 0/25/50/100%、越界、未知容量及消息更新检查通过');
