import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { PROBE_PATHS, sourceProofAction, verifySourceProof } from '../../scripts/native-source-proof.mjs';

const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
async function fixture(run: (context: any) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'axiom-native-source-proof-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const put = async (path: string, value: string | Buffer) => { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), value); };
  const commit = () => git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
  try {
    git('init', '--initial-branch=main'); git('config', 'core.autocrlf', 'false');
    const required = ['package.json', 'app/desktop/axiom_connection.rs', 'app/desktop/axiom_remote.rs', 'app/desktop/axiom_service.rs', 'app/desktop/axiom_setup.rs', 'app/desktop/axiom_views.rs', 'app/desktop/test-probe.rs', 'app/src/client/pages/Connect.tsx', 'scripts/build-desktop.mjs', 'scripts/check-desktop-macos.mjs', 'scripts/native-source-proof.mjs'];
    for (const path of [...required, ...PROBE_PATHS]) await put(path, `// product ${path}\n`);
    await put('empty.txt', '');
    await put('.gitignore', 'app/dist/\napp/test-results/\napp/Axiom2.dmg\n.DS_Store\n');
    git('add', '--', '.gitignore', 'empty.txt', ...required, ...PROBE_PATHS); commit();
    const productSha = git('rev-parse', 'HEAD');
    for (const path of PROBE_PATHS) await put(path, `// workflow ${path}\n`);
    git('add', '--', ...PROBE_PATHS); commit();
    const probeSha = git('rev-parse', 'HEAD');
    git('-c', 'advice.detachedHead=false', 'checkout', '--detach', productSha);
    await put('app/dist/desktop/index.html', '<html>fixture</html>');
    await put('app/dist/desktop/assets/app.js', 'console.log("fixture");');
    await put('app/dist/desktop/assets/app.css', 'body { color: black; }');
    const dmg = Buffer.from('immutable production disk image');
    await put('app/Axiom2.dmg', dmg);
    const expected = { productSha, probeSha, dmg: { size: dmg.length, sha256: digest(dmg) } };
    const override = async () => { for (const path of PROBE_PATHS) await put(path, execFileSync('git', ['show', `${probeSha}:${path}`], { cwd: root })); };
    await run({ root, git, put, expected, override, commit });
  } finally { await rm(root, { recursive: true, force: true }); }
}
const seal = async (context: any) => {
  await sourceProofAction('capture', context.root, context.expected.probeSha);
  await sourceProofAction('seal-production', context.root, context.expected.probeSha);
  await context.override();
};

test('native source proof binds distinct product/workflow SHAs, all tracked inputs, web files and original DMG', async () => {
  await fixture(async context => {
    await seal(context);
    const proof = await sourceProofAction('verify', context.root, context.expected.probeSha);
    assert.notEqual(proof.productSha, proof.probeSha);
    assert.equal(verifySourceProof(proof, context.expected), proof);
    const emptyInput = proof.productFiles.find(file => file.path === 'empty.txt');
    assert.ok(emptyInput, 'the tracked empty input is retained in the proof');
    assert.equal(emptyInput.size, 0);
    assert.equal(proof.webFiles.length, 3);
    assert.deepEqual(JSON.parse(await readFile(join(context.root, 'app/test-results/native-source-proof.json'), 'utf8')), proof);
    for (const mutate of [
      (p: any) => { p.format = 2; },
      (p: any) => { p.phase = 'sealed'; },
      (p: any) => { p.productSha = '0'.repeat(40); },
      (p: any) => { p.probeSha = p.productSha; },
      (p: any) => { p.productFiles = p.productFiles.filter((f: any) => f.path !== 'app/desktop/test-probe.rs'); },
      (p: any) => { p.productFiles.push(p.productFiles[0]); },
      (p: any) => { p.productFiles[0].path = '../outside'; },
      (p: any) => { p.productFiles[0].sha256 = 'invalid'; },
      (p: any) => { p.productInputsSha256 = '0'.repeat(64); },
      (p: any) => { p.webFiles[0].size = 0; },
      (p: any) => { p.webFiles = p.webFiles.filter((f: any) => !f.path.endsWith('.css')); },
      (p: any) => { p.webFiles[0].path = 'outside/app.js'; },
      (p: any) => { p.webInputsSha256 = '0'.repeat(64); },
      (p: any) => { p.probeFiles[0].path = 'app/desktop/other.js'; },
      (p: any) => { p.productionDmg.sha256 = '0'.repeat(64); },
      (p: any) => { p.productionDmg.size++; },
    ]) {
      const bad = structuredClone(proof); mutate(bad);
      assert.throws(() => verifySourceProof(bad, context.expected));
    }
  });
});

test('changed product input cannot be sealed as source_ref', async () => {
  await fixture(async context => {
    await sourceProofAction('capture', context.root, context.expected.probeSha);
    await context.put('app/src/client/pages/Connect.tsx', '// unexpected replacement');
    await assert.rejects(sourceProofAction('seal-production', context.root, context.expected.probeSha));
  });
});

test('changed web resource after production packaging fails before native launch', async () => {
  await fixture(async context => {
    await seal(context);
    await context.put('app/dist/desktop/assets/app.js', '// different test-instance resources');
    await assert.rejects(sourceProofAction('verify', context.root, context.expected.probeSha), /webFiles differ/);
  });
});

test('probe must match the exact workflow commit, not just its filename', async () => {
  await fixture(async context => {
    await seal(context);
    await context.put(PROBE_PATHS[0], '// unrelated probe');
    await assert.rejects(sourceProofAction('verify', context.root, context.expected.probeSha), /Probe is not from the recorded workflow revision/);
  });
});

test('production disk image cannot be replaced by the test-instance build', async () => {
  await fixture(async context => {
    await seal(context);
    await context.put('app/Axiom2.dmg', 'different disk image');
    await assert.rejects(sourceProofAction('verify', context.root, context.expected.probeSha), /does not cover this production DMG/);
  });
});

test('untracked and ignored source inputs cannot bypass the tracked source proof', async () => {
  for (const path of ['app/desktop/injected.rs', 'app/src/client/injected.ts', 'scripts/injected.mjs', 'app/desktop/.DS_Store']) {
    await fixture(async context => {
      await seal(context);
      await context.put(path, '// untracked source');
      await assert.rejects(sourceProofAction('verify', context.root, context.expected.probeSha), /Untracked or ignored source input/);
    });
  }
});

test('source proof requires capture, seal, verify ordering and the same workflow SHA', async () => {
  await fixture(async context => {
    await sourceProofAction('capture', context.root, context.expected.probeSha);
    await assert.rejects(sourceProofAction('verify', context.root, context.expected.probeSha), /sealed/);
    await assert.rejects(sourceProofAction('seal-production', context.root, '0'.repeat(40)));
    await assert.rejects(sourceProofAction('capture', context.root, 'not-a-commit'));
  });
});
