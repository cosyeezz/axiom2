const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('coding-agent-v2.html','utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
new vm.Script(script);
const nodes={},session={messages:[]},runs=new Map();let now=10000;
const ctx=vm.createContext({Number,Math,Date:{now:()=>now},active:'test',runs,sessions:[session],current:()=>session,findSession:id=>id===session.id?session:undefined,$:id=>nodes[id]??={},estimateTokens:()=>0,clearInterval:()=>{},document:{visibilityState:'visible'},render:()=>vm.runInContext('updateUsage()',ctx),history:()=>{},save:()=>{}});
session.id='test';
for(const name of ['formatDuration','updateUsage','finishRun'])vm.runInContext(script.match(new RegExp('function '+name+'\\([^]*?\\n}'))[0],ctx);
for(const [input,expected] of [[undefined,'—'],[-1,'—'],[0,'0 秒'],[59999,'59 秒'],[60000,'1 分 0 秒'],[125000,'2 分 5 秒']])assert.equal(ctx.formatDuration(input),expected);
ctx.updateUsage();assert.equal(nodes['duration-usage'].textContent,'—');
for(const stopped of [false,true]){
 runs.set('test',{started:1000,reply:'演示',partial:'',timer:null});ctx.updateUsage();assert.equal(nodes['duration-usage'].textContent,'9 秒');
 ctx.finishRun('test',stopped);assert.equal(session.messages.at(-1).durationMs,9000);
 now=15000;ctx.updateUsage();assert.equal(nodes['duration-usage'].textContent,'9 秒');now=10000;
}
assert.equal(JSON.parse(JSON.stringify(session)).messages.at(-1).durationMs,9000);
assert.match(html,/data-od-id="run-duration"/);
console.log('耗时检查通过：未记录、实时计时、分秒换算、完成、停止及保存');
