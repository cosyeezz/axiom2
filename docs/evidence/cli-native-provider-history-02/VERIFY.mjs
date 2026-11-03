// Read-only skill validation: no CLI execution, network, auth, app startup or config writes.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const root = join(repo, '.agents/skills/cli-native-provider');
const { loadSkillsFromDir, loadSkills, formatSkillsForPrompt } = await import(
  join(repo, 'app/node_modules/@earendil-works/pi-coding-agent/dist/core/skills.js')
);
const version = JSON.parse(readFileSync(join(repo, 'app/node_modules/@earendil-works/pi-coding-agent/package.json'), 'utf8')).version;
const scanned = loadSkillsFromDir({ dir: root, source: 'project' });
assert.equal(scanned.diagnostics.length, 0, JSON.stringify(scanned.diagnostics));
assert.equal(scanned.skills.length, 1);
const skill = scanned.skills[0];
assert.equal(skill.name, 'cli-native-provider');
assert.equal(skill.baseDir, root);
assert.equal(skill.filePath, join(root, 'SKILL.md'));
assert.ok(skill.description.includes('symptom-led triage'));
assert.ok(skill.description.includes('preserve caller context'));
assert.ok(skill.description.length <= 1024);
const prompt = formatSkillsForPrompt(scanned.skills, 'read');
assert.ok(prompt.includes(skill.name) && prompt.includes(skill.filePath));
const discovered = loadSkills({ cwd: repo, agentDir: '/nonexistent-cli-skill-validation', skillPaths: [root], includeDefaults: false });
assert.equal(discovered.diagnostics.length, 0, JSON.stringify(discovered.diagnostics));
assert.equal(discovered.skills.length, 1);
assert.equal(discovered.skills[0].filePath, skill.filePath);

function markdownFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? markdownFiles(path) : entry.name.endsWith('.md') ? [path] : [];
  });
}
const files = markdownFiles(root).sort();
assert.equal(files.length, 13);
assert.equal(markdownFiles(join(root, 'templates')).length, 4);
const graph = new Map();
const artifacts = [];
const errors = [];
let localLinks = 0, externalLinks = 0;
const captureGuide = join(repo, 'docs/cli-native-capture-comparison.md');
let guideLinks = 0;
for (const path of [...files, captureGuide]) {
  const text = readFileSync(path, 'utf8');
  artifacts.push({ path: relative(repo, path), bytes: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex') });
  let fence;
  for (const [index, line] of text.split('\n').entries()) {
    if (line.trimEnd() !== line || line.includes('\r') || line.includes('\0')) errors.push(`${relative(repo, path)}:${index + 1}: whitespace/character`);
    const match = line.match(/^\s*(`{3,}|~{3,})/);
    if (match) {
      if (!fence) fence = match[1];
      else if (match[1][0] === fence[0] && match[1].length >= fence.length) fence = undefined;
    }
  }
  if (fence) errors.push(`${path}: unclosed fence`);
  if (!text.endsWith('\n')) errors.push(`${path}: missing final newline`);
  const edges = [];
  for (const match of text.matchAll(/(?<!!)\[([^\]\n]+)\]\(([^)\n]+)\)/g)) {
    const url = match[2];
    if (/^(https?:\/\/|mailto:)/.test(url)) { externalLinks++; continue; }
    if (url.startsWith('#')) continue;
    const target = resolve(dirname(path), url.split('#')[0]);
    if (!existsSync(target)) errors.push(`${relative(repo, path)}: broken ${url}`);
    edges.push(target);
    if (path === captureGuide) guideLinks++;
    else localLinks++;
  }
  graph.set(path, edges);
}
const reached = new Set();
const todo = [skill.filePath];
while (todo.length) {
  const path = todo.pop();
  if (reached.has(path)) continue;
  reached.add(path);
  for (const next of graph.get(path) ?? []) if (graph.has(next)) todo.push(next);
}
for (const path of files) if (!reached.has(path)) errors.push(`unreachable from SKILL: ${path}`);
assert.deepEqual(errors, []);
console.log(JSON.stringify({
  status: 'passed', piVersion: version,
  parser: { skillCount: scanned.skills.length, diagnostics: 0, descriptionChars: skill.description.length, promptLocation: true, explicitDiscovery: true },
  documentation: { skillMarkdownFiles: files.length, localSkillLinks: localLinks, captureGuideLinks: guideLinks, externalLinksNotFetched: externalLinks, reachableSkillFiles: files.filter(path => reached.has(path)).length, errors },
  scope: { staticOnly: true, runtimeUIReload: 'not tested', providerTestsOrLive: 'not run' }, artifacts,
}, null, 2));
