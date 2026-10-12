// Run: node session-initialization.check.cjs — no browser or dependencies.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const file = 'coding-agent-v2-before-subagent-modal-v2.html';
const html = fs.readFileSync(require('node:path').join(__dirname, file), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
new vm.Script(script);
const nodes = new Map();
const context = vm.createContext({
 $: id => { if (!nodes.has(id)) nodes.set(id, {dataset:{},querySelectorAll(){return []}}); return nodes.get(id); },
 escapeHTML: value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
 markCurrentRead(){}, renderWorkspace(){}, renderModel(){}, history(){}, updateRunning(){}
});
const markdownEngine=html.match(/<script id="markdown-engine">([\s\S]*?)<\/script>/)?.[1];
if(markdownEngine)vm.runInContext(markdownEngine,context);
vm.runInContext('let session; function current(){return session;}', context);
vm.runInContext(script.slice(script.indexOf('const demoRegisteredTools='), script.indexOf('function resizePrompt()')), context);
function render(session) {
 context.sessionInput = session;
 vm.runInContext('session=sessionInput;render()', context);
 return nodes.get('messages').innerHTML;
}
const empty = render({title:'新对话', messages:[]});
assert(empty.indexOf('session-initialization') < empty.indexOf('empty-state'));
assert(empty.includes('系统提示词') && empty.includes('工具注册'));
assert(empty.includes('原型示例 · 未连接运行时'));
assert(empty.includes('不是实际模型收到的系统提示词'));
assert(empty.includes('未实际注册或执行'));
assert(!/<details\b[^>]*\bopen(?:\s|=|>)/.test(empty), 'initialization starts collapsed');
assert.equal((empty.match(/class="registered-tool"/g)||[]).length, 4);
const ids = [...empty.matchAll(/data-od-id="([^"]+)"/g)].map(m=>m[1]);
assert.equal(ids.length, new Set(ids).size);
const tools = JSON.parse(vm.runInContext('JSON.stringify(demoRegisteredTools)', context));
for (const tool of tools) {
 assert.equal(tool.parameters.type, 'object');
 assert(tool.parameters.required.every(key => key in tool.parameters.properties));
 assert(empty.includes(`registered-tool-schema-${tool.name}`));
}
const historical = {title:'已有会话',messages:[{role:'user',text:'检查代码 <script>'}]};
const before = JSON.stringify(historical);
const historyHTML = render(historical);
assert(historyHTML.indexOf('session-initialization') < historyHTML.indexOf('message-0'));
assert(historyHTML.includes('检查代码 &lt;script&gt;'));
assert.equal(JSON.stringify(historical), before, 'metadata does not alter messages or counts');
const child = render({parentId:'parent',title:'检查 <img src=x onerror=alert(1)>',messages:[]});
assert(child.includes('子代理 · 只读'));
assert(child.includes('你是负责「检查 &lt;img'));
assert(!child.includes('<img'));
assert(render(historical).includes('主会话 · 只读'), 'switching back restores parent role');
assert.equal((nodes.get('messages').innerHTML.match(/data-od-id="session-initialization"/g)||[]).length, 1);
assert(html.includes('.session-init pre{') && html.includes('white-space:pre-wrap;overflow-wrap:anywhere'));
assert(!html.includes('scrollIntoView('));
console.log('通过：新会话与历史会话置顶展示、默认折叠、工具参数结构、子代理角色切换、内容转义、唯一标识、消息记录不变、脚本语法检查');
