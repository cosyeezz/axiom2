import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "./temporary.js";
import { join } from "node:path";
import { test } from "node:test";
import { memorySummaryIndex, digest, MemoryLinkCache, MemoryReadEvidence, MemoryTextCache, replaceMemoryFile, textFile } from "../src/server/memory-files.js";

test("memory files retain a UTF-8 BOM while revisions are derived from the raw bytes", () => {
  const directory = mkdtempSync(join(tmpdir(), "axiom-memory-files-"));
  const path = join(directory, "memory.md");
  const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("第一行\r\nemoji 😀\r\n", "utf8")]);
  try {
    writeFileSync(path, bytes);
    const revision = digest(bytes), content = textFile(path);
    assert.equal(content, "第一行\r\nemoji 😀\r\n");
    replaceMemoryFile(path, revision, content);
    assert.deepEqual(readFileSync(path), bytes, "a no-op editor save must not remove BOM or alter CRLF bytes");

    writeFileSync(path, Buffer.concat([bytes, Buffer.from("changed", "utf8")]));
    assert.throws(() => replaceMemoryFile(path, revision, content), { code: "REVISION_CONFLICT" });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("request text cache reuses one revision while probing each page and discards changed text", () => {
  let revision = "one", loads = 0;
  const cache = new MemoryTextCache(1024);
  const load = () => { loads++; return { revision, content: revision === "one" ? "第一段😀第二段" : "新版本", size: 0, updatedAt: 1 }; };
  assert.equal(cache.read("entry", 0, 3, () => revision, load).content, "第一段");
  assert.equal(cache.read("entry", 3, 4, () => revision, load).content, "😀第二");
  assert.equal(loads, 1, "later pages of one revision must reuse decoded text");
  revision = "two";
  assert.equal(cache.read("entry", 0, 4, () => revision, load).content, "新版本");
  assert.equal(loads, 2, "revision probes must invalidate stale text before it is served");
  assert.throws(() => cache.read("entry", 0, 4, () => { throw Error("file removed or no longer authorized"); }, load), /removed/, "a cached document must not bypass current path and permission checks");
});

test("explicit link cache only reuses links for the exact source revision", () => {
  const cache = new MemoryLinkCache(); let parses = 0;
  const parse = () => { parses++; return ["C:/project/evidence.md"]; };
  assert.deepEqual(cache.links("session", "source-a", parse), ["C:/project/evidence.md"]);
  assert.deepEqual(cache.links("session", "source-a", parse), ["C:/project/evidence.md"]);
  assert.equal(parses, 1);
  assert.deepEqual(cache.links("session", "source-b", () => { parses++; return ["C:/project/replaced.md"]; }), ["C:/project/replaced.md"]);
  assert.equal(parses, 2, "source replacement invalidates the parsed-link set");
});

test("page evidence only completes after a contiguous same-revision read from offset zero", () => {
  const evidence = new MemoryReadEvidence();
  assert.equal(evidence.record("doc", { revision: "a", offset: 3, content: "def", nextOffset: null }), false, "a tail page is not evidence");
  assert.equal(evidence.record("doc", { revision: "a", offset: 0, content: "abc", nextOffset: 3 }), false);
  assert.equal(evidence.record("doc", { revision: "a", offset: 3, content: "def", nextOffset: null }), true);
  assert.deepEqual(evidence.get("doc", "a"), { revision: "a", nextOffset: null, content: "abcdef", complete: true });

  assert.equal(evidence.record("doc", { revision: "b", offset: 3, content: "DEF", nextOffset: null }), false, "a revision change discards old coverage");
  assert.equal(evidence.get("doc", "a"), undefined);
  assert.equal(evidence.record("doc", { revision: "b", offset: 0, content: "ABC", nextOffset: 3 }), false);
  assert.equal(evidence.record("doc", { revision: "b", offset: 3, content: "DEF", nextOffset: null }), true);
});

test("summary index preserves every complete short summary and exact source association", () => {
  const candidates = Array.from({ length: 100 }, (_, index) => ({
    sessionId: `session-${index}`, revision: `revision-${index}`,
    summary: `${'含有不确定性的摘要 "😀" '.repeat(10)}${index}`,
  }));
  const prompt = memorySummaryIndex(candidates, 103);
  assert.ok(prompt.length > 16000, "large complete indexes must not be truncated to the old projection budget");
  const value = JSON.parse(prompt);
  assert.equal(value.totalSources, 103); assert.equal(value.summaryCount, 100); assert.equal(value.pendingSources, 3);
  assert.deepEqual(value.sources, candidates.map((source) => ({ ...source, path: "MEMORY.md" })));
  assert.match(value.coverage, /尚未整理或失效的来源未包含在摘要中/);
});

test("summary index counts Unicode code points including whitespace and punctuation", () => {
  const source = { sessionId: "session", revision: "revision", summary: "😀".repeat(200) };
  assert.equal(JSON.parse(memorySummaryIndex([source], 1)).sources[0].summary, source.summary);
  for (const summary of ["", "  ", "字".repeat(201), `${"😀".repeat(200)}。`, `${"字".repeat(200)} `]) {
    assert.throws(() => memorySummaryIndex([{ ...source, summary }], 1), { code: "MEMORY_LIMIT" });
  }
});
