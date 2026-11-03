// Skill documentation and discovery only; no vendor or test harness imports.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import childProcess from 'node:child_process';

const deadline = setTimeout(() => { console.error('verification deadline'); process.exit(2); }, 55_000);
deadline.unref();
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const evidence = dirname(fileURLToPath(import.meta.url));
const base = join(repo, '.agents/skills/cli-native-provider');
const pkg = join(repo, 'app/node_modules/@earendil-works/pi-coding-agent');
const rel = path => relative(repo, path).replaceAll('\\', '/');
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const fingerprint = path => ({ path: rel(path), bytes: readFileSync(path).length, sha256: sha(path) });
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  assert.ok(!entry.isSymbolicLink());
  const path = join(dir, entry.name);
  return entry.isDirectory() ? walk(path) : [path];
});
const skillFiles = walk(base).sort();
assert.equal(skillFiles.length, 10);
assert.ok(skillFiles.every(path => path.endsWith('.md')));
const baseline = JSON.parse(readFileSync(join(evidence, 'baseline.json'), 'utf8'));
assert.equal(baseline.before.length, 10);
assert.equal(baseline.frozen.length, 37);
const changed = baseline.before.filter(row => sha(join(repo, row.path)) !== row.sha256).map(row => row.path);
assert.deepEqual(changed.map(path => relative(base, join(repo, path))).sort(), [
  'SKILL.md', 'references/case-lessons.md', 'references/provider-architecture.md',
  'references/verification.md', 'templates/CASE-CONTRACT.md', 'templates/HANDOFF.md', 'templates/ONBOARDING.md',
].sort());
for (const row of baseline.before) {
  assert.equal(createHash('sha256').update(row.content).digest('hex'), row.sha256);
}
const allowedClarification = 'docs/native-provider-component.md';
const frozen = baseline.frozen.filter(row => row.path !== allowedClarification);
assert.equal(frozen.length, 36);
for (const row of frozen) assert.equal(sha(join(repo, row.path)), row.sha256, `frozen change: ${row.path}`);
const markdown = [...skillFiles, join(evidence, 'CONTRACT.md'), join(repo, allowedClarification)];
const links = [];
for (const path of markdown) {
  const text = readFileSync(path, 'utf8');
  assert.ok(text.endsWith('\n'), `missing newline: ${rel(path)}`);
  assert.doesNotMatch(text, /[\t ]+$/m, `trailing whitespace: ${rel(path)}`);
  assert.equal((text.match(/^```/gm) ?? []).length % 2, 0, `unclosed fence: ${rel(path)}`);
  assert.doesNotMatch(text, /(?:\/Users\/[^/\s]+\/|\/private\/var\/folders\/)/, 'private path');
  for (const [, href] of text.matchAll(/\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
    if (/^(?:https?:|#)/.test(href)) continue;
    assert.ok(existsSync(resolve(dirname(path), decodeURIComponent(href.split('#')[0]))), `broken link: ${rel(path)} -> ${href}`);
    links.push({ source: rel(path), target: href });
  }
}

// Guard before loading Pi. This is a JS boundary, not an OS sandbox.
let deniedCalls = 0;
const deny = () => { deniedCalls++; throw new Error('network/process forbidden'); };
globalThis.fetch = deny;
http.request = http.get = https.request = https.get = deny;
net.Socket.prototype.connect = deny;
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) childProcess[name] = deny;
syncBuiltinESMExports();
const isolated = mkdtempSync(join(tmpdir(), 'cli-provider-skill-02-'));
const previous = { HOME: process.env.HOME, PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR };
process.env.HOME = join(isolated, 'home');
process.env.PI_CODING_AGENT_DIR = join(isolated, 'agent');
mkdirSync(process.env.HOME);
mkdirSync(process.env.PI_CODING_AGENT_DIR);
let discoveries, diagnostics;
try {
  const { loadSkillsFromDir, formatSkillsForPrompt, DefaultPackageManager, SettingsManager } = await import(pathToFileURL(join(pkg, 'dist/index.js')).href);
  const parsed = loadSkillsFromDir({ dir: base, source: 'path' });
  assert.deepEqual(parsed.diagnostics, []);
  assert.equal(parsed.skills.length, 1);
  assert.equal(parsed.skills[0].name, 'cli-native-provider');
  assert.equal(parsed.skills[0].disableModelInvocation, false);
  assert.ok(formatSkillsForPrompt(parsed.skills).includes(parsed.skills[0].filePath));
  const tree = loadSkillsFromDir({ dir: dirname(base), source: 'path' });
  assert.deepEqual(tree.diagnostics, []);
  assert.equal(tree.skills.filter(skill => skill.name === 'cli-native-provider').length, 1);
  assert.ok(!tree.skills.some(skill => skill.name === 'kiro-native-parity-evidence'));
  diagnostics = parsed.diagnostics;
  discoveries = [];
  for (const cwd of [repo, join(repo, 'app')]) {
    const settingsManager = SettingsManager.fromStorage({ withLock: (_scope, read) => read('{}') }, { projectTrusted: true });
    const paths = await new DefaultPackageManager({ cwd, agentDir: process.env.PI_CODING_AGENT_DIR, settingsManager }).resolve(async () => 'skip');
    const candidates = paths.skills.filter(item => [base, join(base, 'SKILL.md')].includes(resolve(item.path)));
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].enabled, true);
    assert.ok(!paths.skills.some(item => resolve(item.path).startsWith(join(repo, 'docs/evidence'))));
    discoveries.push({ cwd: rel(cwd) || '.', enabled: true, source: candidates[0].metadata.source });
  }
  assert.equal(deniedCalls, 0);
} finally {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  rmSync(isolated, { recursive: true, force: true });
}
assert.ok(!existsSync(isolated));
clearTimeout(deadline);
console.log(JSON.stringify({
  schema: 'cli-provider-skill-update-verification-1', status: 'passed',
  node: process.version, pi: JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')).version,
  markdownFilesChecked: markdown.length, localLinkInstances: links.length, links,
  changedSkillFiles: changed, frozenFilesChecked: frozen.length,
  diagnostics, discoveries, deniedNetworkOrProcessCalls: deniedCalls, temporaryDirectoryRemoved: true,
  files: [...markdown, join(evidence, 'verify-skill.mjs'), join(evidence, 'baseline.json')].map(fingerprint),
  loaderFiles: ['index.js', 'core/skills.js', 'core/package-manager.js', 'core/settings-manager.js'].map(path => fingerprint(join(pkg, 'dist', path))),
  limits: [
    'Parser and trusted-project discovery only; no active-session hot reload or UI command tested',
    'No provider, model, vendor CLI, build, pack, installation, capture, deployment or restart executed',
    'JavaScript I/O guard is not an OS sandbox or complete secret audit',
    'Local file targets checked, not external URLs or Markdown fragment anchors',
    'Historical evidence reused without rerunning consumed cases; semantic review is manual',
  ],
}, null, 2));
