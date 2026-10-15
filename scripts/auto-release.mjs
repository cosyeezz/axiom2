import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

export const versionFiles = ['package.json', 'npm-shrinkwrap.json', 'app/package.json', 'app/package-lock.json', 'app/desktop/pake.json'];
const repository = 'cosyeezz/axiom2';
const marker = 'Axiom-Source-Commit: ';
const pattern = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;
const run = (command, args, cwd = process.cwd()) => execFileSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] }).trim();
const git = (...args) => run('git', args);
const gh = (...args) => run('gh', args);
const api = (endpoint) => JSON.parse(gh('api', `repos/${repository}/${endpoint}`));
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const writeJson = (file, data) => writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function compareVersions(a, b) {
  assert.match(a, pattern);
  assert.match(b, pattern);
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

export function nextVersion(base, tags) {
  assert.match(base, pattern, 'Source version must be a stable three-part version');
  const versions = [base, ...tags.filter((tag) => tag.startsWith('v')).map((tag) => tag.slice(1)).filter((version) => pattern.test(version))];
  versions.sort(compareVersions);
  const parts = versions.at(-1).split('.').map(Number);
  parts[2]++;
  const result = parts.join('.');
  assert.match(result, pattern, 'Version exceeds desktop updater limits');
  return result;
}

export function syncVersions(root, version) {
  assert.match(version, pattern);
  for (const file of versionFiles) {
    const path = join(root, file), value = readJson(path);
    if (file.endsWith('pake.json')) value.appVersion = version;
    else {
      value.version = version;
      if (file.endsWith('shrinkwrap.json') || file.endsWith('lock.json')) {
        assert.ok(value.packages?.[''], `Missing root lock entry: ${file}`);
        value.packages[''].version = version;
      }
    }
    writeJson(path, value);
  }
}

export function assertVersions(root, version) {
  for (const file of versionFiles) {
    const value = readJson(join(root, file));
    assert.equal(file.endsWith('pake.json') ? value.appVersion : value.version, version, file);
    if (file.endsWith('shrinkwrap.json') || file.endsWith('lock.json')) assert.equal(value.packages[''].version, version, file);
  }
}

export function assertPackageReceipt(receipt, state, bytes) {
  assert.equal(receipt.version, state.version);
  assert.equal(receipt.commit, state.commit);
  assert.equal(receipt.size, bytes.length);
  assert.ok(bytes.length > 0 && bytes.length <= 128 * 1024 * 1024, 'Package exceeds updater limits');
  assert.equal(receipt.sha256, sha256(bytes), 'Package differs from the validated tarball');
}

export function assertReleaseAssets(release, version, files) {
  assert.equal(release.tag_name, `v${version}`);
  assert.equal(release.prerelease, false);
  for (const [name, bytes] of Object.entries(files)) {
    const matches = release.assets.filter((asset) => asset.name === name);
    assert.equal(matches.length, 1, `Expected exactly one ${name}`);
    const asset = matches[0];
    assert.equal(asset.state, 'uploaded');
    assert.equal(asset.size, bytes.length, `${name}: size mismatch`);
    assert.equal(asset.digest, `sha256:${sha256(bytes)}`, `${name}: digest mismatch`);
    const expected = `https://github.com/${repository}/releases/download/v${version}/${name}`;
    if (release.draft === true && asset.browser_download_url !== expected) {
      // GitHub assigns temporary untagged URLs until a draft becomes public.
      const url = new URL(asset.browser_download_url);
      assert.equal(url.origin, 'https://github.com');
      assert.equal(url.username + url.password + url.search + url.hash, '');
      const prefix = `/${repository}/releases/download/`;
      assert.ok(url.pathname.startsWith(prefix));
      const parts = url.pathname.slice(prefix.length).split('/');
      assert.equal(parts.length, 2);
      assert.match(parts[0], /^untagged-[a-f0-9]+$/);
      assert.equal(parts[1], name);
    } else assert.equal(asset.browser_download_url, expected);
  }
}

function sourceIsCurrent(source) {
  return api('branches/master').commit.sha === source;
}
function releases() {
  return JSON.parse(gh('api', '--paginate', '--slurp', `repos/${repository}/releases?per_page=100`)).flat();
}
function sourceLine(source) { return `${marker}${source}`; }
function hasSource(body, source) { return String(body || '').split(/\r?\n/).includes(sourceLine(source)); }
export function verifyTag(tag, source, root = process.cwd()) {
  const git = (...args) => run('git', args, root);
  assert.equal(git('rev-list', '--parents', '-n', '1', tag).split(' ').length, 2, 'Release commit must have exactly one parent');
  assert.equal(git('rev-parse', `${tag}^`), source, 'Release commit must directly descend from the validated source');
  assert.ok(hasSource(git('show', '-s', '--format=%B', tag), source), 'Release tag has different provenance');
  const changed = git('diff-tree', '--no-commit-id', '--name-only', '-r', tag).split('\n').filter(Boolean);
  assert.deepEqual(changed.sort(), [...versionFiles].sort(), 'Release commit must only synchronize version manifests');
  for (const file of versionFiles) {
    const before = JSON.parse(git('show', `${source}:${file}`));
    const after = JSON.parse(git('show', `${tag}:${file}`));
    assert.equal(file.endsWith('pake.json') ? after.appVersion : after.version, tag.slice(1), file);
    if (file.endsWith('shrinkwrap.json') || file.endsWith('lock.json')) assert.equal(after.packages[''].version, tag.slice(1), file);
    if (file.endsWith('pake.json')) after.appVersion = before.appVersion;
    else {
      after.version = before.version;
      if (file.endsWith('shrinkwrap.json') || file.endsWith('lock.json')) after.packages[''].version = before.packages[''].version;
    }
    assert.deepEqual(after, before, `${file}: release commit changed fields other than versions`);
  }
}
function output(state, path) {
  writeJson(path, state);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `publish=${!state.skip}\n`);
  console.log(JSON.stringify(state));
}

