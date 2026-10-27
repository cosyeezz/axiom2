import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DerivedCache } from "../src/client/chat/derived-cache.js";
import { cachedAsciiDiagram, cachedAsciiDiagramBlocks } from "../src/client/chat/ascii-diagram-cache.js";
import { parseAsciiDiagram } from "../src/shared/ascii-diagram.js";
import { Markdown, DerivedContext } from "./markdown-fixture.js";

const source = "┌─────┐\n│hello│\n└─────┘";
class CountingCache extends DerivedCache {
  builds: string[] = [];
  override get<T>(key: string, create: () => T): T {
    return super.get(key, () => { this.builds.push(key); return create(); });
  }
}
const render = (cache: DerivedCache, text: string, streaming = false) => renderToStaticMarkup(createElement(
  DerivedContext.Provider, { value: cache }, createElement(Markdown, { text, streaming }),
));

test("diagram recognition reuses positive and negative results across recycled rows", () => {
  const cache = new CountingCache();
  const diagram = cachedAsciiDiagram(cache, source);
  assert.deepEqual(diagram, parseAsciiDiagram(source));
  assert.equal(cachedAsciiDiagram(cache, source), diagram);
  const log = Array(100).fill("Worker + queue status | request accepted; waiting for resource availability.").join("\n");
  assert.equal(cachedAsciiDiagram(cache, log), undefined);
  assert.equal(cachedAsciiDiagram(cache, log), undefined);
  assert.equal(cache.builds.length, 2, "ordinary logs must not repeat failed recognition");
});

test("paragraph ranges and their geometry are cached without rewriting source whitespace", () => {
  const cache = new CountingCache(), text = `说明：\n${source}\n结语。\n`;
  const blocks = cachedAsciiDiagramBlocks(cache, text);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].text, source + "\n");
  assert.equal(text.slice(blocks[0].start, blocks[0].end), blocks[0].text);
  assert.equal(cachedAsciiDiagramBlocks(cache, text), blocks);
  assert.deepEqual(cachedAsciiDiagramBlocks(cache, "a + b\nc | d"), []);
  assert.deepEqual(cachedAsciiDiagramBlocks(cache, "a + b\nc | d"), []);
  assert.equal(cache.builds.length, 2);
});

test("paragraph rendering passes its parsed geometry directly to CodeBlock", () => {
  const cache = new CountingCache();
  const first = render(cache, source), second = render(cache, source);
  assert.equal(first, second);
  assert.match(first, /ascii-diagram-svg/);
  assert.equal(cache.builds.filter(key => key.startsWith("ascii-blocks:")).length, 1);
  assert.equal(cache.builds.filter(key => key.startsWith("ascii-diagram:")).length, 0, "no second parse inside CodeBlock");
});

test("fenced and failed diagram recognition survive remounts but streaming stays literal", () => {
  const cache = new CountingCache(), fenced = `\`\`\`text\n${source}\n\`\`\``;
  assert.match(render(cache, fenced), /ascii-diagram-svg/);
  assert.match(render(cache, fenced), /ascii-diagram-svg/);
  assert.equal(cache.builds.filter(key => key.startsWith("ascii-diagram:")).length, 1);
  assert.doesNotMatch(render(cache, fenced, true), /ascii-diagram-svg/);
  assert.match(render(cache, fenced), /ascii-diagram-svg/);
  const log = "```text\nworker + queue | ready\nworker + queue | waiting\n```";
  assert.doesNotMatch(render(cache, log), /ascii-diagram-svg/);
  assert.doesNotMatch(render(cache, log), /ascii-diagram-svg/);
  assert.equal(cache.builds.filter(key => key.startsWith("ascii-diagram:")).length, 2);
});

test("changed sources, separate sessions, eviction and cache-free rendering stay independent", () => {
  const cache = new CountingCache(4096, 2), other = new CountingCache();
  const first = cachedAsciiDiagram(cache, source);
  const changed = cachedAsciiDiagram(cache, source.replace("hello", "world"));
  assert.notDeepEqual(changed, first);
  assert.notEqual(cachedAsciiDiagram(other, source), first);
  cachedAsciiDiagram(cache, "a + b\nc | d");
  cachedAsciiDiagramBlocks(cache, "x".repeat(24001));
  assert.ok(cache.bytes <= cache.maxBytes);
  const builds = cache.builds.length;
  assert.deepEqual(cachedAsciiDiagram(cache, source), first);
  assert.equal(cache.builds.length, builds + 1, "evicted pure products can be reconstructed");
  assert.deepEqual(cachedAsciiDiagram(null, source), first);
  assert.deepEqual(cachedAsciiDiagramBlocks(null, source), cachedAsciiDiagramBlocks(other, source));
});
