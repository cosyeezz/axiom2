import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, stat, utimes, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { canonicalJson, digest, parseStrictJson } from "../src/server/code-index/domain/json.js";
import { FilePolicy, normalizeScope, scopeMatches, workspaceIdentity } from "../src/server/code-index/source/policy.js";
import { sourceRef, refOffsets, textPageEnd, mergeIntervals, validBoundary } from "../src/server/code-index/source/positions.js";
import { parseWorkspace } from "../src/server/code-index/parser/typescript.js";

async function fixture(t: test.TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), "axiom-index-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const put = async (name: string, text: string | Buffer) => { await mkdir(path.dirname(path.join(root, name)), { recursive: true }); await writeFile(path.join(root, name), text); };
  return { root, put, policy: await FilePolicy.create(root) };
}

test("JCS UTF-16 ordering, numeric encoding and duplicate/unpaired rejection", () => {
  assert.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.equal(canonicalJson({ "\uE000": 1, "😀": 2 }), '{"😀":2,"":1}');
  assert.equal(canonicalJson([-0, 1e-7, 1e21, 333333333.33333329]), '[0,1e-7,1e+21,333333333.3333333]');
  for (const value of [NaN, Infinity, "\uD800", [undefined]]) assert.throws(() => canonicalJson(value));
  for (const value of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '"\\udfff"']) assert.throws(() => parseStrictJson(value));
  assert.deepEqual(parseStrictJson('{"a":[true,null,"😀"]}'), { a: [true, null, "😀"] });
});

test("[F05][F11][W01] BOM/CRLF/emoji preserve byte identity and exact UTF-16 spans", async t => {
  const { put, policy } = await fixture(t);
  await put("a.ts", "\uFEFF甲😀\r\n乙\n");
  const file = await policy.read("a.ts");
  const ref = sourceRef("w1", file.path, file.contentHash, file.text, 2, 4);
  assert.deepEqual(ref.range, { start: { line: 0, character: 2 }, end: { line: 0, character: 4 }, encoding: "utf-16" });
  assert.equal(file.text.slice(...refOffsets(file.text, ref)), "😀");
  assert.throws(() => sourceRef("w1", file.path, file.contentHash, file.text, 3, 4));
  assert.equal(textPageEnd("😀", 0, 2, 6), 2);
  assert.equal(textPageEnd("😀", 0, 2, 5), 0);
  assert.equal(textPageEnd("\r\n", 0, 2, 6), 2);
  assert.equal(textPageEnd("\r\n", 0, 2, 5), 0);
  const text = `${"😀\"\\\t".repeat(20_000)}\r\n结束`, parts: string[] = [];
  let at = 0;
  while (at < text.length) { const end = textPageEnd(text, at, text.length, 4096); assert.ok(end > at); assert.ok(validBoundary(text, end)); const part = text.slice(at, end); assert.ok(Buffer.byteLength(JSON.stringify(part)) <= 4096); parts.push(part); at = end; }
  assert.equal(parts.join(""), text);
  assert.deepEqual(mergeIntervals([[0, 10], [20, 30]], [5, 25]), [[0, 30]]);
});

test("[F06][F07][F08] policy excludes secrets/links and content changes survive identical size/mtime", async t => {
  const { root, put, policy } = await fixture(t);
  await put("src/a.ts", "export const a = 1;");
  await put(".env", "SECRET_SENTINEL"); await put("node_modules/hidden.ts", "SECRET_SENTINEL");
  await put("bad.bin", Buffer.from([0xff, 0x00]));
  const first = await policy.read("src/a.ts"), before = await stat(path.join(root, "src/a.ts"));
  await put("src/a.ts", "export const a = 2;"); await utimes(path.join(root, "src/a.ts"), before.atime, before.mtime);
  assert.notEqual((await policy.read("src/a.ts")).contentHash, first.contentHash);
  for (const name of ["../outside", ".env", "node_modules/hidden.ts", "src/../.env", "C:/secret", "src/a.ts:secret"]) await assert.rejects(policy.read(name));
  await symlink(path.join(root, "src"), path.join(root, "linked"), "junction");
  await assert.rejects(policy.read("linked/a.ts"));
  const manifest = await policy.scan();
  assert.equal(manifest.files.size, 1); assert.equal(manifest.complete, false);
  assert.ok(manifest.gaps.some(g => g.code === "link_skipped"));
  assert.equal(JSON.stringify([...manifest.files]).includes("SECRET_SENTINEL"), false);
  const scope = normalizeScope({ include: ["src/**/*.ts"], exclude: [] });
  assert.ok(scopeMatches(scope, "src/a.ts")); assert.ok(scopeMatches(scope, "src/sub/a.ts"));
  const scopeHash = digest([...manifest.files].filter(([p]) => scopeMatches(scope, p)).map(([p, f]) => [p, f.contentHash]));
  await put("src/b.ts", "export const b = 1;");
  assert.notEqual(digest([...(await policy.scan()).files].filter(([p]) => scopeMatches(scope, p)).map(([p, f]) => [p, f.contentHash])), scopeHash);
  assert.equal((await workspaceIdentity(root)).indexKey, (await workspaceIdentity(path.join(root, "."))).indexKey);
});

