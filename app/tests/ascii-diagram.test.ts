import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { asciiDiagramBlocks, diagramCell, diagramLabelRuns, diagramStrokePath, diagramTextWidth, parseAsciiDiagram } from "../src/shared/ascii-diagram.js";
import { Markdown } from "./markdown-fixture.js";
import { diagramCases, realAssistantDiagram } from "./fixtures/ascii-diagram-cases.js";

export const mergeDiagram = [
  "未整理数量达到阈值 ─┐",
  "                    ├→ 尝试获取同一把整理锁",
  "定时检查未整理数据 ─┘       ├─ 失败：本次退出",
  "                            └─ 成功：读取本批数据并整理",
].join("\n");
const render = (text: string, extra = {}) => renderToStaticMarkup(createElement(Markdown, { text, ...extra }));

test("Unicode merge/branches preserve geometry, labels, and finite SVG paths", () => {
  const diagram = parseAsciiDiagram(mergeDiagram)!;
  assert.ok(diagram);
  assert.equal(diagram.rows, 4);
  assert.ok(diagram.strokes.some(stroke => stroke.x === 20 && stroke.y === 0 && stroke.ports === 9));
  assert.ok(diagram.strokes.some(stroke => stroke.x === 20 && stroke.y === 1 && stroke.ports === 14));
  assert.ok(diagram.strokes.some(stroke => stroke.x === 21 && stroke.y === 1 && stroke.arrow === 2));
  assert.ok(diagram.labels.some(label => label.text === "尝试获取同一把整理锁"));
  assert.ok(diagram.labels.some(label => label.text === "失败：本次退出"));
  for (const stroke of diagram.strokes) assert.ok(!/NaN|Infinity|undefined/.test(diagramStrokePath(stroke)));
});

test("real assistant indentation is aligned geometrically without changing labels or adding process lines", () => {
  const diagram = parseAsciiDiagram(realAssistantDiagram)!;
  assert.ok(diagram);
  assert.deepEqual(diagram.alignment, { rows: 2, maxShift: 2 });
  for (const [y, x] of [[0, 20], [1, 20], [2, 20], [2, 28], [3, 28]]) {
    assert.ok(diagram.strokes.some(s => s.y === y && s.x === x && (s.ports & 12)), `${y}:${x}`);
  }
  assert.ok(diagram.strokes.some(s => s.y === 1 && s.x === 21 && s.arrow === 2));
  assert.ok(diagram.labels.some(l => l.text === "尝试获取整理锁（不等待）" && l.x === 23 && l.y === 1));
  assert.ok(diagram.labels.some(l => l.text === "成功：读取本批数据" && l.x === 31 && l.y === 3));
  assert.ok(diagram.labels.some(l => l.text === "执行整理" && l.x === 34 && l.y === 5));
  assert.deepEqual(diagram.labels.filter(l => l.text === "↓").map(l => [l.x, l.y]), [[36, 4], [36, 6], [36, 8]]);
  assert.ok(diagram.strokes.every(s => s.y <= 3), "do not invent lines between isolated arrows and actions");
  const html = render(`\`\`\`text\n${realAssistantDiagram}\n\`\`\``);
  assert.match(html, /ascii-diagram-svg/);
  assert.match(html, /已对齐/);
  assert.ok(!render(`\`\`\`text\n${realAssistantDiagram}\n\`\`\``, { streaming: true }).includes("ascii-diagram-svg"));
});

