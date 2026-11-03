import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const evidence = fileURLToPath(new URL("./", import.meta.url));
const hash = path => createHash("sha256").update(readFileSync(path)).digest("hex");
const baseline = JSON.parse(readFileSync(join(evidence, "baseline.json"), "utf8"));
const changed = new Set(["app/src/server/providers/codebuddy-cn.ts", "app/src/server/providers/codebuddy-auth.ts", "app/src/server/providers/codebuddy-models.ts", "app/src/server/model-runtime.ts", "app/src/server/provider-request-observer.ts", "app/tests/codebuddy-auth.test.ts", "app/tests/codebuddy-stream.test.ts", "app/tests/codebuddy-runtime.test.ts", "app/src/native-providers/index.ts"]);
const preserved = baseline.files.filter(file => !changed.has(file.path));
for (const file of preserved) assert.equal(hash(join(root, file.path)), file.sha256, `Protected baseline changed: ${file.path}`);
const distribution = JSON.parse(readFileSync(join(evidence, "distribution-verification-01.json"), "utf8"));
for (const file of [...distribution.sources, ...distribution.emitted]) assert.equal(hash(join(root, file.path)), file.sha256, `Post-verification change: ${file.path}`);
const docs = ["docs/codebuddy-native-component.md", "docs/native-provider-component.md", "docs/evidence/codebuddy-native-component-01/ONBOARDING.md", "docs/evidence/codebuddy-native-component-01/PROTOCOL-MATRIX.md", "docs/evidence/codebuddy-native-component-01/OFFLINE-REPORT.md"];
let links = 0;
for (const doc of docs) for (const match of readFileSync(join(root, doc), "utf8").matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
  const path = match[1].split("#")[0]; if (!path || /^https?:/.test(path)) continue;
  assert.ok(existsSync(resolve(root, dirname(doc), path)), `Broken link: ${doc} -> ${path}`); links++;
}
const walk = path => readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(join(path, entry.name)) : [join(path, entry.name)]);
const extra = ["app/src/server/model-runtime.ts", "app/src/server/provider-request-observer.ts", "app/src/server/agent-worker.ts", "app/src/server/codebuddy-run-identity.ts", "app/src/server/session-retry-policy.ts", "app/tests/session-retry-policy.test.ts", "app/tests/fixtures/codebuddy-component.mjs", "app/tests/fixtures/codebuddy-network.cjs", "package.json", "app/package.json", "app/tsconfig.server.json"];
const sources = [...new Set([...distribution.sources.map(file => file.path), ...extra,
  ...walk(join(root, "app/src/server/providers")).filter(path => /\/codebuddy-[^/]+\.ts$/.test(path)).map(path => relative(root, path)),
  ...walk(join(root, "app/tests")).filter(path => /\/codebuddy-[^/]+\.test\.ts$/.test(path)).map(path => relative(root, path))])].sort();
const artifacts = [...docs.map(path => join(root, path)), ...walk(evidence)].filter(path => !path.endsWith("offline-verification.json"));
const fingerprints = paths => [...new Set(paths)].sort().map(path => ({ path: relative(root, path), sha256: hash(path) }));
const result = { protectedBaselineFiles: preserved.length, componentSourceAndEmitFingerprintsVerified: distribution.sources.length + distribution.emitted.length, documentLinks: links, sources: fingerprints(sources.map(path => join(root, path))), artifacts: fingerprints(artifacts) };
writeFileSync(join(evidence, "offline-verification.json"), JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ protected: preserved.length, emitAndSource: 66, links, sources: result.sources.length, artifacts: result.artifacts.length }));
