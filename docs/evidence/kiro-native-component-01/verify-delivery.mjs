// Final offline documentation/evidence check. Does not import a provider or run live harnesses.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const evidence = fileURLToPath(new URL("./", import.meta.url));
const read = path => readFileSync(path, "utf8");
const walk = path => readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(join(path, entry.name)) : [join(path, entry.name)]);
const tests = [
  ["core-test.log", 13], ["pi-tests-01.log", 365], ["pi-tests-02.log", 95], ["pi-workers-01.log", 14],
].map(([file, expected]) => {
  const log = read(join(evidence, file));
  const number = name => Number([...log.matchAll(new RegExp(`^# ${name} (\\d+)$`, "gm"))].at(-1)?.[1]);
  assert.equal(number("tests"), expected); assert.equal(number("pass"), expected);
  for (const name of ["fail", "cancelled", "skipped", "todo"]) assert.equal(number(name), 0);
  return { log: file, passed: expected, observedExitCode: 0 };
});
assert.equal(read(join(evidence, "pi-tsc-02.log")), "");
const distribution = JSON.parse(read(join(evidence, "distribution-verification-03.json")));
assert.equal(distribution.componentFiles, 21); assert.equal(distribution.hostDependencies, 0);
assert.equal(distribution.smoke.blockedIoAttempts, 0); assert.equal(distribution.smoke.piInstalled, false);
assert.equal(read(join(evidence, "distribution-stderr-03.log")), "");
const documents = ["docs/native-provider-component.md", "docs/evidence/kiro-native-component-01/CONTRACT.md", "docs/evidence/kiro-native-component-01/REPORT.md"];
let links = 0;
for (const file of documents) {
  for (const match of read(join(root, file)).matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].split("#")[0];
    if (!target || /^[a-z]+:/i.test(target)) continue;
    const path = resolve(dirname(join(root, file)), decodeURIComponent(target));
    assert.ok(existsSync(path) || path === join(evidence, "verification.json"), `Broken link: ${file} -> ${target}`);
    links++;
  }
}
const examples = [...read(join(root, documents[0])).matchAll(/```js\n([\s\S]*?)\n```/g)];
assert.equal(examples.length, 1);
for (const example of examples) execFileSync(process.execPath, ["--input-type=module", "--check"], { input: example[1], timeout: 10_000 });
const providers = ["auth", "callback", "catalog", "chat", "chat-protocol", "thinking", "usage", "native-protocol", "native-http", "native", "responses", "eventstream", "tool-input", "thinking-stream", "failure", "profile"];
const sourcePaths = [
  ...walk(join(root, "app/src/native-providers")).filter(path => path.endsWith(".ts")),
  ...providers.map(name => join(root, `app/src/server/providers/kiro-${name}.ts`)),
  ...["app/src/shared/kiro-failure.ts", "app/tsconfig.server.json", "package.json", "scripts/check-package.mjs",
    "app/tests/native-provider-account.test.ts", "app/tests/native-provider-stream.test.ts",
    "app/tests/fixtures/native-provider-account.mjs", "app/tests/fixtures/native-provider-stream.mjs", "app/tests/fixtures/native-provider-bundle.ts",
    "app/src/server/model-runtime.ts", "app/src/server/provider-request-observer.ts", "app/src/server/providers/kiro.ts"].map(path => join(root, path)),
];
const artifacts = [...documents.map(path => join(root, path)), ...walk(evidence).filter(path => path !== join(evidence, "verification.json"))];
const fingerprint = path => { const bytes = readFileSync(path); return { path: relative(root, path), bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }; };
const diffPaths = [...sourcePaths.map(path => relative(root, path)), ...documents];
execFileSync("git", ["diff", "--check", "--", ...diffPaths], { cwd: root, timeout: 10_000 });
console.log(JSON.stringify({ scope: "offline synthetic/loopback; no deploy or real provider call", node: process.version,
  pi: JSON.parse(read(join(root, "app/node_modules/@earendil-works/pi-ai/package.json"))).version,
  tests, distinctTests: 379, testFiles: 32, repeatedAffectedTests: 95, finalWholeSuiteRerun: false,
  typecheck: { log: "pi-tsc-02.log", observedExitCode: 0 },
  finalBuildAndPack: { stdout: "pack-dry-run-02.stdout", stderr: "pack-stderr-02.log", observedExitCode: 0, prepareRanDespiteIgnoreScripts: true },
  distribution: { result: "distribution-verification-03.json", observedExitCode: 0, modules: distribution.componentFiles, relativeEdges: distribution.relativeEdges },
  documentation: { files: documents, checkedLocalLinks: links, syntaxCheckedExamples: examples.length },
  scopedDiffCheck: "passed", fullInstallLifecycleTest: "not run", deployed: false, liveCalls: 0,
  sourceFingerprints: sourcePaths.map(fingerprint), artifactFingerprints: artifacts.map(fingerprint),
}, null, 2));
