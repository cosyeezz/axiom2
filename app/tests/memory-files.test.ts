import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { compactMemoryCandidates, digest, MemoryLinkCache, MemoryReadEvidence, MemoryTextCache, replaceMemoryFile, textFile } from "../src/server/memory-files.js";

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

test("candidate prompt projection preserves every selected source within a fixed serialized budget", () => {
  const candidates = Array.from({ length: 24 }, (_, index) => ({
    sessionId: `session-${index}`, title: `来源 ${index} 的标题`, revision: `revision-${index}`,
    summary: `${'含有不确定性的长摘要 "😀" '.repeat(300)}${index}`,
    keywords: Array.from({ length: 20 }, (_, keyword) => `关键词-${index}-${keyword}-${"x".repeat(100)}`),
  }));
  const prompt = compactMemoryCandidates(candidates, { totalSources: 500, unreadableCandidates: 2, maxChars: 16000 });
  assert.ok(prompt.length <= 16000, `serialized prompt was ${prompt.length} characters`);
  const value = JSON.parse(prompt);
  assert.equal(value.totalSources, 500); assert.equal(value.candidateCount, 24); assert.equal(value.unreadableCandidates, 2);
  assert.equal(value.candidates.length, 24, "compaction must not silently remove selected candidates");
  assert.deepEqual(value.candidates.map((candidate: any) => candidate.sessionId), candidates.map((candidate) => candidate.sessionId));
  assert.match(value.coverage, /不完整|过时/);
});

test("candidate projection never abbreviates read identities or revisions", () => {
  const sessionId = `session-${"s".repeat(600)}`, revision = `revision-${"r".repeat(600)}`;
  const prompt = compactMemoryCandidates([{ sessionId, revision, title: "t".repeat(3000), summary: "summary", keywords: ["keyword".repeat(500)] }], { maxChars: 1600 });
  const candidate = JSON.parse(prompt).candidates[0];
  assert.equal(candidate.sessionId, sessionId); assert.equal(candidate.revision, revision);
  assert.ok(prompt.length <= 1600); assert.ok(candidate.title.length < 3000, "only descriptive fields may be compressed");
});

test("candidate projection rejects an identity-only payload beyond the fixed budget", () => {
  const candidates = Array.from({ length: 24 }, (_, index) => ({
    sessionId: `${index}-${"s".repeat(1000)}`, revision: `${index}-${"r".repeat(1000)}`,
    title: "", summary: "", keywords: [],
  }));
  assert.throws(() => compactMemoryCandidates(candidates, { maxChars: 16000 }), { code: "MEMORY_LIMIT" });
});
