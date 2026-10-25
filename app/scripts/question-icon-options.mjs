// Reproducible, static icon contact sheets; never connects to the Axiom backend.
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
const docs = resolve('../docs');
const groups = [
  ['提问与对话', [
    ['message-circle-question-mark', '对话提问'], ['message-square-check', '对话确认'],
    ['circle-question-mark', '圆形问号'], ['badge-question-mark', '提问徽章'], ['file-question-mark', '待确认文档'],
    ['messages-square', '往返对话'], ['message-circle', '简洁气泡'], ['message-square-text', '文本对话'],
    ['message-circle-more', '等待回应'], ['message-square-more', '更多回复'],
  ]],
  ['确认与完成', [
    ['circle-check', '圆形确认'], ['circle-check-big', '开放圆勾'], ['badge-check', '确认徽章'],
    ['square-check', '方形确认'], ['square-check-big', '开放方勾'], ['list-checks', '多项确认'],
    ['clipboard-check', '清单验收'], ['file-check', '文档确认'], ['check-check', '双勾确认'], ['shield-check', '安全确认'],
  ]],
  ['选择与配置', [
    ['list-filter', '筛选选择'], ['list-todo', '待选列表'], ['list-ordered', '按序选择'], ['list', '简洁列表'],
    ['rows-3', '纵向选项'], ['columns-2', '并列方案'], ['sliders-horizontal', '参数调节'], ['settings-2', '配置选项'],
    ['toggle-right', '切换状态'], ['circle-dot', '单选标记'],
  ]],
  ['方向与决策', [
    ['git-fork', '分支选择'], ['git-branch', '方案分支'], ['split', '路径分流'], ['route', '执行路径'],
    ['signpost', '方向路标'], ['waypoints', '节点选择'], ['workflow', '流程决策'], ['compass', '方向指南'],
    ['navigation', '前进方向'], ['arrow-right-left', '双向切换'],
  ]],
  ['回复与输入', [
    ['send', '发送回答'], ['send-horizontal', '水平发送'], ['reply', '简洁回复'], ['reply-all', '统一回复'],
    ['corner-up-left', '返回回复'], ['pen-line', '填写答案'], ['notebook-pen', '补充说明'], ['square-pen', '编辑答案'],
    ['text-cursor-input', '自由输入'], ['keyboard', '键盘输入'],
  ]],
];
const recommended = new Set([1, 3, 11, 14, 16, 22, 30, 41, 46]);
const headers = { 'User-Agent': 'Axiom-icon-options', Accept: 'application/vnd.github+json' };
const commitResponse = await fetch('https://api.github.com/repos/lucide-icons/lucide/commits/main', { headers });
assert.ok(commitResponse.ok, `Lucide commit HTTP ${commitResponse.status}`);
const { sha } = await commitResponse.json();
assert.match(sha, /^[a-f0-9]{40}$/);
const base = `https://raw.githubusercontent.com/lucide-icons/lucide/${sha}`;
const fetchText = async path => { const r = await fetch(`${base}/${path}`);assert.ok(r.ok, `${path}: HTTP ${r.status}`);return r.text(); };
const license = await fetchText('LICENSE');
const icons = [];
for (const [group, items] of groups) {
  const entries = await Promise.all(items.map(async ([name, label]) => {
    const svg = await fetchText(`icons/${name}.svg`);
    assert.match(svg, /viewBox="0 0 24 24"/);
    assert.ok(!/<script|<foreignObject|\bon\w+\s*=|https?:\/\/(?!www\.w3\.org)/i.test(svg), `Unsafe SVG: ${name}`);
    return { group, name, label, svg };
  }));
  icons.push(...entries);
}
assert.equal(icons.length, 50);assert.equal(new Set(icons.map(i => i.name)).size, 50);
const css = `:root{--bg:#08090a;--surface:#191a1b;--fg:#f7f8f8;--muted:#8a8f98;--border:#ffffff18;--accent:#f0995b}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 -apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif}main{width:1120px;padding:32px;margin:auto}h1{margin:0;font-size:26px;font-weight:600;letter-spacing:-.5px}.intro{margin:8px 0 24px;color:var(--muted);font-size:13px}section{margin-top:20px}h2{display:flex;align-items:baseline;gap:12px;margin:0 0 10px;font-size:14px;font-weight:600}h2 small{font-size:11px;font-weight:400;color:var(--muted)}.grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}.tile{display:grid;grid-template-columns:1fr auto;gap:7px 8px;min-width:0;padding:12px;border:1px solid var(--border);border-radius:8px;background:var(--surface)}.number{font:12px/1.5 ui-monospace,monospace;color:var(--muted)}.rec{font-size:10px;color:var(--accent)}.symbols{display:flex;align-items:center;gap:18px;grid-column:1/-1;height:30px;color:var(--fg)}svg{width:24px;height:24px;stroke-width:1.65;flex-shrink:0}.small svg{width:16px;height:16px;stroke-width:1.65}.label{grid-column:1/-1;font-size:13px}.name{grid-column:1/-1;color:var(--muted);font:10px/1.5 ui-monospace,monospace;overflow-wrap:anywhere}.recommended{border-color:color-mix(in srgb,var(--accent) 48%,var(--border))}footer{margin-top:20px;color:var(--muted);font-size:11px}.light{--bg:#f6f7f8;--surface:#fff;--fg:#191a1b;--muted:#686d76;--border:#191a1b20;--accent:#995020}`;
let offset = 0;
const sections = groups.map(([group, items]) => {
  const start = offset;
  const tiles = icons.slice(start, start + items.length).map((icon, i) => {
    const id = start + i + 1, rec = recommended.has(id);
    return `<article class="tile${rec ? ' recommended' : ''}" data-id="${id}"><span class="number">${String(id).padStart(2, '0')}</span>${rec ? '<span class="rec">推荐</span>' : '<span></span>'}<div class="symbols">${icon.svg}<span class="small">${icon.svg}</span></div><span class="label">${icon.label}</span><span class="name">${icon.name}</span></article>`;
  }).join('');
  offset += items.length;
  return `<section><h2>${group}<small>${String(start + 1).padStart(2, '0')}–${String(offset).padStart(2, '0')}</small></h2><div class="grid">${tiles}</div></section>`;
}).join('');
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>问题卡片 · 50 个图标备选</title><style>${css}</style><main><h1>问题卡片 · 50 个图标备选</h1><p class="intro">Lucide 统一线性风格 · 每款展示 24px / 16px 两种尺寸 · 暖色边框为优先推荐 · 按编号挑选即可</p>${sections}<footer>来源：lucide.dev / lucide-icons/lucide · 保留原始 SVG · 许可见 question-icon-options-LICENSE.txt · 未替换产品内图标</footer></main></html>`;
await mkdir(resolve(docs, 'images'), { recursive: true });
await writeFile(resolve(docs, 'question-icon-options.html'), html);
await writeFile(resolve(docs, 'question-icon-options-LICENSE.txt'), `Source: https://github.com/lucide-icons/lucide/tree/${sha}\nFetched: ${new Date().toISOString()}\n\n${license}`);
const lines = icons.map((icon, i) => `| ${String(i + 1).padStart(2, '0')} | ${icon.group} | ${icon.label} | [${icon.name}](https://lucide.dev/icons/${icon.name}) | ${recommended.has(i + 1) ? '推荐' : ''} |`);
await writeFile(resolve(docs, 'question-icon-options.md'), `# 问题卡片图标备选\n\n50 个不同 Lucide 图标，按卡片使用场景分组；只是候选，不代表已经应用。每个图标预览展示 24px 与 16px。\n\n- [静态图板](question-icon-options.html)（页面添加 class=light 可看浅色）\n- [暗色预览](images/question-icon-options-dark.png)\n- [浅色预览](images/question-icon-options-light.png)\n- [上游与许可证](question-icon-options-LICENSE.txt)，固定提交 ${sha}\n\n| 编号 | 场景 | 名称 | 原始图标 | 建议 |\n| --- | --- | --- | --- | --- |\n${lines.join('\n')}\n`);
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
try {
  const page = await browser.newPage({ viewport: { width: 1120, height: 1000 }, deviceScaleFactor: 2 });
  const requests = [], errors = [];
  await page.route('**/*', route => { requests.push(route.request().url());return route.abort(); });
  page.on('pageerror', e => errors.push(e.message));
  await page.setContent(await readFile(resolve(docs, 'question-icon-options.html'), 'utf8'));
  assert.equal(await page.locator('.tile').count(), 50);
  assert.equal(await page.locator('svg').count(), 100);
  assert.deepEqual(await page.locator('.tile').evaluateAll(els => els.map(el => Number(el.dataset.id))), Array.from({ length: 50 }, (_, i) => i + 1));
  for (const theme of ['dark', 'light']) {
    await page.locator('html').evaluate((el, theme) => { el.className = theme; }, theme);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: resolve(docs, `images/question-icon-options-${theme}.png`), fullPage: true });
  }
  assert.deepEqual(requests, []);assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'PASS', count: 50, svg: 100, sha, html: resolve(docs, 'question-icon-options.html'), images: ['dark', 'light'].map(t => resolve(docs, `images/question-icon-options-${t}.png`)), networkRequestsDuringRendering: requests.length }));
} finally { await browser.close(); }
