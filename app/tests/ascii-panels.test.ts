import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { asciiPanelBlocks, parseAsciiDiagram } from '../src/shared/ascii-diagram.js';
import { cachedAsciiPanels } from '../src/client/chat/ascii-diagram-cache.js';
import { DerivedCache } from '../src/client/chat/derived-cache.js';
import { Markdown } from './markdown-fixture.js';
import { usagePanel } from './fixtures/ascii-usage-panel.js';

const render = (source: string, language = 'text', extra = {}) => renderToStaticMarkup(createElement(Markdown, {text: `\`\`\`${language}\n${source}\n\`\`\``, ...extra}));
const good = '┌──────┬──────┐\n│left  │right │\n└──────┴──────┘';

test('real UI wireframe converts three independent panels and preserves source ranges', () => {
  assert.equal(parseAsciiDiagram(usagePanel), undefined, 'flow/table contract unchanged');
  const panels = asciiPanelBlocks(usagePanel);
  assert.equal(panels.length, 3);
  assert.deepEqual(panels.map(p => p.diagram.alignment), [{rows: 3, maxShift: 1}, {rows: 2, maxShift: 1}, {rows: 3, maxShift: 2}]);
  for (const panel of panels) assert.equal(usagePanel.slice(panel.start, panel.end), panel.text);
  const html = render(usagePanel);
  assert.equal((html.match(/class="ascii-diagram-svg"/g) ?? []).length, 3);
  assert.match(html, /字符图 · 已对齐/);
  assert.match(html, /更多筛选/);
  assert.match(html, /调用明细/);
  assert.match(html, /已核对状态/);
  const crlf = usagePanel.replaceAll('\n', '\r\n');
  for (const panel of asciiPanelBlocks(crlf)) assert.equal(crlf.slice(panel.start, panel.end), panel.text);
  assert.equal(asciiPanelBlocks(crlf).length, 3);
});

test('panel padding repair is bounded at each original boundary and never clips labels', () => {
  assert.equal(asciiPanelBlocks(good).length, 1);
  assert.equal(asciiPanelBlocks(good.replace('left  ', 'left')).length, 1, 'add two spaces');
  assert.equal(asciiPanelBlocks(good.replace('left  ', 'left    ')).length, 1, 'remove two spaces');
  for (const source of [
    good.replace('left  ', 'left     '), // three columns
    good.replace('left  ', 'far-too-long'), // cannot fit within bounded expansion
    good.replace('left  │right ', 'left    │right   '), // cumulative boundary shift > 2
    good.replace('│left', ' │left'), // leading edge cannot move
    good.replace('──────┴', '─────┴'), // mismatched bottom anchor
    good.replace('│right │', '│right ││'), // extra border
    good.replace('left  ', 'left\t'),
    good.replace('left  ', 'left\u00a0\u00a0\u00a0\u00a0\u00a0'), // NBSP is not removable padding
    good.replace('left  ', 'left\u3000\u3000\u3000'),
  ]) assert.deepEqual(asciiPanelBlocks(source), [], source);
});

test('tables, unsupported styles, nesting, incomplete and ambiguous frames remain literal', () => {
  for (const source of [
    '+------+-------+\n| key  | value |\n+------+-------+\n| a    | b     |\n+------+-------+',
    '┌──────┬──────┐\n│key   │value │\n├──────┼──────┤\n│a     │b     │\n└──────┴──────┘',
    good.replaceAll('─', '━'), good.replaceAll('│', '║'),
    good.replace('left  ', '┌──┐  '), good.split('\n').slice(0,2).join('\n'),
    good.replace('┐', '┐ note'), good.replace('left  ', 'l│ft  '),
    good.replace('left  ', '\u202eleft '),
  ]) assert.deepEqual(asciiPanelBlocks(source), [], source);
  assert.equal(asciiPanelBlocks('┌──┐\n│A │\n└──┘').length, 1);
});

