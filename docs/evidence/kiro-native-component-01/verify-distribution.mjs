// Offline verifier: no install, server, OAuth, model call or lifecycle script.
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire, isBuiltin } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const require = createRequire(join(root, "app/package.json"));
const ts = require("typescript");
// npm 10.9.8 ran prepare despite --ignore-scripts; preserve the complete stdout.
const packRaw = readFileSync(new URL(process.argv[2] ?? "pack-dry-run-02.stdout", import.meta.url), "utf8");
const jsonStart = packRaw.search(/^\[\r?$/m);
assert.ok(jsonStart >= 0, "Missing npm pack JSON section");
const pack = JSON.parse(packRaw.slice(jsonStart));
assert.equal(pack.length, 1);
const packed = new Set(pack[0].files.map(file => file.path));
const component = "app/dist/native-providers/";
const walk = path => readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
  ? walk(join(path, entry.name)) : [join(path, entry.name)]);
const files = walk(join(root, component)).filter(path => path.endsWith(".js"));
const sources = walk(join(root, "app/src/native-providers")).filter(path => path.endsWith(".ts"));
assert.equal(files.length, sources.length, "Every component source must be emitted");
assert.ok(packed.has(component + "index.js"), "Public component entry is not packaged");
for (const source of sources) assert.ok(packed.has(relative(root, source).replace("app/src/", "app/dist/").replace(/\.ts$/, ".js")));
let relativeEdges = 0;
const bare = new Set();
for (const file of files) {
  assert.ok(packed.has(relative(root, file)), `Not packaged: ${relative(root, file)}`);
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const specifiers = [];
  const visit = node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) specifiers.push(node.moduleSpecifier);
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      ts.isIdentifier(node.expression) && node.expression.text === "require")) {
      assert.equal(node.arguments.length, 1); specifiers.push(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  for (const specifier of specifiers) {
    assert.ok(ts.isStringLiteral(specifier), "Non-literal dependency is not audited");
    const name = specifier.text;
    if (name.startsWith(".")) {
      const target = resolve(dirname(file), name), targetPath = relative(root, target);
      assert.ok(targetPath.startsWith(component), `Host dependency: ${targetPath}`);
      assert.ok(existsSync(target) && packed.has(targetPath), `Missing dependency: ${targetPath}`);
      relativeEdges++;
    } else {
      assert.ok(isBuiltin(name) || name === "https-proxy-agent", `Unexpected dependency: ${name}`);
      if (!isBuiltin(name)) bare.add(name);
    }
  }
}
const shims = ["native-protocol", "native-http", "native", "responses", "eventstream", "tool-input", "thinking-stream", "failure", "profile"];
for (const name of shims) assert.ok(packed.has(`app/dist/server/providers/kiro-${name}.js`));
assert.ok(packed.has("app/dist/shared/kiro-failure.js"));
const dependencies = ["https-proxy-agent", "proxy-agent-negotiate", "agent-base", "debug", "ms"];
const temp = mkdtempSync(join(tmpdir(), "axiom-component-dist-"));
let smoke;
try {
  writeFileSync(join(temp, "package.json"), JSON.stringify({ type: "module" }));
  cpSync(join(root, component), join(temp, "dist/native-providers"), { recursive: true });
  mkdirSync(join(temp, "dist/server/providers"), { recursive: true });
  mkdirSync(join(temp, "dist/shared"), { recursive: true });
  for (const name of shims) cpSync(join(root, `app/dist/server/providers/kiro-${name}.js`), join(temp, `dist/server/providers/kiro-${name}.js`));
  cpSync(join(root, "app/dist/shared/kiro-failure.js"), join(temp, "dist/shared/kiro-failure.js"));
  for (const name of dependencies) {
    let directory = dirname(require.resolve(name));
    while (!existsSync(join(directory, "package.json")) || JSON.parse(readFileSync(join(directory, "package.json"), "utf8")).name !== name) {
      const parent = dirname(directory); assert.notEqual(parent, directory); directory = parent;
    }
    cpSync(directory, join(temp, "node_modules", name), { recursive: true, dereference: true });
  }
  const script = `
    import assert from 'node:assert/strict';
    import { syncBuiltinESMExports } from 'node:module';
    import http from 'node:http'; import https from 'node:https';
    import { Socket } from 'node:net'; import cp from 'node:child_process';
    let blocked = 0;
    const forbid = () => { blocked++; throw Error('I/O forbidden in component import smoke'); };
    globalThis.fetch = forbid; Socket.prototype.connect = forbid;
    http.request = http.get = https.request = https.get = forbid;
    cp.spawn = cp.exec = cp.execFile = cp.fork = cp.spawnSync = cp.execSync = cp.execFileSync = forbid;
    syncBuiltinESMExports();
    const core = await import('./dist/native-providers/index.js');
    assert.equal(typeof core.createNativeAccount, 'function');
    const provider = core.createKiroNativeProvider(); assert.equal(provider.id, 'kiro'); provider.dispose(); provider.dispose();
    assert.throws(() => provider.catalog({}, new AbortController().signal), { name: 'AbortError' });
    assert.throws(() => provider.auth.refresh({}, new AbortController().signal), { name: 'AbortError' });
    const native = await import('./dist/server/providers/kiro-native.js');
    assert.equal(native.kiroNativeFetch, core.kiroNativeFetch);
    assert.equal(native.KiroChatError, core.KiroChatError);
    const responses = await import('./dist/native-providers/kiro/responses.js');
    assert.equal((await import('./dist/server/providers/kiro-responses.js')).KiroResponsesError, responses.KiroResponsesError);
    for (const name of ${JSON.stringify(shims)}) await import('./dist/server/providers/kiro-' + name + '.js');
    await import('./dist/shared/kiro-failure.js');
    assert.equal(blocked, 0);
    console.log(JSON.stringify({ plainNode: true, isolatedCopiedDependencies: true, piInstalled: false, shimIdentity: true, disposedGuards: true, blockedIoAttempts: blocked }));
  `;
  smoke = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: temp, timeout: 15_000, encoding: "utf8", env: { HOME: join(temp, "home"), TMPDIR: temp, NODE_ENV: "test", PI_OFFLINE: "1" },
  }));
} finally { rmSync(temp, { recursive: true, force: true }); }
console.log(JSON.stringify({ componentFiles: files.length, relativeEdges, externalDependencies: [...bare], copiedDependencies: dependencies,
  packaged: true, hostDependencies: 0, smoke, packPrepareObserved: true, fullInstallLifecycleTest: "not run", files: files.map(path => relative(root, path)) }, null, 2));
