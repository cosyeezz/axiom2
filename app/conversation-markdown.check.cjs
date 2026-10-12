// Run: node conversation-markdown.check.cjs — offline, no browser or dependencies.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'coding-agent-v2-before-subagent-modal-v2.html'),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
new vm.Script(script);
const messages={dataset:{},innerHTML:'',querySelectorAll(){return []}},nodes={messages,'chat-title':{}};
const ctx=vm.createContext({console,$:id=>nodes[id],markCurrentRead(){},renderWorkspace(){},renderModel(){},history(){},updateRunning(){},subagentConversation(){return '<section>子代理协作</section>'}});
vm.runInContext(html.match(/<script id="markdown-engine">([\s\S]*?)<\/script>/)[1],ctx);
vm.runInContext(script.slice(script.indexOf('const escapeHTML='),script.indexOf('const exampleCode=')),ctx);
vm.runInContext(script.slice(script.indexOf('const demoRegisteredTools='),script.indexOf('function resizePrompt()')),ctx);
const run=code=>vm.runInContext(code,ctx);
function md(text){ctx.input=text;return run('renderMarkdown(input,"check")');}
const sample='# 标题\n\n## 二级\n\n**重点**、*强调*、~~删除~~ 与 `code`\n\n> 注意边界\n\n- 项目\n  - 子项目\n- [x] 已完成\n- [ ] 待完成\n\n1. 第一步\n2. 第二步\n\n| 范围 | 状态 |\n| --- | --- |\n| 代码 | 待验证 |\n\n---\n\n```ts\nconst x = "<script>";\n```\n\n[说明](https://example.com)';
const output=md(sample);
for(const fragment of ['<h1','<h2','<strong>重点</strong>','<em>强调</em>','<del>删除</del>','<code>code</code>','<blockquote>','<ul>','<ol>','type="checkbox"','<table>','<hr>','data-code-copy','&lt;script&gt;','rel="noopener noreferrer"'])assert(output.includes(fragment),fragment);
assert.equal((output.match(/class="table-scroll"/g)||[]).length,1);
for(const attack of ['<img src=x onerror=alert(1)>','<script>alert(1)</script>','<svg onload=alert(1)>','<a href="javascript:alert(1)">恶意</a>','[恶意](javascript:alert%281%29)','[恶意](java&#x73;cript:alert%281%29)','[恶意](data:text/html,test)','[恶意](vbscript:test)','![图片](https://example.com/image.png)']){
 const rendered=md(attack);
 assert(!/<(?:img|script|svg)\b/i.test(rendered),rendered);
 assert(!/href="(?:javascript|data|vbscript):/i.test(rendered),rendered);
 assert(!/<[^>]+\son(?:error|load)=/i.test(rendered),rendered);
}
assert(md('[邮件](mailto:hello@example.com)').includes('href="mailto:hello@example.com"'));
assert(md('[链接](https://example.com/?a=1&b=2)').includes('&amp;b=2'));
assert(md('```html\n<b>未闭合代码').includes('&lt;b&gt;未闭合代码'));
assert(md('line 1\nline 2').includes('<br>'));
// Semantic Markdown alerts reuse the shared renderer, including streaming and nested content.
for(const [type,tone,label] of [['NOTE','note','说明'],['TIP','success','建议'],['IMPORTANT','important','重点'],['WARNING','warning','注意'],['CAUTION','danger','风险']]){
 const alert=md(`> [!${type}]\n> **关键内容** 与 [说明](https://example.com)\n>\n> - 子项`);
 assert(alert.includes(`data-tone="${tone}"`),alert);assert(alert.includes(`aria-label="${label}"`));
 assert(alert.includes('<strong>关键内容</strong>'));assert(alert.includes('<ul>'));assert(!alert.includes(`[!${type}]`));
}
assert(md('> [!warning]\n> 注意').includes('data-tone="warning"'));
assert(md('> 普通引用').includes('<blockquote>'));
assert(!md('> [!UNKNOWN]\n> 未知类型').includes('md-highlight'));
assert(!md('`[!WARNING]`\n\n```md\n> [!CAUTION]\n```').includes('md-highlight'));
assert(!md('> [!WARN').includes('md-highlight'));
const nested=md('> [!WARNING]\n> ## 注意\n>\n> > [!CAUTION]\n> > <script>alert(1)</script>\n>\n> ```js\n> safe()\n> ```\n\n> [!TIP]\n> 建议');
assert(nested.includes('&lt;script&gt;'));assert(!nested.includes('<script>'));
const alertIds=[...nested.matchAll(/data-od-id="([^"]+)"/g)].map(m=>m[1]);assert.equal(alertIds.length,new Set(alertIds).size);
ctx.message={role:'assistant',kind:'notice',text:'> [!WARNING]\n> 请确认'};assert(run('renderMessage(message,8)').includes('message-notice'));
ctx.message={role:'assistant',stopped:true,text:'已停止'};assert(run('renderMessage(message,9)').includes('message-stopped'));
ctx.message={role:'user',text:'**用户需求**'};
let rendered=run('renderMessage(message,0)');assert(rendered.includes('user-text'));assert(rendered.includes('<strong>用户需求</strong>'));
ctx.message={role:'assistant',text:'## 关键发现',kind:'progress',activity:[{name:'read',status:'failed',input:{path:'<test>'},output:'权限不足 <script>'}]};
rendered=run('renderMessage(message,1)');
assert(rendered.includes('message-progress'));assert(rendered.includes('需要处理 · 1 项失败'));assert(rendered.includes('工具调用 · 1 项'));
assert(rendered.indexOf('execution-alert')<rendered.indexOf('<details'));
assert(!/<details[^>]*\sopen[\s=>]/.test(rendered));assert(rendered.includes('&lt;script&gt;'));assert(rendered.includes('&lt;test&gt;'));
ctx.message={role:'assistant',text:'## 最终答复\n\n```js\nfirst()\n```\n\n```py\nsecond()\n```'};
rendered=run('renderMessage(message,2)');assert(rendered.includes('message-result'));assert(rendered.includes('复制回复'));
const ids=[...rendered.matchAll(/data-od-id="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size);
ctx.message={role:'assistant',text:'已停止',stopped:true};assert(run('renderMessage(message,3)').includes('回复已停止'));
ctx.message={role:'assistant',text:'请确认',kind:'notice'};assert(run('renderMessage(message,4)').includes('请确认'));
// No identity/category headings: content carries the hierarchy in every shared view.
for(const message of [{role:'user',text:'**重点** 与 `value`'},{role:'assistant',kind:'progress',text:'检查完成',activity:['read']},{role:'assistant',text:'内容'},{role:'assistant',text:'协作',subagentDemo:true}]){
 ctx.message=message;const view=run('renderMessage(message,5)');
 assert(!view.includes('message-label'));assert(!view.includes('message-category'));
 assert(!/<strong>(?:你|执行进展|答复)<\/strong>/.test(view));
}
assert(!html.includes('.user-text.markdown strong'));assert(!html.includes('.md-highlight-body strong'));
for(const token of ['keyword','string','number','literal','comment'])assert(html.includes(`.markdown .tok-${token}`));
assert(html.includes('.markdown :not(pre)>code,.markdown .tok-string'));
assert(html.includes('.markdown strong,.markdown .tok-keyword'));
assert(!/\.markdown a:hover\{[^}]*\bcolor:/.test(html),'链接悬停应保留固定语义色');
// Highlight only escaped text; removing generated spans recovers the original escaped source.
const source='const value = "<img src=x onerror=alert(1)>"; // return 99\nreturn true ? 300 : 0;';
ctx.source=source;const syntax=run('highlightCode(source,"ts")');
for(const token of ['keyword','string','number','literal','comment'])assert(syntax.includes(`class="tok-${token}"`));
assert.equal(syntax.replace(/<\/?span(?: class="tok-[a-z]+")?>/g,''),run('escapeHTML(source)'));
assert(!syntax.includes('<img'));assert(syntax.includes('&lt;img'));
ctx.source='const a = "return false 30"; /* const 99 */';
const literals=run('highlightCode(source,"js")');
assert.equal((literals.match(/tok-keyword/g)||[]).length,1);assert(!literals.includes('tok-literal'));assert(!literals.includes('tok-number'));
ctx.source='# const 99\nreturn True';assert(run('highlightCode(source,"python")').includes('tok-comment'));
ctx.source='{"name": "const", "enabled": true, "count": 2}';assert(!run('highlightCode(source,"json")').includes('tok-keyword'));
ctx.source='<script>alert(1)</script>';assert.equal(run('highlightCode(source,"html")'),run('escapeHTML(source)'));
for(const source of ['const text = "return false 30','const text = \'return false 30','const text = `return false 30\nconst value']){
 ctx.source=source;const partial=run('highlightCode(source,"ts")');
 assert.equal(partial.replace(/<\/?span(?: class="tok-[a-z]+")?>/g,''),run('escapeHTML(source)'));
 assert(partial.includes('tok-string'));assert(!partial.includes('tok-literal'));assert(!partial.includes('tok-number'));
 assert.equal((partial.match(/tok-keyword/g)||[]).length,1,'未闭合字符串不可重复高亮其内容');
}
ctx.source=source;assert(md('```typescript\n'+source+'\n```').includes('tok-string'));
ctx.message={role:'assistant',text:'示例',code:source};assert(run('renderMessage(message,6)').includes('tok-keyword'));
// Same renderer for historical, user, assistant, child and partial streaming messages.
assert(script.includes("$('run-output').innerHTML=renderMarkdown(run.partial)"));
assert(script.includes("code.closest('.code-card').querySelector('pre code').textContent"));
assert(!/scrollIntoView\(/.test(script));
// Fold state belongs to the rendered session, not whichever session is selected next.
const call={dataset:{foldKey:'execution-1'},open:true};
messages.dataset.sessionId='parent';messages.querySelectorAll=selector=>selector.includes('[open]')?[call]:[call];
run('rememberConversationFolds()');assert.deepEqual(Array.from(run('conversationFolds.get("parent")')),['execution-1']);
run('let session={id:"child",title:"子会话",messages:[]};function current(){return session;}render()');assert.equal(call.open,false);
run('session={id:"parent",title:"主会话",messages:[]};render()');assert.equal(call.open,true);
console.log('通过：无冗余消息标签、共享内容配色、五类安全代码高亮与原文保真、五类彩色提示、Markdown 语法、确认与停止状态、代码复制入口、流式内容、HTML/URL 安全、失败置顶、默认折叠、跨会话折叠恢复、唯一标识、脚本语法');
