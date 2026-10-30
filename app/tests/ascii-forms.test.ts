import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseAsciiForm } from "../src/shared/ascii-form.js";
import { cachedAsciiForm } from "../src/client/chat/ascii-diagram-cache.js";
import { DerivedCache } from "../src/client/chat/derived-cache.js";
import { Markdown } from "./markdown-fixture.js";
import { wideForm, mediumForm, narrowForm } from "./fixtures/ascii-forms.js";

const render = (source: string, language = "text", extra = {}) => renderToStaticMarkup(createElement(Markdown, { text: `\`\`\`${language}\n${source}\n\`\`\``, ...extra }));

test("wide, medium and narrow empty form wireframes render as static fields", () => {
  for (const source of [wideForm, mediumForm, narrowForm]) {
    const form = parseAsciiForm(source);
    assert.ok(form);
    assert.equal(form.fields?.length, 5);
    assert.deepEqual(form.strokes, []);
    assert.ok(form.labels.some(label => label.text === "日期范围"));
    assert.ok(form.labels.some(label => label.text === "供应商"));
    assert.ok(form.labels.some(label => label.text === "重置"));
    assert.ok(form.labels.every(label => !/[\[\]─]/u.test(label.text)));
    const html = render(source);
    assert.match(html, /字符图/);
    assert.equal((html.match(/<rect /g) ?? []).length, 5);
    assert.doesNotMatch(html, /<(?:input|foreignObject|script)\b/);
    assert.deepEqual(parseAsciiForm(source.replaceAll("\n", "\r\n")), form);
  }
  assert.equal(parseAsciiForm(mediumForm.replaceAll('─', '-'))?.fields?.length, 5);
  assert.deepEqual(parseAsciiForm(wideForm)?.fields?.map(f => f.x), [0, 14, 28, 42, 56]);
  assert.deepEqual(parseAsciiForm(mediumForm)?.fields?.map(f => [f.x, f.y]), [[0,1], [0,4], [26,4], [0,7], [26,7]]);
});

test("ordinary brackets, arrays, checklists, mixed diagrams and incomplete forms stay literal", () => {
  const base = "Name\n[     ]\n\nSpace\n[     ]\n\nModel\n[     ]";
  assert.ok(parseAsciiForm(base));
  for (const source of [
    "Name\n[     ]\nSpace\n[     ]", // at least three
    base.replaceAll("[     ]", "[]"), base.replaceAll("[     ]", "[ ]"),
    base.replaceAll("[     ]", "[1, 2]"), base.replaceAll("[     ]", "[x]"),
    base.replaceAll("[     ]", "[___]"), base.replaceAll("[     ]", "[ ── ]"),
    base.replaceAll("[     ]", "[──--]"),
    base.replaceAll("[     ]", "[　　　]"), base.replaceAll("[     ]", "[\u00a0\u00a0\u00a0]"),
    base.replaceAll("[     ]", "- [     ]"), base.replace("Name", "const name ="),
    base.replace("Name", "- Name"), base.replace("Name", "name()"),
    base.replace("Name", "name =>"), base.replace("Name", "<script>"),
    base.replace("Name", "שם"), base.replace("Name", "اسم"), base + "\nשם",
    base.replace("[     ]", "[     ] // comment"), base.replace("[     ]", "[     "),
    base.replace("Space", "     Space"), base.replace("Space", ""),
    base + "\nFourth\n[unfinished", base + "\n   ↓ next", base + "\n┌──┐",
    base + "\nconst values = []", base + "\n\u202e", base + "\n\t", base + "\n\x00",
  ]) {
    assert.equal(parseAsciiForm(source), undefined, source);
    assert.doesNotMatch(render(source), /ascii-diagram-fields/);
  }
});

test("form conversion respects language, paragraph, streaming and compact gates", () => {
  for (const language of ["", "text", "txt", "plain", "plaintext", "ascii"]) assert.match(render(wideForm, language), /ascii-diagram-fields/);
  for (const language of ["typescript", "sql", "python", "json"]) assert.doesNotMatch(render(wideForm, language), /ascii-diagram-fields/);
  assert.doesNotMatch(render(wideForm, "text", { streaming: true }), /ascii-diagram-fields/);
  assert.doesNotMatch(render(wideForm, "text", { compact: true }), /ascii-diagram-fields/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(Markdown, { text: wideForm })), /ascii-diagram-fields/);
});

test("display-column labels, source preservation, budgets and cached failures", () => {
  const source = "中文é  Name\n[    ]  [    ]\n\nModel\n[    ]";
  assert.deepEqual(parseAsciiForm(source)?.fields?.map(f => f.x), [0,8,0]);
  for (const suffix of ["\n".repeat(120), "\nx".repeat(120), "\n" + "x".repeat(241), "\n" + "x".repeat(24001), "\n" + ("x".repeat(239) + "\n").repeat(70)]) assert.equal(parseAsciiForm(wideForm + suffix), undefined);
  const cache = new DerivedCache();
  assert.equal(cachedAsciiForm(cache, wideForm), cachedAsciiForm(cache, wideForm));
  assert.equal(cachedAsciiForm(cache, "plain text"), undefined);
  assert.equal(cachedAsciiForm(cache, "plain text"), undefined);
  assert.deepEqual(cachedAsciiForm(null, wideForm), parseAsciiForm(wideForm));
  assert.match(render(wideForm), /原文/);
});
