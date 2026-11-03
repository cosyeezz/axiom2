// Offline emit/packlist/isolated-runtime closure check. No npm lifecycle, install or live request.
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire, isBuiltin } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const require = createRequire(join(root, "app/package.json")), ts = require("typescript");
const npmRequire = createRequire(realpathSync(process.argv[2]));
const Arborist = npmRequire("@npmcli/arborist"), packlist = npmRequire("npm-packlist");
const tree = await new Arborist({ path: root }).loadActual();
const paths = (await packlist(tree)).sort(), packed = new Set(paths);
writeFileSync(new URL("distribution-packlist.json", import.meta.url), JSON.stringify({ method: "npm-packlist with Arborist.loadActual; no lifecycle or tarball", paths }, null, 2) + "\n", { flag: "wx" });
const component = "app/dist/native-providers/";
const walk = path => readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(join(path, entry.name)) : [join(path, entry.name)]);
const files = walk(join(root, component)).filter(path => path.endsWith(".js")).sort();
const sources = walk(join(root, "app/src/native-providers")).filter(path => path.endsWith(".ts")).sort();
assert.deepEqual(files.map(path => relative(root, path)), sources.map(path => relative(root, path).replace("app/src/", "app/dist/").replace(/\.ts$/, ".js")));
const hash = path => createHash("sha256").update(readFileSync(path)).digest("hex");
let relativeEdges = 0;
const bare = new Set();
for (const file of files) {
  assert.ok(packed.has(relative(root, file)), `Not packaged: ${relative(root, file)}`);
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), specifiers = [];
  const visit = node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) specifiers.push(node.moduleSpecifier);
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === "require")) {
      assert.equal(node.arguments.length, 1); specifiers.push(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  }; visit(source);
  for (const specifier of specifiers) {
    assert.ok(ts.isStringLiteral(specifier), "Non-literal dependency"); const name = specifier.text;
    if (name.startsWith(".")) {
      const target = resolve(dirname(file), name), targetPath = relative(root, target);
      assert.ok(targetPath.startsWith(component) && existsSync(target) && packed.has(targetPath), `Missing/host dependency: ${targetPath}`); relativeEdges++;
    } else { assert.ok(isBuiltin(name) || name === "https-proxy-agent", `Unexpected dependency: ${name}`); if (!isBuiltin(name)) bare.add(name); }
  }
}
const dependencies = ["https-proxy-agent", "proxy-agent-negotiate", "agent-base", "debug", "ms"];
assert.equal(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).dependencies["https-proxy-agent"], "9.1.0");
const temp = mkdtempSync(join(tmpdir(), "codebuddy-dist-")); let smoke, fixture;
try {
  writeFileSync(join(temp, "package.json"), JSON.stringify({ type: "module" }));
  cpSync(join(root, component), join(temp, "component"), { recursive: true });
  for (const name of dependencies) {
    let directory = dirname(require.resolve(name));
    while (!existsSync(join(directory, "package.json")) || JSON.parse(readFileSync(join(directory, "package.json"), "utf8")).name !== name) {
      const parent = dirname(directory); assert.notEqual(parent, directory); directory = parent;
    }
    cpSync(directory, join(temp, "node_modules", name), { recursive: true, dereference: true });
  }
  mkdirSync(join(temp, "home"));
  const env = { HOME: join(temp, "home"), TMPDIR: temp, NODE_ENV: "test", PI_OFFLINE: "1", no_proxy: "*" };
  smoke = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", `
    import assert from 'node:assert/strict'; import { syncBuiltinESMExports } from 'node:module';
    import http from 'node:http'; import https from 'node:https'; import { Socket } from 'node:net'; import cp from 'node:child_process';
    let blocked = 0; const forbid = () => { blocked++; throw Error('Import IO forbidden'); };
    globalThis.fetch = forbid; Socket.prototype.connect = forbid; http.request = http.get = https.request = https.get = forbid;
    cp.spawn = cp.exec = cp.execFile = cp.fork = cp.spawnSync = cp.execSync = cp.execFileSync = forbid; syncBuiltinESMExports();
    const core = await import('./component/index.js');
    for (const create of [core.createCodeBuddyNativeProvider, core.createKiroNativeProvider]) { const provider = create(); provider.dispose(); provider.dispose(); assert.throws(() => provider.auth.refresh({}, new AbortController().signal), { name: 'AbortError' }); }
    assert.equal(blocked, 0); console.log(JSON.stringify({ plainNode: true, piInstalled: false, blockedIoAttempts: blocked, disposedGuards: true }));
  `], { cwd: temp, timeout: 15000, encoding: "utf8", env }));
  fixture = JSON.parse(execFileSync(process.execPath, [join(root, "app/tests/fixtures/codebuddy-component.mjs"), join(temp, "component/index.js")], { cwd: temp, timeout: 15000, encoding: "utf8", env }));
  assert.deepEqual(fixture, { login: true, refresh: true, logout: true, disposal: true, authRequests: 3, catalogRequests: 1, modelRequests: 3, toolRuns: 1, network: 0, piLoaded: false });
} finally { rmSync(temp, { recursive: true, force: true }); }
console.log(JSON.stringify({ componentFiles: files.length, codeBuddyFiles: files.filter(path => path.includes("/codebuddy/")).length,
  relativeEdges, externalDependencies: [...bare], copiedDependencies: dependencies, packageCandidateFiles: paths.length,
  hostDependencies: 0, smoke, fixture, packLifecycle: "not run", tarball: "not created", installedLifecycle: "not tested",
  sources: sources.map(path => ({ path: relative(root, path), sha256: hash(path) })), emitted: files.map(path => ({ path: relative(root, path), sha256: hash(path) })) }, null, 2));