test("branch alignment is bounded, atomic and leaves correct source coordinates unchanged", () => {
  assert.equal(parseAsciiDiagram(mergeDiagram)!.alignment, undefined);
  for (const id of ["offset-left", "offset-right", "offset-branch"]) {
    const diagram = parseAsciiDiagram(diagramCases.find(c => c.id === id)!.source)!;
    assert.ok(diagram.alignment, id);
    const target = id === "offset-branch" ? { y: 3, x: 6 } : { y: 1, x: 3 };
    assert.ok(diagram.strokes.some(s => s.y === target.y && s.x === target.x), id);
  }
  for (const id of ["offset-ambiguous", "offset-far", "offset-multiple", "misaligned", "emoji", "tree", "table"]) {
    assert.equal(parseAsciiDiagram(diagramCases.find(c => c.id === id)!.source), undefined, id);
  }
  // A movable-looking branch already connected to a different stroke must not
  // be detached to satisfy the outer corners' alignment.
  const connected = "A ─┐│\n    ├→ B\nC ─┘";
  assert.equal(parseAsciiDiagram(connected)?.alignment, undefined);
  const interrupted = "A ─┐\n\n  ├→ B\nC ─┘";
  assert.equal(parseAsciiDiagram(interrupted), undefined);
  const secondFlow = "A ─┐\n  ├→ B ─→ other\nC ─┘";
  assert.equal(parseAsciiDiagram(secondFlow), undefined);
  const styles = realAssistantDiagram.replace("─┐", "━┐");
  assert.equal(parseAsciiDiagram(styles), undefined);
  const overwide = "A ─┐\n  ├→ " + "x".repeat(235) + "\nC ─┘";
  assert.equal(parseAsciiDiagram(overwide), undefined);
});

test("CJK, mixed text, combining graphemes, emoji and tab expansion use display columns", () => {
  assert.equal(diagramTextWidth("中文abc─→"), 9);
  assert.equal(diagramTextWidth("e\u0301"), 1);
  assert.equal(diagramTextWidth("👩‍💻"), 2);
  assert.equal(diagramTextWidth("🇨🇳"), 2);
  assert.equal(diagramTextWidth("全角　"), 6);
  const spaces = "A ─┐\n   ├→ B\nC ─┘";
  const tabbed = "A ──┐\n\t├→ B\nC ──┘";
  assert.ok(parseAsciiDiagram(spaces));
  assert.equal(parseAsciiDiagram(tabbed)!.strokes.find(s => s.y === 1)!.x, 4);
});

test("ASCII and Unicode boxes draw without converting text punctuation", () => {
  for (const source of ["+-----+\n|hello|\n+-----+", "┌────┐\n│中文│\n└────┘", "╭────╮\n│中文│\n╰────╯"]) {
    assert.ok(parseAsciiDiagram(source), source);
  }
  const source = "+--------+\n|v <test>|\n+--------+";
  assert.ok(parseAsciiDiagram(source)!.labels.some(label => label.text.includes("<test>")));
});

test("short vertical arrows between labels and punctuation-rich labels stay faithful", () => {
  for (const arrow of ["v", "↓"]) {
    const source = `Start\n  |\n  ${arrow}\n Done`;
    assert.ok(parseAsciiDiagram(source), source);
    assert.equal(asciiDiagramBlocks(source).length, 1);
  }
  for (const label of ["C++", "a--b", "+1", "-2"]) {
    const source = `┌──────┐\n│ ${label.padEnd(5)}│\n└──────┘`;
    const diagram = parseAsciiDiagram(source)!;
    assert.ok(diagram);
    assert.ok(diagram.labels.some(item => item.text === label), label);
    assert.ok(!diagram.strokes.some(stroke => stroke.y === 1 && stroke.x > 0 && stroke.x < 7));
  }
});

test("plain text, trees, Markdown tables and isolated/incomplete strokes stay literal", () => {
  for (const source of ["hello\nworld", "A --> B", "A --> B\nC --> D", "├── src\n│   ├── a.ts\n│   ├── b.ts\n│   ├── c.ts\n│   └── d.ts\n└── package.json", "| A | B |\n| --- | --- |\n| x | y |", "┌──\n│partial", "a + b\nc - d", "┐ text\n┘ other"]) {
    assert.equal(parseAsciiDiagram(source), undefined, source);
  }
});

test("composition corpus only beautifies supported, sufficiently aligned diagrams", () => {
  for (const sample of diagramCases) {
    assert.equal(!!parseAsciiDiagram(sample.source), !sample.fallback, sample.id);
  }
});