export async function verifyPublicRelease(release, fetcher = fetch, expectedPackageHash) {
  assert.equal(release.draft, false);
  assert.equal(release.prerelease, false);
  assert.match(release.tag_name, /^v(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/);
  const downloaded = {};
  for (const name of ['axiom2.tgz', 'SHA256SUMS']) {
    const matches = release.assets.filter((asset) => asset.name === name);
    assert.equal(matches.length, 1, `Expected exactly one ${name}`);
    const asset = matches[0];
    assert.equal(asset.state, 'uploaded');
    assert.ok(Number.isInteger(asset.size) && asset.size > 0 && asset.size <= 128 * 1024 * 1024);
    assert.match(asset.digest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(asset.browser_download_url, `https://github.com/${repository}/releases/download/${release.tag_name}/${name}`);
    const response = await fetcher(asset.browser_download_url, { signal: AbortSignal.timeout(60_000) });
    assert.equal(response.status, 200, `${name}: public download failed`);
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      assert.ok(size <= asset.size, `${name}: download exceeds declared size`);
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    assert.equal(bytes.length, asset.size);
    assert.equal(`sha256:${sha256(bytes)}`, asset.digest);
    downloaded[name] = bytes;
  }
  const hash = sha256(downloaded['axiom2.tgz']);
  if (expectedPackageHash) assert.equal(hash, expectedPackageHash);
  // A later desktop publication may legitimately extend the checksum file.
  const entries = downloaded.SHA256SUMS.toString('utf8').split(/\r?\n/).filter((line) => /^[a-f0-9]{64}  axiom2\.tgz$/.test(line));
  assert.deepEqual(entries, [`${hash}  axiom2.tgz`]);
}

export async function verifyWithRetry(readRelease, verify, pause = () => delay(2000)) {
  for (let attempt = 0; ; attempt++) {
    try {
      const release = await readRelease();
      await verify(release);
      return release;
    } catch (error) {
      if (attempt === 5) throw error;
      await pause();
    }
  }
}

const verifyPublished = (release, expectedHash) => verifyWithRetry(
  () => api(`releases/${release.id}`),
  (fresh) => verifyPublicRelease(fresh, fetch, expectedHash),
);

export function existingReleaseStatus(release, source, commit) {
  if (!release) return 'missing';
  assert.ok(hasSource(release.body, source), 'Existing release has different provenance');
  assert.equal(release.target_commitish, commit);
  assert.equal(release.prerelease, false);
  return release.draft ? 'draft' : 'published';
}

export async function prepare(stateFile) {
  assert.equal(process.env.GITHUB_REPOSITORY, repository);
  assert.equal(process.env.GITHUB_REF, 'refs/heads/master');
  const source = process.env.GITHUB_SHA;
  assert.match(source || '', /^[a-f0-9]{40}$/);
  assert.equal(git('rev-parse', 'HEAD'), source);
  assert.equal(git('status', '--porcelain'), '', 'Release checkout must be clean');
  if (!sourceIsCurrent(source)) return output({ skip: true, reason: 'master has advanced', source }, stateFile);
  const published = releases();
  const tags = git('tag', '--list', 'v*').split('\n').filter(Boolean);
  const matching = tags.filter((tag) => pattern.test(tag.slice(1)) && hasSource(git('show', '-s', '--format=%B', tag), source));
  assert.ok(matching.length <= 1, 'Multiple release tags refer to this source');
  let tag = matching[0], version;
  if (tag) {
    verifyTag(tag, source);
    const existing = published.find((release) => release.tag_name === tag);
    if (existingReleaseStatus(existing, source, git('rev-parse', `${tag}^{commit}`)) === 'published') {
      await verifyPublished(existing);
      return output({ skip: true, reason: 'already published and verified', source, tag }, stateFile);
    }
    git('checkout', '--detach', tag);
    version = tag.slice(1);
  } else {
    assert.ok(!published.some((release) => hasSource(release.body, source)), 'Release exists without its expected source tag');
    version = nextVersion(readJson('package.json').version, [...tags, ...published.map((release) => release.tag_name)]);
    tag = `v${version}`;
    syncVersions(process.cwd(), version);
    git('add', '--', ...versionFiles);
    git('-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com', '-c', 'commit.gpgsign=false', 'commit', '-m', `chore(release): backend ${version}\n\n${sourceLine(source)}`);
    git('tag', tag);
  }
  assertVersions(process.cwd(), version);
  output({ skip: false, source, tag, version, commit: git('rev-parse', 'HEAD') }, stateFile);
}

export async function publish(stateFile, directory) {
  assert.equal(process.env.GITHUB_REPOSITORY, repository);
  const state = readJson(stateFile);
  if (state.skip) return;
  const { source, tag, version, commit } = state;
  assert.match(source, /^[a-f0-9]{40}$/);
  assert.match(version, pattern);
  assert.equal(tag, `v${version}`);
  assert.equal(git('rev-parse', 'HEAD'), commit);
  assert.equal(git('status', '--porcelain'), '');
  verifyTag(tag, source);
  assertVersions(process.cwd(), version);
  if (!sourceIsCurrent(source)) { console.log('Skip publication: master has advanced.'); return; }
  // Upload the exact bytes exercised by check:package, without repacking after validation.
  const archive = join(directory, 'axiom2.tgz'), sums = join(directory, 'SHA256SUMS');
  const bytes = readFileSync(archive);
  assertPackageReceipt(readJson(join(directory, 'package-validation.json')), state, bytes);
  writeFileSync(sums, `${sha256(bytes)}  axiom2.tgz\n`);
  const files = { 'axiom2.tgz': bytes, SHA256SUMS: readFileSync(sums) };
  git('push', 'origin', `refs/tags/${tag}:refs/tags/${tag}`);
  let release = releases().find((item) => item.tag_name === tag);
  if (release) {
    if (existingReleaseStatus(release, source, commit) === 'published') {
      await verifyPublished(release);
      console.log(`Already published and verified: ${release.html_url}`);
      return;
    }
    assert.ok(release.assets.every((asset) => Object.hasOwn(files, asset.name)), 'Draft contains unexpected assets; refusing to replace checksums');
  } else {
    const notes = join(directory, 'release-notes.md');
    writeFileSync(notes, `后台自动更新包，来自 master 提交 [${source.slice(0, 7)}](https://github.com/${repository}/commit/${source})。\n\n三平台、两组 Node.js 版本的 CI 已通过；发布版本另外通过安装、升级与失败恢复检查。\n\n在桌面服务控制页点击「检查更新」，再选择「更新后台服务」。本次不包含桌面客户端安装包，已有客户端可继续使用。新设备的桌面客户端下载见 [README](https://github.com/${repository}/blob/master/README.md#一行安装与客户端下载)。\n\n${sourceLine(source)}\n`);
    // Use the creation response: release-list reads can briefly omit a newly created draft.
    const request = join(directory, 'release-request.json');
    writeJson(request, { tag_name: tag, target_commitish: commit, name: `Axiom2 ${tag}`, body: readFileSync(notes, 'utf8'), draft: true, prerelease: false });
    release = JSON.parse(gh('api', '--method', 'POST', `repos/${repository}/releases`, '--input', request));
  }
  assert.equal(existingReleaseStatus(release, source, commit), 'draft');
  assert.equal(release.tag_name, tag);
  gh('release', 'upload', tag, archive, sums, '--clobber', '--repo', repository);
  release = await verifyWithRetry(() => api(`releases/${release.id}`), (fresh) => assertReleaseAssets(fresh, version, files));
  // Do not let an older run make itself Latest after a newer push or manual release.
  if (!sourceIsCurrent(source)) { console.log(`Keep ${tag} as draft: master has advanced.`); return; }
  const newerRelease = releases().find((item) => !item.draft && !item.prerelease && /^v/.test(item.tag_name) && pattern.test(item.tag_name.slice(1)) && compareVersions(item.tag_name.slice(1), version) > 0);
  assert.ok(!newerRelease, 'A newer release is already published; refusing to move Latest backwards');
  gh('release', 'edit', tag, '--repo', repository, '--draft=false', '--latest');
  const latest = await verifyWithRetry(() => api('releases/latest'), async (fresh) => {
    assert.equal(fresh.tag_name, tag);
    await verifyPublicRelease(fresh, fetch, sha256(bytes));
  });
  console.log(`Published and verified: ${latest.html_url}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Published [${tag}](${latest.html_url}) from \`${source}\`. Package and checksum downloads verified.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [action, stateFile, directory] = process.argv.slice(2);
  assert.ok(stateFile, 'Usage: node scripts/auto-release.mjs prepare|publish STATE_FILE [ARTIFACT_DIRECTORY]');
  if (action === 'prepare') await prepare(resolve(stateFile));
  else if (action === 'publish') { assert.ok(directory); await publish(resolve(stateFile), resolve(directory)); }
  else throw Error(`Unknown action: ${action}`);
}
