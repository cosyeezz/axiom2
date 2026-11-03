// Documentation/parser/discovery only. Never imports an extension or vendor harness.
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve, dirname, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { syncBuiltinESMExports } from "node:module";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import childProcess from "node:child_process";

const mode = process.argv[2] ?? "all";
assert.ok(["all", "links"].includes(mode), "mode must be all or links");
const deadline = setTimeout(() => { console.error("verification deadline exceeded"); process.exit(2); }, 55_000);
deadline.unref();
const repo = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const evidence = join(repo, "docs/evidence/cli-native-provider-skill-01");
const base = join(repo, ".agents/skills/cli-native-provider");
const pkg = join(repo, "app/node_modules/@earendil-works/pi-coding-agent");
const rel = path => relative(repo, path).replaceAll("\\", "/");
const sha = path => createHash("sha256").update(readFileSync(path)).digest("hex");
const fingerprint = path => ({ path: rel(path), bytes: readFileSync(path).length, sha256: sha(path) });
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  assert.ok(!entry.isSymbolicLink(), "skill files must not hide behind symlinks");
  const path = join(dir, entry.name);
  return entry.isDirectory() ? walk(path) : [path];
});
const skillFiles = walk(base).sort();
assert.equal(skillFiles.length, 10);
assert.equal(skillFiles.filter(path => path.endsWith("/SKILL.md")).length, 1);
const migratedDocs = ["docs/kiro-auth.md", "docs/kiro-macos-handoff.md"].map(path => join(repo, path));
const checkedMarkdown = [...skillFiles, ...migratedDocs, ...["CONTRACT.md", "CONTENT-REVIEW.md", "REPORT.md"].map(path => join(evidence, path))];
const links = [];
for (const path of checkedMarkdown) {
  const source = readFileSync(path, "utf8");
  assert.ok(source.endsWith("\n"), `missing final newline: ${rel(path)}`);
  assert.doesNotMatch(source, /[\t ]+$/m, `trailing whitespace: ${rel(path)}`);
  assert.equal((source.match(/^```/gm) ?? []).length % 2, 0, `unclosed code fence: ${rel(path)}`);
  assert.doesNotMatch(source, /(?:\/Users\/[^/\s]+\/|[A-Za-z]:[\\/]Users[\\/]|\/private\/var\/folders\/)/, `private path: ${rel(path)}`);
  for (const [, href] of source.matchAll(/\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
    if (/^(?:https?:|#)/.test(href)) continue;
    const target = resolve(dirname(path), decodeURIComponent(href.split("#")[0]));
    assert.ok(existsSync(target), `missing link: ${rel(path)} -> ${href}`);
    links.push({ source: rel(path), target: href });
  }
}
for (const path of migratedDocs) {
  const source = readFileSync(path, "utf8");
  assert.ok(source.includes("cli-native-provider/SKILL.md"));
  assert.ok(!source.includes(".agents/skills/kiro-native-parity-evidence"), "stale canonical link");
}
const report = {
  schema: "cli-provider-skill-verification-1", mode, status: "passed", node: process.version,
  skillMarkdownFiles: skillFiles.length, markdownFilesChecked: checkedMarkdown.length,
  localLinkInstances: links.length, links,
};
if (mode === "all") {
  // Empty settings and HOME avoid credential/config reads. Deny network/process
  // APIs before dynamic imports; this is a JS guard, not an OS network audit.
  let deniedCalls = 0;
  const deny = () => { deniedCalls++; throw new Error("network/process forbidden in skill validation"); };
  globalThis.fetch = deny;
  http.request = http.get = https.request = https.get = deny;
  net.Socket.prototype.connect = deny;
  for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) childProcess[name] = deny;
  syncBuiltinESMExports();
  const isolated = mkdtempSync(join(tmpdir(), "cli-provider-skill-"));
  const previousHome = process.env.HOME;
  process.env.HOME = join(isolated, "home");
  mkdirSync(process.env.HOME);
  try {
    const { loadSkillsFromDir, formatSkillsForPrompt } = await import(pathToFileURL(join(pkg, "dist/core/skills.js")).href);
    const { DefaultPackageManager } = await import(pathToFileURL(join(pkg, "dist/core/package-manager.js")).href);
    const { SettingsManager } = await import(pathToFileURL(join(pkg, "dist/core/settings-manager.js")).href);
    const parsed = loadSkillsFromDir({ dir: base, source: "path" });
    assert.deepEqual(parsed.diagnostics, []);
    assert.equal(parsed.skills.length, 1);
    assert.equal(parsed.skills[0].name, "cli-native-provider");
    assert.equal(parsed.skills[0].disableModelInvocation, false);
    assert.ok(formatSkillsForPrompt(parsed.skills).includes(parsed.skills[0].filePath));
    const tree = loadSkillsFromDir({ dir: dirname(base), source: "path" });
    assert.deepEqual(tree.diagnostics, []);
    assert.equal(tree.skills.filter(skill => skill.name === "cli-native-provider").length, 1);
    assert.equal(tree.skills.filter(skill => skill.name === "kiro-native-parity-evidence").length, 0);
    const discoveries = [];
    for (const cwd of [repo, join(repo, "app")]) {
      const settingsManager = SettingsManager.fromStorage({ withLock: (_scope, read) => read("{}") }, { projectTrusted: true });
      const paths = await new DefaultPackageManager({ cwd, agentDir: join(isolated, "agent"), settingsManager }).resolve(async () => "skip");
      const candidates = paths.skills.filter(item => [base, join(base, "SKILL.md")].includes(resolve(item.path)));
      assert.equal(candidates.length, 1);
      assert.equal(candidates[0].enabled, true);
      assert.ok(!paths.skills.some(item => resolve(item.path).startsWith(join(evidence, "legacy"))), "archive auto-discovered");
      discoveries.push({ cwd: rel(cwd) || ".", enabled: true, source: candidates[0].metadata.source });
    }
    assert.equal(deniedCalls, 0);
    Object.assign(report, {
      pi: JSON.parse(readFileSync(join(pkg, "package.json"), "utf8")).version,
      diagnostics: parsed.diagnostics, discoveries, deniedNetworkOrProcessCalls: deniedCalls,
      loaderFiles: ["skills.js", "package-manager.js", "settings-manager.js"].map(name => fingerprint(join(pkg, "dist/core", name))),
    });
  } finally {
    if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
    rmSync(isolated, { recursive: true, force: true });
  }
  const snapshot = JSON.parse(readFileSync(join(evidence, "source-snapshot.json"), "utf8"));
  const historical = JSON.parse(readFileSync(join(repo, "docs/evidence/kiro-macos-transition/verification.json"), "utf8"));
  assert.equal(snapshot.archived.length, 6);
  assert.equal(snapshot.frozen.length, 3);
  report.archived = snapshot.archived.map(row => {
    assert.ok(!existsSync(join(repo, row.original)), "old canonical path remains");
    assert.equal(sha(join(repo, row.archive)), row.sha256);
    const old = historical.stagedFiles.find(file => file.path === row.original);
    assert.ok(old, "missing frozen source row");
    assert.equal(row.sha256, old.sha256, "pre-move bytes differ from frozen historical manifest");
    assert.equal(readFileSync(join(repo, row.archive)).length, old.bytes);
    return { original: row.original, ...fingerprint(join(repo, row.archive)), matchesHistoricalManifest: true };
  });
  report.frozen = snapshot.frozen.map(row => {
    assert.equal(sha(join(repo, row.path)), row.sha256);
    return fingerprint(join(repo, row.path));
  });
  report.files = [...skillFiles, ...migratedDocs, ...["verify-skill.mjs", "source-snapshot.json", "CONTRACT.md", "CONTENT-REVIEW.md"].map(path => join(evidence, path))].map(fingerprint);
}
report.limits = [
  "Documentation/parser/trusted-project discovery only; active-session hot reload and user/home collisions not tested",
  "No extension, provider implementation, vendor CLI, real model, capture, REA analysis, deployment or restart",
  "JavaScript network/process guard is not an OS sandbox; path/format scan is not a complete secret audit",
  "External URLs and historical archive cross-tree links retain their original context and are not checked",
  "Content walkthrough is a documented manual review, not automated semantic proof",
];
clearTimeout(deadline);
console.log(JSON.stringify(report, null, 2));
