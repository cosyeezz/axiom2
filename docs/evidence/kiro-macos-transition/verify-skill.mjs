// File/parser/discovery validation only. No extension, target or model execution.
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve, dirname, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const repo = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const base = join(repo, ".agents/skills/kiro-native-parity-evidence");
const pkg = join(repo, "app/node_modules/@earendil-works/pi-coding-agent");
const { loadSkillsFromDir, formatSkillsForPrompt } = await import(pathToFileURL(join(pkg, "dist/core/skills.js")).href);
const { DefaultPackageManager } = await import(pathToFileURL(join(pkg, "dist/core/package-manager.js")).href);
const { SettingsManager } = await import(pathToFileURL(join(pkg, "dist/core/settings-manager.js")).href);
const sha = path => createHash("sha256").update(readFileSync(path)).digest("hex");
const parsed = loadSkillsFromDir({ dir: base, source: "path" });
assert.equal(parsed.skills.length, 1);
assert.deepEqual(parsed.diagnostics, []);
assert.equal(parsed.skills[0].name, "kiro-native-parity-evidence");
assert.equal(parsed.skills[0].disableModelInvocation, false);
assert.ok(formatSkillsForPrompt(parsed.skills).includes(parsed.skills[0].filePath));
const skillNames = ["SKILL.md", "references/case-lessons.md", "references/windows-runtime.md", "references/session-entry.md", "references/macos-native.md", "references/windows-evidence.md"];
const files = [...skillNames.map(name => join(base, name)), ...["docs/kiro-macos-handoff.md", "docs/kiro-auth.md", "docs/kiro-catalog-cancellation.md", "docs/evidence/kiro-macos-transition/README.md"].map(name => join(repo, name))];
const links = [];
for (const path of files) {
  const text = readFileSync(path, "utf8");
  assert.doesNotMatch(text, /(?:[A-Za-z]:[\\/]Users[\\/]|C:[\\/]Program Files|F:[\\/]Axiom)/, "non-portable private path");
  for (const [, href] of text.matchAll(/\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
    if (/^(?:https?:|#)/.test(href)) continue;
    const target = resolve(dirname(path), decodeURIComponent(href.split("#")[0]));
    assert.ok(existsSync(target), `missing link ${relative(repo, path)} -> ${href}`);
    links.push({ source: relative(repo, path).replaceAll("\\", "/"), target: href });
  }
}
const main = readFileSync(join(base, "SKILL.md"), "utf8");
assert.match(main, /核心指导：先定位，再局部分析/);
assert.match(main, /不是先跑完整程序、失败后才缩小范围/);
const mac = readFileSync(join(base, "references/macos-native.md"), "utf8");
assert.match(mac, /macOS版Kiro CLI/);
assert.match(mac, /不使用付费Hopper/);
assert.match(mac, /不以完成Windows supervisor02为Mac迁移前置/);
// Same package resolver used by Axiom capability-resources; isolated settings,
// project trust enabled. Resolve only; skip missing packages, execute no extension.
const agentDir = mkdtempSync(join(tmpdir(), "kiro-skill-discovery-"));
const discoveries = [];
try {
  for (const cwd of [repo, join(repo, "app")]) {
    const settingsManager = SettingsManager.fromStorage({ withLock: (_scope, read) => read("{}") }, { projectTrusted: true });
    const paths = await new DefaultPackageManager({ cwd, agentDir, settingsManager }).resolve(async () => "skip");
    const candidate = paths.skills.find(item => resolve(item.path) === resolve(join(base, "SKILL.md")) || resolve(item.path) === resolve(base));
    assert.ok(candidate?.enabled, "project .agents skill not discovered");
    discoveries.push({ cwd: relative(repo, cwd).replaceAll("\\", "/") || ".", enabled: candidate.enabled, source: candidate.metadata.source });
  }
} finally { rmSync(agentDir, { recursive: true, force: true }); }
console.log(JSON.stringify({ schema: "kiro-mac-transition-skill-1", status: "passed", node: process.version,
  pi: JSON.parse(readFileSync(join(pkg, "package.json"), "utf8")).version,
  parserSha256: sha(join(pkg, "dist/core/skills.js")), diagnostics: parsed.diagnostics,
  discoveredFrom: discoveries, localLinks: links.length, files: files.map(path => ({ path: relative(repo, path).replaceAll("\\", "/"), sha256: sha(path) })),
  limits: ["File/parser/package discovery only; active session selection or hot reload not verified", "No macOS runtime, CLI, model, network capture or old fixture execution", "Private-path scan is not a complete secret audit"] }, null, 2));
