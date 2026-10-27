import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Only these test-only JS inputs may come from the workflow revision rather than
// source_ref. Rust, the runner, all product inputs, and the web build stay frozen.
export const PROBE_PATHS = ['app/desktop/test-controller-probe.js', 'app/desktop/test-workbench-probe.js'];
const REQUIRED = ['package.json', 'app/desktop/axiom_connection.rs', 'app/desktop/axiom_remote.rs', 'app/desktop/axiom_service.rs', 'app/desktop/axiom_setup.rs', 'app/desktop/axiom_views.rs', 'app/desktop/test-probe.rs', 'app/src/client/pages/Connect.tsx', 'scripts/build-desktop.mjs', 'scripts/check-desktop-macos.mjs', 'scripts/native-source-proof.mjs'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const shaPattern = /^[a-f0-9]{64}$/;
const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const cleanPath = path => typeof path === 'string' && !/[\\\x00-\x1f\x7f]/.test(path) && path.split('/').every(part => part && part !== '.' && part !== '..');
function records(files) {
  assert.ok(Array.isArray(files) && files.length > 0);
  for (const file of files) {
    assert.ok(cleanPath(file.path), 'Invalid source proof path');
    assert.match(file.sha256 || '', shaPattern);
    assert.ok(Number.isSafeInteger(file.size) && file.size >= 0, 'Invalid source proof input size');
  }
  const names = files.map(file => file.path);
  assert.deepEqual(names, [...new Set(names)].sort(), 'Source proof inputs must be unique and sorted');
}
function gitlinkRecords(links, productFiles) {
  assert.ok(Array.isArray(links), 'Missing gitlink provenance');
  const paths = links.map(link => {
    assert.ok(cleanPath(link.path) && link.path.startsWith('review-artifacts/'), 'Gitlink outside audit artifacts');
    assert.match(link.commit || '', /^[a-f0-9]{40}$/);
    assert.ok(!productFiles.some(file => file.path === link.path || file.path.startsWith(`${link.path}/`)), 'Gitlink overlaps product inputs');
    return link.path;
  });
  assert.deepEqual(paths, [...new Set(paths)].sort(), 'Gitlink inputs must be unique and sorted');
}
export function verifySourceProof(proof, { productSha, probeSha, dmg }) {
  assert.equal(proof?.format, 1);
  assert.equal(proof.phase, 'verified');
  assert.match(productSha || '', /^[a-f0-9]{40}$/);
  assert.match(probeSha || '', /^[a-f0-9]{40}$/);
  assert.equal(proof.productSha, productSha, 'Native product source differs from release');
  assert.equal(proof.probeSha, probeSha, 'Native JS probe source differs from workflow');
  records(proof.productFiles);
  gitlinkRecords(proof.gitlinks, proof.productFiles);
  assert.equal(proof.gitlinksSha256, hash(JSON.stringify(proof.gitlinks)));
  const paths = new Set(proof.productFiles.map(file => file.path));
  for (const required of REQUIRED) assert.ok(paths.has(required), `Missing product input ${required}`);
  assert.ok(PROBE_PATHS.every(path => !paths.has(path)), 'Workflow probes must be separate from product inputs');
  assert.equal(proof.productInputsSha256, hash(JSON.stringify(proof.productFiles)));
  records(proof.webFiles);
  assert.ok(proof.webFiles.every(file => file.path.startsWith('app/dist/desktop/') && file.size > 0));
  assert.ok(proof.webFiles.some(file => file.path === 'app/dist/desktop/index.html'));
  assert.ok(proof.webFiles.some(file => file.path.endsWith('.js')) && proof.webFiles.some(file => file.path.endsWith('.css')));
  assert.equal(proof.webInputsSha256, hash(JSON.stringify(proof.webFiles)));
  records(proof.probeFiles);
  assert.deepEqual(proof.probeFiles.map(file => file.path), PROBE_PATHS);
  assert.match(proof.productionDmg?.sha256 || '', shaPattern);
  assert.ok(Number.isSafeInteger(proof.productionDmg.size) && proof.productionDmg.size > 0);
  assert.deepEqual(proof.productionDmg, dmg, 'Native evidence does not cover this production DMG');
  return proof;
}
async function fileRecord(root, path) {
  const info = await lstat(join(root, path));
  assert.ok(info.isFile() && !info.isSymbolicLink(), `Expected regular proof input ${path}`);
  return { path, size: info.size, sha256: hash(await readFile(join(root, path))) };
}
async function inventory(root) {
  const paths = [], gitlinks = [];
  for (const entry of git(root, 'ls-tree', '-r', '-z', 'HEAD').split('\0').filter(Boolean)) {
    const tab = entry.indexOf('\t');
    const [mode, type, oid] = entry.slice(0, tab).split(' ');
    const path = entry.slice(tab + 1);
    assert.ok(tab > 0 && cleanPath(path), 'Invalid tracked source path');
    if (mode === '160000' && type === 'commit') {
      assert.ok(path.startsWith('review-artifacts/'), 'Gitlink outside audit artifacts');
      // Only uninitialized, empty audit gitlinks are excluded from file bytes.
      // Check every parent so an ancestor symlink cannot escape the checkout.
      let directory = root;
      for (const part of path.split('/')) {
        directory = join(directory, part);
        const info = await lstat(directory);
        assert.ok(info.isDirectory() && !info.isSymbolicLink(), 'Expected real gitlink directory');
      }
      assert.deepEqual(await readdir(directory), [], 'Audit gitlink must remain empty');
      gitlinks.push({ path, commit: oid });
    } else {
      assert.ok(type === 'blob' && ['100644', '100755'].includes(mode), 'Expected regular tracked source input');
      if (!PROBE_PATHS.includes(path)) paths.push(path);
    }
  }
  paths.sort(); gitlinks.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  gitlinkRecords(gitlinks, paths.map(path => ({ path })));
  // Check ignored files too: --exclude-standard would silently allow an ignored
  // source input. Only the four documented native compiler outputs are allowed.
  const generated = new Set(['bin/native/linux-x64/axiom-owner', 'bin/native/linux-x64/manifest.json', 'bin/native/linux-arm64/axiom-owner', 'bin/native/linux-arm64/manifest.json']);
  const untracked = git(root, 'ls-files', '--others', '-z', '--', 'app/desktop', 'app/src', 'scripts', 'bootstrap', 'native', 'bin').split('\0').filter(path => path && !generated.has(path));
  assert.deepEqual(untracked, [], 'Untracked or ignored source input is outside the release provenance');
  // Fail closed on staged or working changes to the tracked product snapshot.
  git(root, 'diff', '--quiet', 'HEAD', '--', '.', ...PROBE_PATHS.map(path => `:(exclude)${path}`));
  const productFiles = [];
  // Stay below native macOS file-descriptor limits on large repositories.
  for (let index = 0; index < paths.length; index += 32) {
    productFiles.push(...await Promise.all(paths.slice(index, index + 32).map(path => fileRecord(root, path))));
  }
  const webPaths = [];
  async function visit(path) {
    for (const entry of await readdir(join(root, path), { withFileTypes: true })) {
      const child = `${path}/${entry.name}`;
      if (entry.isDirectory()) await visit(child);
      else { assert.ok(entry.isFile() && !entry.isSymbolicLink(), 'Invalid web resource'); webPaths.push(child); }
    }
  }
  await visit('app/dist/desktop');
  const webFiles = await Promise.all(webPaths.sort().map(path => fileRecord(root, path)));
  return { productSha: git(root, 'rev-parse', 'HEAD').trim(), productFiles, gitlinks, webFiles };
}
async function unchanged(root, proof) {
  const current = await inventory(root);
  for (const key of ['productSha', 'productFiles', 'gitlinks', 'webFiles']) assert.deepEqual(current[key], proof[key], `Production and test-instance ${key} differ`);
}
export async function sourceProofAction(action, root, probeSha) {
  assert.match(probeSha || '', /^[a-f0-9]{40}$/);
  const path = join(root, 'app/test-results/native-source-proof.json');
  let proof;
  if (action === 'capture') {
    const current = await inventory(root);
    proof = { format: 1, phase: 'captured', ...current, probeSha, productInputsSha256: hash(JSON.stringify(current.productFiles)), gitlinksSha256: hash(JSON.stringify(current.gitlinks)), webInputsSha256: hash(JSON.stringify(current.webFiles)) };
  } else {
    proof = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(proof.format, 1); assert.equal(proof.probeSha, probeSha);
    await unchanged(root, proof);
    if (action === 'seal-production') {
      assert.equal(proof.phase, 'captured');
      const { size, sha256 } = await fileRecord(root, 'app/Axiom2.dmg');
      proof.productionDmg = { size, sha256 };
      proof.phase = 'sealed';
    } else {
      assert.equal(action, 'verify'); assert.equal(proof.phase, 'sealed');
      proof.probeFiles = await Promise.all(PROBE_PATHS.map(async path => {
        const file = await fileRecord(root, path);
        const committed = execFileSync('git', ['show', `${probeSha}:${path}`], { cwd: root, maxBuffer: 1024 * 1024 });
        assert.equal(file.sha256, hash(committed), 'Probe is not from the recorded workflow revision');
        return file;
      }));
      const { size, sha256 } = await fileRecord(root, 'app/Axiom2.dmg');
      proof.phase = 'verified';
      verifySourceProof(proof, { productSha: git(root, 'rev-parse', 'HEAD').trim(), probeSha, dmg: { size, sha256 } });
    }
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(proof, null, 2) + '\n');
  console.log(`Native source proof ${proof.phase}: product=${proof.productSha}, JS probes=${probeSha}, product inputs=${proof.productFiles.length}, web resources=${proof.webFiles.length}`);
  return proof;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  await sourceProofAction(process.argv[2], root, process.env.AXIOM_REGRESSION_REF || process.env.GITHUB_SHA);
}