test("unsupported diagram code remains unwrapped without changing explicit programming code", () => {
  for (const sample of diagramCases.filter(sample => sample.fallback)) {
    const html = render(`\`\`\`text\n${sample.source}\n\`\`\``);
    assert.ok(!html.includes("ascii-diagram-svg"), sample.id);
    assert.match(html, /<pre[^>]*class="ascii-diagram-source"/, sample.id);
  }
  assert.ok(!render("```typescript\n┏━━━━┓\n┃code┃\n┗━━━━┛\n```").includes("ascii-diagram-source"));
});

test("body punctuation and repeated v-containing words are never consumed by box geometry", () => {
  for (const id of ["ascii-math", "words", "literal-arrows", "increments"]) {
    const source = diagramCases.find(test => test.id === id)!.source;
    const diagram = parseAsciiDiagram(source)!;
    assert.ok(diagram);
    assert.ok(diagram.strokes.every(stroke => stroke.y === 0 || stroke.y === diagram.rows - 1 || stroke.x === 0 || stroke.x === diagram.columns - 1), id);
    assert.equal(diagram.labels.map(label => label.text).join(""), source.split("\n").slice(1, -1).map(line => line.slice(1, -1).replace(/\s/gu, "")).join(""), id);
  }
});

test("nested ASCII boxes need real edges and arrow tails must be confirmed non-arrow strokes", () => {
  const nested = parseAsciiDiagram(diagramCases.find(test => test.id === "nested-ascii")!.source)!;
  assert.ok(nested.strokes.some(stroke => stroke.x === 2 && stroke.y === 1 && stroke.ports === 10));
  assert.ok(nested.labels.some(label => label.text === "child"));
  assert.equal(parseAsciiDiagram("A\nv\nv\n│\nB"), undefined);
  const chain = parseAsciiDiagram(diagramCases.find(test => test.id === "arrow-chain")!.source)!;
  assert.ok(chain);
  assert.equal(chain.strokes.filter(stroke => stroke.arrow).length, 0);
  assert.equal(chain.labels.filter(label => label.text === "v").length, 2);
  for (const source of [mergeDiagram, "A\n│\n↓\nB", "A\n^\n|\nB", "A ←┐\n   │\nB ─┘"]) {
    const diagram = parseAsciiDiagram(source)!;
    assert.ok(diagram, source);
    for (const stroke of diagram.strokes.filter(stroke => stroke.arrow)) {
      const dx = stroke.arrow === 2 ? -1 : stroke.arrow === 1 ? 1 : 0;
      const dy = stroke.arrow === 8 ? -1 : stroke.arrow === 4 ? 1 : 0;
      assert.ok(diagram.strokes.some(tail => !tail.arrow && tail.x === stroke.x + dx && tail.y === stroke.y + dy), source);
    }
  }
});

test("mixed scripts anchor to source columns without stretching or spreading CJK words", () => {
  const runs = diagramLabelRuns({ text: "中文AB，Ｃé👩‍💻", x: 2, y: 1, width: 13 });
  assert.deepEqual(runs.map(g => g.text), ["中文", "A", "B", "，", "Ｃ", "é", "👩‍💻"]);
  assert.deepEqual(runs.map(g => g.center), [4, 6.5, 7.5, 9, 11, 12.5, 14]);
  const html = render("```text\n┌──────┐\n│中文AB│\n└──────┘\n```");
  assert.match(html, /<tspan[^>]*text-anchor="middle"/);
  assert.ok(!html.includes("textLength="));
  assert.equal(diagramCell.width, 8.5);
});

test("rounded corners are curves, unsupported styles and diagonals remain literal", () => {
  const diagram = parseAsciiDiagram("╭────╮\n│中文│\n╰────╯")!;
  assert.equal(diagram.strokes.filter(s => s.rounded).length, 4);
  assert.ok(diagram.strokes.filter(s => s.rounded).every(s => diagramStrokePath(s).includes("Q")));
  for (const source of ["╔════╗\n║中文║\n╚════╝", "┏━━━━┓\n┃中文┃\n┗━━━━┛", "┌╌╌╌╌┐\n╎中文╎\n└╌╌╌╌┘", "┌────┐\n│中文│\n└────┘\n  /  \\\n v    v"])
    assert.equal(parseAsciiDiagram(source), undefined);
});

