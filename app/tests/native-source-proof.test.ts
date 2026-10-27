import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { PROBE_PATHS, sourceProofAction, verifySourceProof } from '../../scripts/native-source-proof.mjs';

const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
async function fixture(run: (context: any) => Promise<void>, gitlinkPaths: string[] = []) {
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
    const gitlinkCommit = git('rev-parse', 'HEAD');
    if (gitlinkPaths.length) {
      await put('review-artifacts/ordinary.txt', 'tracked audit input');
      git('add', '--', 'review-artifacts/ordinary.txt');
      for (const path of gitlinkPaths) {
        git('update-index', '--add', '--cacheinfo', `160000,${gitlinkCommit},${path}`);
        await mkdir(join(root, path), { recursive: true });
      }
      commit();
    }
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
    await run({ root, git, put, expected, override, commit, gitlinkCommit });
  } finally { await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
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
      (p: any) => { delete p.gitlinks; },
      (p: any) => { p.gitlinksSha256 = '0'.repeat(64); },
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

const auditLink = 'review-artifacts/audit/source';
test('empty audit gitlinks retain commit provenance without excluding ordinary audit files', async () => {
  await fixture(async context => {
    await seal(context);
    const proof = await sourceProofAction('verify', context.root, context.expected.probeSha);
    assert.deepEqual(proof.gitlinks, [{ path: auditLink, commit: context.gitlinkCommit }]);
    assert.ok(proof.productFiles.some((file: any) => file.path === 'review-artifacts/ordinary.txt'));
    assert.ok(!proof.productFiles.some((file: any) => file.path === auditLink));
    for (const mutate of [
      (p: any) => { p.gitlinks[0].commit = 'invalid'; },
      (p: any) => { p.gitlinks[0].path = 'scripts/submodule'; },
      (p: any) => { p.gitlinks[0].path = 'review-artifacts/../outside'; },
      (p: any) => { p.gitlinks.push(p.gitlinks[0]); },
      (p: any) => { p.gitlinks[0].path = 'review-artifacts/ordinary.txt'; },
      (p: any) => { p.gitlinks = []; },
    ]) {
      const bad = structuredClone(proof); mutate(bad);
      assert.throws(() => verifySourceProof(bad, context.expected));
    }
  }, [auditLink]);
});

test('non-audit gitlinks and materialized or redirected audit directories fail closed', async () => {
  await fixture(async context => {
    await assert.rejects(sourceProofAction('capture', context.root, context.expected.probeSha), /Gitlink outside audit/);
  }, ['scripts/submodule']);
  for (const replacement of ['file', 'symlink', 'contents', 'hidden', 'directory']) {
    await fixture(async context => {
      const path = join(context.root, auditLink);
      if (replacement === 'file' || replacement === 'symlink') {
        await rm(path, { recursive: true });
        if (replacement === 'file') await context.put(auditLink, 'not a directory');
        else await symlink(join(context.root, 'app'), path, process.platform === 'win32' ? 'junction' : 'dir');
      } else if (replacement === 'directory') await mkdir(join(path, 'empty'));
      else await context.put(`${auditLink}/${replacement === 'hidden' ? '.git' : 'input.rs'}`, 'injected');
      await assert.rejects(sourceProofAction('capture', context.root, context.expected.probeSha), /gitlink|Gitlink/);
    }, [auditLink]);
  }
});

test('audit gitlink injection and changed proof commit fail between production and probe', async () => {
  for (const action of ['seal-production', 'verify'] as const) {
    await fixture(async context => {
      await sourceProofAction('capture', context.root, context.expected.probeSha);
      if (action === 'verify') { await sourceProofAction('seal-production', context.root, context.expected.probeSha); await context.override(); }
      await context.put(`${auditLink}/injected`, 'unexpected');
      await assert.rejects(sourceProofAction(action, context.root, context.expected.probeSha), /must remain empty/);
    }, [auditLink]);
    await fixture(async context => {
      await sourceProofAction('capture', context.root, context.expected.probeSha);
      if (action === 'verify') { await sourceProofAction('seal-production', context.root, context.expected.probeSha); await context.override(); }
      const path = join(context.root, 'app/test-results/native-source-proof.json');
      const proof = JSON.parse(await readFile(path, 'utf8'));
      proof.gitlinks[0].commit = '0'.repeat(40);
      proof.gitlinksSha256 = digest(JSON.stringify(proof.gitlinks));
      await writeFile(path, JSON.stringify(proof));
      await assert.rejects(sourceProofAction(action, context.root, context.expected.probeSha), /gitlinks differ/);
    }, [auditLink]);
  }
});

test('workflow verifier in a temporary directory preserves the frozen product tool and checkout root', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'axiom-workflow-proof-'));
  try {
    const tool = join(directory, 'proof.mjs');
    await writeFile(tool, await readFile(new URL('../../scripts/native-source-proof.mjs', import.meta.url)));
    const { sourceProofAction: temporaryAction } = await import(pathToFileURL(tool).href);
    await fixture(async context => {
      await temporaryAction('capture', context.root, context.expected.probeSha);
      await temporaryAction('seal-production', context.root, context.expected.probeSha);
      await context.override();
      const proof = await temporaryAction('verify', context.root, context.expected.probeSha);
      assert.equal(proof.productSha, context.expected.productSha);
      await context.put('scripts/native-source-proof.mjs', '// overwritten product proof tool');
      await assert.rejects(temporaryAction('verify', context.root, context.expected.probeSha));
    }, [auditLink]);
  } finally { await rm(directory, { recursive: true, force: true }); }
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
