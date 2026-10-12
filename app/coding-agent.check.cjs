// Run: node coding-agent.check.cjs — dependency-free interaction regression check.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(require('node:path').join(__dirname, 'coding-agent.html'), 'utf8');
const nodes = new Map();
const storage = new Map();
let mobile = false;
function element(id) {
  if (!nodes.has(id)) {
    const classes = new Set();
    nodes.set(id, {
      value: id === 'mode' ? 'code' : '', innerHTML: '', textContent: '', disabled: false,
      classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c), toggle(c) { if(classes.delete(c)) return false; classes.add(c); return true; } },
      setAttribute(k,v) { this[k] = v; }, focus() {}, replaceChildren() {},
      querySelector() { return this.innerHTML.includes('<button') ? {} : null; },
      dispatchEvent() { this.oninput?.(); }, click() { this.onclick?.(); }
    });
  }
  return nodes.get(id);
}
const context = vm.createContext({
  document: { getElementById: element, addEventListener() {} }, window: {}, console,
  localStorage: { getItem: k => storage.get(k) || null, setItem: (k,v) => storage.set(k,v) },
  structuredClone, matchMedia: () => ({ matches: mobile }), Event: class {}, setTimeout
});
vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
assert.match(element('messages').innerHTML, /useDebounce/);
element('collapse-history').click();
assert(element('app').classList.contains('sidebar-collapsed'));
element('toggle-history').click();
assert.equal(element('toggle-history')['aria-expanded'], 'true');
element('new-chat').click();
assert.match(element('messages').innerHTML, /今天，我们写点什么/);
element('content').onclick({target:{closest: selector => selector === '[data-prompt]' ? {dataset:{prompt:'检查输入边界'}} : null}});
assert.equal(element('prompt').value, '检查输入边界');
assert.equal(element('send').disabled, false);
element('prompt').value = '<script>测试</script>';
element('composer').onsubmit({preventDefault(){}});
assert.match(element('messages').innerHTML, /&lt;script&gt;测试&lt;\/script&gt;/);
assert(!element('messages').innerHTML.includes('empty-state'));
assert.equal(element('send').disabled, true);
const saved = JSON.parse(storage.get('coding-agent-v1'));
assert.equal(saved.sessions.find(s => s.id === saved.active).messages.length, 2);
element('search').value = '无匹配的长搜索内容';
element('search').oninput();
assert.match(element('history').innerHTML, /没有匹配的对话/);
mobile = true;
element('toggle-history').click();
assert(element('app').classList.contains('history-open'));
element('close-history').click();
assert(!element('app').classList.contains('history-open'));
assert.equal(element('toggle-history')['aria-expanded'], 'false');
assert(!/scrollIntoView|\[REPLACE\]|https?:\/\//.test(html));
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m=>m[1]);
assert.equal(ids.length, new Set(ids).size);
console.log('通过：侧栏切换、新建会话、快捷提示、发送、转义、搜索、本地保存与移动端关闭');
