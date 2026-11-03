import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const dir = dirname(fileURLToPath(import.meta.url));
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const verification = JSON.parse(readFileSync(join(dir, 'verification.json'), 'utf8'));
assert.equal(verification.status, 'passed');
assert.equal(readFileSync(join(dir, 'verification.stderr')).length, 0);
assert.equal(readFileSync(join(dir, 'diff-check.log')).length, 0);
const baseline = JSON.parse(readFileSync(join(dir, 'baseline.json'), 'utf8'));
const rows = [...verification.files, ...verification.loaderFiles,
  ...baseline.frozen.filter(row => row.path !== 'docs/native-provider-component.md')];
assert.equal(rows.length, 54);
for (const row of rows) assert.equal(hash(join(repo, row.path)), row.sha256, row.path);
const reportPath = join(dir, 'REPORT.md');
const text = readFileSync(reportPath, 'utf8');
assert.ok(text.endsWith('\n'));
assert.doesNotMatch(text, /[\t ]+$/m);
assert.equal((text.match(/^```/gm) ?? []).length % 2, 0);
const links = [];
for (const [, href] of text.matchAll(/\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
  if (/^(?:https?:|#)/.test(href)) continue;
  assert.ok(existsSync(resolve(dir, decodeURIComponent(href.split('#')[0]))), href);
  links.push(href);
}
console.log(JSON.stringify({ status: 'passed', matchedFingerprints: rows.length, reportLinks: links,
  finalFiles: ['REPORT.md', 'verification.json', 'final-check.mjs', 'diff-check.log'].map(name => {
    const path = join(dir, name);
    return { path: relative(repo, path), bytes: readFileSync(path).length, sha256: hash(path) };
  }), limits: 'Readback only; parser/discovery results reused because tested files are unchanged',
}, null, 2));