test("[F02][F03][F04][F10][F12] policy snapshot parser respects extends, paths and stable declarations", async t => {
  const { root, put, policy } = await fixture(t);
  await put("config/base.json", JSON.stringify({ compilerOptions: { paths: { "@lib/*": ["../src/lib/*"] }, moduleResolution: "bundler", module: "esnext", allowJs: true, jsx: "preserve" } }));
  await put("tsconfig.json", JSON.stringify({ extends: "./config/base.json", include: ["src/**/*"] }));
  await put("src/lib/a.ts", "export function twice(n: number) { return n * 2; }\n");
  await put("src/main.ts", "import {twice} from '@lib/a';\nexport const answer = twice(21);\n");
  await put("src/view.tsx", "export const View = () => <div/>;\n");
  await put("src/plain.js", "export function plain() { return 1; }\n");
  await put("src/widget.jsx", "export const Widget = () => <span/>;\n");
  const parsed = parseWorkspace(root, "w", (await policy.scan()).files, policy.hash);
  t.after(() => parsed.dispose());
  const symbol = parsed.symbols.find(s => s.name === "twice"); assert.ok(symbol);
  assert.ok(parsed.references(symbol.id).some(ref => ref.path === "src/main.ts"));
  assert.ok(parsed.definitions(symbol.id).some(ref => ref.path === "src/lib/a.ts"));
  assert.deepEqual(new Set(parsed.symbols.map(s => path.extname(s.path))), new Set([".ts", ".tsx", ".js", ".jsx"]));
  await put("src/lib/a.ts", "\n\nexport function twice(n: number) { return n * 2; }\n");
  const moved = parseWorkspace(root, "w", (await policy.scan()).files, policy.hash); t.after(() => moved.dispose());
  assert.equal(moved.symbols.find(s => s.name === "twice")?.id, symbol.id);
  await put("config/base.json", JSON.stringify({ compilerOptions: { strict: true, allowJs: true, jsx: "preserve" } }));
  const changed = parseWorkspace(root, "w", (await policy.scan()).files, policy.hash); t.after(() => changed.dispose());
  assert.notEqual(changed.contextHash, parsed.contextHash);
});

test("parser resolves parent-directory includes, package imports, standard libs and overlapping projects", async t => {
  const { root, put, policy } = await fixture(t);
  const config = { compilerOptions: { module: "nodenext", moduleResolution: "nodenext", target: "es2022", strict: true }, include: ["../src/**/*.ts"] };
  await put("config/tsconfig.json", JSON.stringify(config));
  await put("config/tsconfig.build.json", JSON.stringify(config));
  await put("package.json", JSON.stringify({ type: "module", imports: { "#target": "./src/a.ts" } }));
  await put("src/a.ts", "export function call(n: number) { return n * 2; }\n");
  await put("src/b.ts", "export function call(n: number) { return n * 3; }\n");
  await put("src/main.ts", "import {call} from '#target';\nexport const result = call(1);\nexport interface Foo {member: string}\nconst rows: Foo[] = []; rows.map(row => row.member);\n");
  await put("src/overloads.ts", "export function act(x: number): number;\nexport function act(x: string): string;\nexport function act(x: number | string) { return x; }\nconst xs = [1]; xs.map(x => x + 1); xs.map(x => x + 2);\n");
  const parsed = parseWorkspace(root, "w", (await policy.scan()).files, policy.hash); t.after(() => parsed.dispose());
  const a = parsed.symbols.filter(symbol => symbol.path === "src/a.ts" && symbol.name === "call"); assert.equal(a.length, 1);
  assert.ok(parsed.references(a[0].id).some(ref => ref.path === "src/main.ts"));
  const member = parsed.symbols.find(symbol => symbol.name === "Foo.member"); assert.ok(member);
  assert.ok(parsed.references(member.id).length >= 2);
  const overloads = parsed.symbols.filter(symbol => symbol.name === "act"); assert.equal(overloads.length, 3); assert.equal(new Set(overloads.map(symbol => symbol.id)).size, 3);
  assert.equal(parsed.symbols.filter(symbol => symbol.name === "xs.map:callback" && symbol.body.ambiguity).length, 2);
  await put("package.json", JSON.stringify({ type: "module", imports: { "#target": "./src/b.ts" } }));
  const changed = parseWorkspace(root, "w", (await policy.scan()).files, policy.hash); t.after(() => changed.dispose());
  assert.notEqual(changed.contextHash, parsed.contextHash);
  assert.ok(!changed.references(a[0].id).some(ref => ref.path === "src/main.ts"));
  const b = changed.symbols.find(symbol => symbol.path === "src/b.ts" && symbol.name === "call")!;
  assert.ok(changed.references(b.id).some(ref => ref.path === "src/main.ts"));
});