test('bad panels do not poison adjacent panels or consume surrounding literal text', () => {
  const bad = good.replace('left  ', 'left      ');
  const source = `before\n${good}\n\nbetween\n${bad}\n\n${good}\nafter`;
  const panels = asciiPanelBlocks(source);
  assert.equal(panels.length, 2);
  const middle = source.slice(panels[0].end, panels[1].start);
  assert.ok(middle.includes(bad));
  const html = render(source);
  assert.equal((html.match(/class="ascii-diagram-svg"/g) ?? []).length, 2);
  assert.match(html, /between/);
  assert.match(html, /left      /);
  assert.equal(asciiPanelBlocks(`┌──┐\n${good}`).length, 1, 'unfinished panel does not swallow next top');
});

test('panel labels keep literal operators, nested ASCII and arrows rather than inventing strokes', () => {
  const mixed = '┌──────────────┬──┐\n│ C++ / a--b   │X │\n│ a --> b     │X │\n│ +----+       │X │\n│ |code|       │X │\n│ +----+       │X │\n│ 中文é👩‍💻     │X │\n└──────────────┴──┘';
  const [panel] = asciiPanelBlocks(mixed);
  assert.ok(panel);
  assert.ok(panel.diagram.strokes.every(s => s.y === 0 || s.y === 7 || [0,15,18].includes(s.x)));
  assert.ok(panel.diagram.labels.some(l => l.text === '-->'));
  assert.ok(panel.diagram.labels.some(l => l.text === 'C++'));
  assert.ok(panel.diagram.labels.some(l => l.text === '|code|'));
  assert.equal(parseAsciiDiagram(mixed), undefined, 'this fixture exercises the panel fallback at the real entrance');
  const html = render(mixed);
  assert.equal((html.match(/<path /g) ?? []).length, panel.diagram.strokes.length);
  assert.match(html.replace(/<[^>]*>/gu, ''), /C\+\+/);
});

test('panel fallback never detaches adjacent unsupported flow connectors', () => {
  for (const connector of ['    ↘', '    ↗ next', '  │    │', '  │ step', '   /  \\', '   ↓ next']) {
    assert.deepEqual(asciiPanelBlocks(good + '\n' + connector), [], connector);
    assert.deepEqual(asciiPanelBlocks(connector + '\n' + good), [], connector);
  }
  assert.equal(asciiPanelBlocks(good + '\n\n    ↘').length, 1, 'blank line separates an independent panel');
});

test('fence language, streaming and compact gates remain intact; paragraph parsing is unchanged', () => {
  for (const language of ['', 'text', 'txt', 'plain', 'plaintext', 'ascii']) assert.match(render(usagePanel, language), /ascii-diagram-svg/);
  for (const language of ['typescript', 'sql', 'json']) assert.doesNotMatch(render(usagePanel, language), /ascii-diagram-svg/);
  assert.doesNotMatch(render(usagePanel, 'text', {streaming: true}), /ascii-diagram-svg/);
  assert.doesNotMatch(render(usagePanel, 'text', {compact: true}), /ascii-diagram-svg/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(Markdown, {text: usagePanel})), /ascii-diagram-svg/);
});

test('whole-fence budgets and positive/negative panel caching are enforced', () => {
  for (const source of [good + '\nx'.repeat(120), good + '\n' + 'x'.repeat(241), good + '\n' + 'x'.repeat(24001), good + '\n' + ('x'.repeat(239) + '\n').repeat(70)]) assert.deepEqual(asciiPanelBlocks(source), []);
  const cache = new DerivedCache();
  assert.equal(cachedAsciiPanels(cache, usagePanel), cachedAsciiPanels(cache, usagePanel));
  assert.equal(cachedAsciiPanels(cache, 'plain text'), cachedAsciiPanels(cache, 'plain text'));
  assert.deepEqual(cachedAsciiPanels(null, usagePanel), asciiPanelBlocks(usagePanel));
});