test("bounded input rejects oversized/control/bidi text without throwing", () => {
  for (const source of [mergeDiagram + "\u0000", mergeDiagram + "\u202e", "x".repeat(24_001), mergeDiagram + "\n" + "x".repeat(241), Array(121).fill("├── x").join("\n")]) {
    assert.equal(parseAsciiDiagram(source), undefined);
  }
});

test("paragraph extraction keeps surrounding prose and original whitespace intact", () => {
  const source = `说明：\n${mergeDiagram}\n这里是结语。\n`;
  const blocks = asciiDiagramBlocks(source);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].text, mergeDiagram + "\n");
  assert.equal(source.slice(0, blocks[0].start), "说明：\n");
  assert.equal(source.slice(blocks[0].end), "这里是结语。\n");
  const html = render(source);
  assert.match(html, /字符图美化视图/);
  assert.match(html, /<p><span>说明：<\/span><\/p>/);
  assert.match(html, /<p><span>这里是结语。<\/span><\/p>/);
});

test("plain and unlabeled/text code diagrams render locally with source toggle", () => {
  for (const source of [mergeDiagram, `\`\`\`\n${mergeDiagram}\n\`\`\``, `\`\`\`text\n${mergeDiagram}\n\`\`\``]) {
    const html = render(source);
    assert.match(html, /<svg[^>]*aria-label="字符图美化视图"/);
    assert.match(html, />原文<\/button>/);
    assert.match(html, /aria-label="复制代码"/);
    assert.ok(!html.includes("<foreignObject"));
  }
});

test("compact SVG layout keeps natural glyph proportions instead of fitting text to cells", () => {
  const html = render(`\`\`\`text\n${mergeDiagram}\n\`\`\``);
  assert.match(html, /height="112"/);
  assert.match(html, /dominant-baseline="central"/);
  assert.match(html, /font-size="14"/);
  assert.ok(!html.includes("textLength=") && !html.includes("lengthAdjust="));
});

test("explicit programming languages, inline code, streaming and compact never auto-render", () => {
  const code = `\`\`\`typescript\n${mergeDiagram}\n\`\`\``;
  for (const html of [render(code), render(`\`${mergeDiagram.replaceAll("\n", " ")}\``), render(mergeDiagram, { streaming: true }), render(`\`\`\`text\n${mergeDiagram}\n\`\`\``, { streaming: true }), render(mergeDiagram, { compact: true })]) {
    assert.ok(!html.includes("ascii-diagram-svg"), html);
  }
  assert.match(render(mergeDiagram, { streaming: false }), /ascii-diagram-svg/);
});

test("complex inline Markdown is not split or reinterpreted as diagram text", () => {
  const box = "┌──────┐\n│ C++  │\n└──────┘";
  const inline = render(`\`${box}\``);
  assert.ok(!inline.includes("ascii-diagram-svg"));
  assert.match(inline, /<code>/);
  const reference = `Read [guide][g]\n${box}\nDone\n\n[g]: https://example.com`;
  for (const streaming of [true, false]) {
    const html = render(reference, { streaming });
    assert.match(html, /href="https:\/\/example.com"/);
    assert.ok(!html.includes("ascii-diagram-svg"));
    const bold = render(`**Start\n${box}\nEnd**`, { streaming });
    assert.match(bold, /<strong>/);
    assert.ok(!bold.includes("ascii-diagram-svg"));
  }
});

test("SVG labels remain inert React text even with HTML and script strings", () => {
  const source = `+${"-".repeat(40)}+\n|${"<script>alert(1)</script> & safe".padEnd(40)}|\n+${"-".repeat(40)}+`;
  const html = render(`\`\`\`text\n${source}\n\`\`\``);
  assert.match(html, /ascii-diagram-svg/);
  assert.ok(!/<script|<foreignObject|<iframe|onerror=/.test(html));
  assert.match(html.replace(/<[^>]*>/g, ""), /&lt;script&gt;/);
});
