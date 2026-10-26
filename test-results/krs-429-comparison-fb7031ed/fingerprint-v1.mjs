import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const out = fileURLToPath(new URL('.', import.meta.url));
const release = 'F:/Axiom/axiom-kiro-long-session-fb7031ed';
const references = 'C:/Users/dane/AppData/Local/Temp/axiom-kiro-rs-research-551521254d8c430680481850c604da97';
const official = 'C:/Users/dane/AppData/Local/Temp/axiom-kiro-catalog-research/amazon-q-developer-cli';
const packages = 'F:/Axiom/axiom2/app/node_modules/@earendil-works';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async path => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
const report = { schemaVersion: 1, scope: 'Read-only source and local artifact fingerprints, not a live model test or a complete dependency closure', nodeVersion: process.version, repositories: [], packages: {}, sources: [], artifacts: [] };
try {
  const repos = [
    ['AXIOM release', release, 'd5d90322661d5d434872de024e014534c9a58c64'],
    ['hank9999', references + '/hank9999', '22f36e692ad387c46581a84daf0d563347e330a3'],
    ['ZyphrZero', references + '/ZyphrZero', '4cac2a8b887eacf4c8119558d3c1906e43f8cbd4'],
    ['official historical CLI', official, '15cc8f3cd18c4272925ce1c7053268eedff1ea0a'],
  ];
  for (const [label, root, expected] of repos) {
    const head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const status = execFileSync('git', ['-C', root, 'status', '--porcelain=v1', '--untracked-files=no'], { encoding: 'utf8' }).trim();
    assert.equal(head, expected); assert.equal(status, '');
    report.repositories.push({ label, root, head, trackedClean: true, headCommandExitCode: 0, statusCommandExitCode: 0, untrackedFilesNotEvaluated: true });
  }
  for (const name of ['pi-ai', 'pi-coding-agent', 'pi-agent-core']) report.packages[name] = (await json(packages + '/' + name + '/package.json')).version;
  const groups = [
    ['AXIOM release', release, ['app/src/server/providers/kiro-chat.ts', 'app/src/server/providers/kiro-chat-protocol.ts', 'app/src/server/providers/kiro-catalog.ts', 'app/src/server/agent-worker.ts', 'app/src/server/model-latency.ts', 'app/src/shared/latency.ts', 'app/src/server/latency.ts', 'app/src/server/index.ts', 'app/tests/fixtures/kiro-eventstream.ts']],
    ['hank9999', references + '/hank9999', ['src/kiro/provider.rs', 'src/kiro/endpoint/mod.rs', 'src/kiro/endpoint/ide.rs', 'src/kiro/token_manager.rs', 'src/model/config.rs', 'src/main.rs']],
    ['ZyphrZero', references + '/ZyphrZero', ['src/kiro/provider.rs', 'src/kiro/endpoint/mod.rs', 'src/kiro/endpoint/cli.rs', 'src/kiro/endpoint/ide.rs', 'src/kiro/model/credentials.rs', 'src/kiro/token_manager.rs', 'src/model/config.rs', 'src/main.rs', 'Cargo.toml']],
    ['official historical CLI', official, ['crates/chat-cli/src/api_client/retry_classifier.rs', 'crates/chat-cli/src/api_client/mod.rs']],
    ['installed Pi', packages, ['pi-ai/dist/utils/retry.js', 'pi-ai/dist/utils/provider-retry.js', 'pi-coding-agent/dist/core/agent-session.js', 'pi-coding-agent/dist/core/settings-manager.js', 'pi-coding-agent/dist/core/sdk.js']],
  ];
  for (const [label, root, paths] of groups) for (const path of paths) report.sources.push({ scope: label, path: root + '/' + path, sha256: sha(await readFile(root + '/' + path)) });
  const probe = await json(out + 'probe-v1.json'), latency = await json(out + 'latency-readonly-v1.json');
  assert.equal(probe.passed, true); assert.equal(probe.scenariosPassed, 9); assert.equal(probe.realNetworkAttempts, 0); assert.equal(probe.socketConnectAttempts, 0);
  for (const [path, expected] of Object.entries(probe.sourceSha256)) assert.equal(sha(await readFile(release + '/app/' + path)), expected);
  assert.equal(sha(await readFile('F:/Axiom/axiom2/test-results/kiro-long-session/sonnet-post429-v4/state.json')), probe.existingRunObservation.sourceStateSha256);
  assert.equal(latency.readOnlyQueryCompleted, true); assert.equal(latency.modelRequestsSent, 0); assert.equal(latency.queries.length, 1); assert.equal(latency.queries[0].matchingRecords, 0);
  assert.equal(Number((await readFile(out + 'probe-v1.exit-code.txt', 'utf8')).trim()), 0);
  assert.equal(Number((await readFile(out + 'latency-readonly-v1.exit-code.txt', 'utf8')).trim()), 0);
  const readme = await readFile(out + 'README.md', 'utf8');
  const sourceLinks = [...readme.matchAll(/^\[[A-Z]\d+\]: (.+)$/gm)].map(m => m[1].trim());
  for (const path of sourceLinks) assert.ok((await stat(path)).isFile());
  for (const name of (await readdir(out)).filter(name => /\.(?:md|mjs|json|log|txt)$/.test(name)).sort()) {
    if (name.startsWith('fingerprint-v1.') && !name.endsWith('.mjs')) continue;
    const bytes = await readFile(out + name); report.artifacts.push({ name, bytes: bytes.length, sha256: sha(bytes) });
  }
  Object.assign(report, { passed: true, referencedSourceLinksChecked: sourceLinks.length, originalPost429StateUnchanged: true, probeSourcesStillMatch: true, realMatrixRerun: false, noGitWriteCommandsUsed: true });
  await writeFile(new URL('fingerprint-v1.json', import.meta.url), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ passed: true, repositories: report.repositories.length, sources: report.sources.length, artifacts: report.artifacts.length, sourceLinks: sourceLinks.length, realMatrixRerun: false }));
} catch (error) {
  report.passed = false; report.failure = { name: error?.name ?? 'Error', code: error?.code ?? null, message: String(error?.message ?? error).slice(0, 1200) };
  await writeFile(new URL('fingerprint-failure-v1.json', import.meta.url), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.error(JSON.stringify(report.failure)); process.exitCode = 1;
}
