import assert from 'node:assert/strict';
import { verifySourceProof } from './native-source-proof.mjs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

// Run after the existing, stricter macOS publisher. No rebuilds, installers, or services.
// Dry run downloads/verifies; --publish uploads only missing identical-content assets.
const REPO = 'cosyeezz/axiom2';
const LIMIT = 256 * 1024 * 1024;
export const CERT = 'ae00055c6143ea3739613150527aed2f91135daab0ab9c8ef0dd2e74872993a2';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function parseSums(text) {
  assert.ok(text.length > 0 && text.length < 65536, 'Invalid checksum size');
  const sums = new Map();
  for (const line of text.trimEnd().split(/\r?\n/)) {
    const m = /^([a-f0-9]{64})  ([\w.-]+)$/.exec(line);
    assert.ok(m && !['.', '..'].includes(m[2]), 'Invalid checksum line');
    assert.ok(!sums.has(m[2]), 'Duplicate checksum name');
    sums.set(m[2], m[1]);
  }
  return sums;
}
export function verifyBinary(bytes, kind) {
  assert.ok(bytes.length > 64 && bytes.length < LIMIT, 'Invalid binary size');
  if (kind === 'exe') {
    assert.equal(bytes.subarray(0, 2).toString(), 'MZ');
    const pe = bytes.readUInt32LE(0x3c);
    assert.ok(pe >= 64 && pe + 6 <= bytes.length);
    assert.equal(bytes.readUInt32LE(pe), 0x4550);
    assert.equal(bytes.readUInt16LE(pe + 4), 0x8664, 'Windows x64 required');
  } else if (kind === 'msi') {
    assert.equal(bytes.subarray(0, 8).toString('hex'), 'd0cf11e0a1b11ae1');
  } else if (kind === 'deb') {
    assert.equal(bytes.subarray(0, 8).toString(), '!<arch>\n');
  } else if (kind === 'x64' || kind === 'arm64') {
    assert.equal(bytes.subarray(0, 4).toString('hex'), '7f454c46');
    assert.equal(bytes[4], 2, 'ELF64 required');
    assert.equal(bytes[5], 1, 'Little-endian ELF required');
    assert.equal(bytes.readUInt16LE(18), kind === 'x64' ? 62 : 183);
  } else if (kind === 'zip') {
    assert.equal(bytes.subarray(0, 4).toString('hex'), '504b0304');
  } else assert.fail('Unknown binary kind');
}
export function verifyAndroid(proof, files, tag, source) {
  assert.match(tag, /^v\d+\.\d+\.\d+$/);
  const version = tag.slice(1);
  const [major, minor, patch] = version.split('.').map(Number);
  const code = major * 1000000 + minor * 1000 + patch;
  assert.ok(minor <= 999 && patch <= 999 && code > 4012 && code <= 2100000000);
  assert.equal(proof.source, source);
  assert.equal(proof.version, version);
  assert.equal(proof.versionCode, code);
  assert.equal(proof.packageName, 'com.axiom2.android');
  assert.equal(proof.minSdk, 26); assert.equal(proof.targetSdk, 35);
  assert.equal(proof.debuggable, false);
  assert.equal(proof.certificateSha256, CERT);
  assert.deepEqual(Object.keys(proof.files).sort(), ['Axiom2-Android.apk', 'axiom2-android-sdk.aar']);
  for (const [name, bytes] of files) {
    assert.equal(proof.files[name]?.size, bytes.length);
    assert.equal(proof.files[name]?.sha256, sha256(bytes));
    verifyBinary(bytes, 'zip');
  }
  assert.equal(files.size, 2);
}
export function verifyRun(run, workflow) {
  assert.equal(run.path, `.github/workflows/${workflow}.yml`);
  assert.equal(run.event, 'workflow_dispatch');
  assert.equal(run.status, 'completed'); assert.equal(run.conclusion, 'success');
  assert.equal(run.repository?.full_name, REPO);
}
export function verifySourceLogs(logs, source, expected) {
  const records = logs.split('\n').filter(line => line.includes('\tRecord source revision\t') && / [a-f0-9]{40}\s*$/.test(line));
  const jobs = records.map(line => line.split('\t')[0]);
  assert.equal(records.length, Array.isArray(expected) ? expected.length : expected, 'Expected source record from every build job');
  assert.equal(new Set(jobs).size, records.length, 'Duplicate job source records');
  if (Array.isArray(expected)) assert.deepEqual([...jobs].sort(), [...expected].sort(), 'Missing build job source');
  assert.ok(records.every(line => line.trimEnd().endsWith(` ${source}`)), 'Artifact source differs from release tag');
}

export function verifySourceJobLog(logs, source, job) {
  assert.match(source, /^[a-f0-9]{40}$/);
  assert.equal(job?.conclusion, 'success', 'Source job must have succeeded');
  const steps = job.steps.filter(step => step.name === 'Record source revision');
  assert.equal(steps.length, 1, 'Expected one structured source step');
  assert.equal(steps[0].conclusion, 'success', 'Source step must have succeeded');
  // Read the job-specific API log, not gh's inferred step labels: gh may emit
  // UNKNOWN STEP for modern archive filenames. Bind the exact command group
  // and its sole output, never any incidental checkout SHA elsewhere in a log.
  const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z /;
  const raw = logs.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  // Other steps may contain multiline input descriptions without timestamps.
  // The source command group and its output must still be runner records.
  const lines = raw.map(line => line.replace(timestamp, ''));
  const groups = lines.flatMap((line, index) => line === '##[group]Run git rev-parse HEAD' ? [index] : []);
  assert.equal(groups.length, 1, 'Expected one exact source command group');
  const start = groups[0];
  assert.match(raw[start], timestamp, 'Expected timestamped source group');
  const end = lines.findIndex((line, index) => index > start && line.startsWith('##[group]'));
  const block = lines.slice(start + 1, end < 0 ? undefined : end);
  const close = block.indexOf('##[endgroup]');
  assert.ok(close >= 0, 'Missing source command header end');
  assert.deepEqual(block.slice(close + 1).filter(Boolean), [source], 'Artifact source command output differs from release tag');
  assert.match(raw[start + close + 2], timestamp, 'Expected timestamped source output');
}

export function selectArtifact(artifacts, name) {
  const matches = artifacts.filter(item => item.name === name);
  assert.equal(matches.length, 1, `Ambiguous or missing artifact in the required run: ${name}`);
  return matches[0];
}

async function boundedFetch(url, options = {}, limit = LIMIT) {
  const response = await fetch(url, { signal: AbortSignal.timeout(180000), ...options });
  if (options.redirect === 'manual') return response;
  assert.equal(response.status, 200, `Download failed: HTTP ${response.status}`);
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length; assert.ok(size <= limit, 'Download exceeded limit'); chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export async function publishClients({ tag, desktopRun, androidRun, macosPublishRun, publish = false }) {
  assert.equal(process.platform, 'win32', 'This controlled publisher uses Windows read-only ZIP/MSI inspection');
  assert.match(tag || '', /^v\d+\.\d+\.\d+$/);
  for (const run of [desktopRun, androidRun, macosPublishRun]) assert.match(run || '', /^\d+$/);
  if (publish) {
    assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Publish through the serialized workflow');
    assert.equal(process.env.AXIOM_PUBLICATION_LOCK, 'axiom-client-publication');
  }
  const gh = (...args) => execFileSync(process.env.AXIOM_GH || 'gh', args, { encoding: 'utf8', timeout: 180000, maxBuffer: 32 * 1024 * 1024 });
  const api = path => JSON.parse(gh('api', `repos/${REPO}/${path}`));
  const source = api(`commits/${tag}`).sha;
  assert.match(source, /^[a-f0-9]{40}$/);
  const release = api(`releases/tags/${tag}`);
  assert.equal(release.draft, false); assert.equal(release.prerelease, false);
  const bookkeeping = asset => /^SHA256SUMS\.(?:previous|next)-[a-f0-9]{64}$/.test(asset.name) && asset.digest === `sha256:${asset.name.slice(-64)}`;
  // A failed rename never destroys the previous manifest. Resume from its exact digest.
  const rootAsset = release.assets.find(item => item.name === 'SHA256SUMS') || release.assets.filter(item => bookkeeping(item) && item.name.startsWith('SHA256SUMS.previous-')).sort((a, b) => b.id - a.id)[0];
  // Publish macOS first with publish-macos.yml: its three native gates are not bypassed.
  assert.ok(release.assets.some(item => item.name === 'Axiom2.dmg'), 'Run the existing native-gated macOS publisher first');
  assert.ok(rootAsset, 'Backend release checksums are required');
  const publicURL = name => `https://github.com/${REPO}/releases/download/${tag}/${name}`;
  const oldSumsBytes = await boundedFetch(publicURL(rootAsset.name), {}, 65536);
  assert.equal(`sha256:${sha256(oldSumsBytes)}`, rootAsset.digest);
  const sums = parseSums(oldSumsBytes.toString('utf8'));
  for (const [name, hash] of sums) assert.equal(release.assets.find(item => item.name === name)?.digest, `sha256:${hash}`);
  assert.ok(sums.has('axiom2.tgz') && sums.has('Axiom2.dmg'), 'Backend and verified macOS checksums required');
  for (const asset of release.assets.filter(item => item.name !== 'SHA256SUMS' && !bookkeeping(item))) {
    assert.match(asset.digest, /^sha256:[a-f0-9]{64}$/);
    if (sums.has(asset.name)) assert.equal(`sha256:${sums.get(asset.name)}`, asset.digest);
    else { assert.match(asset.name, /^[\w.-]+$/); sums.set(asset.name, asset.digest.slice(7)); }
  }
  const desktop = api(`actions/runs/${desktopRun}`), android = api(`actions/runs/${androidRun}`);
  verifyRun(desktop, 'desktop'); verifyRun(android, 'android-release');
  const jobs = api(`actions/runs/${desktopRun}/jobs?per_page=100`).jobs;
  const sourceJobs = jobs.filter(job => job.name.startsWith('desktop (') || job.name.startsWith('linux-desktop ('));
  assert.equal(sourceJobs.length, 4);
  const androidJobs = api(`actions/runs/${androidRun}/jobs?per_page=100`).jobs;
  assert.equal(androidJobs.length, 1, 'Expected the single Android build job');
  assert.equal(androidJobs[0].name, 'android');
  for (const job of [...sourceJobs, ...androidJobs]) {
    assert.ok(Number.isSafeInteger(job.id) && job.id > 0);
    verifySourceJobLog(gh('api', `repos/${REPO}/actions/jobs/${job.id}/logs`), source, job);
  }
  verifyRun(api(`actions/runs/${macosPublishRun}`), 'publish-macos');
  const macPublishJob = api(`actions/runs/${macosPublishRun}/jobs?per_page=100`).jobs.find(job => job.name === 'publish');
  assert.equal(macPublishJob?.steps.find(step => step.name === 'Verify and publish existing macOS build')?.conclusion, 'success');
  const macArtifacts = api(`actions/runs/${macosPublishRun}/artifacts?per_page=100`).artifacts;
  const windows = jobs.find(job => job.name === 'desktop (windows-latest)');
  for (const name of ['Verify native resources', 'Verify independent tool maintenance']) assert.equal(windows?.steps.find(step => step.name === name)?.conclusion, 'success');
  const linux = jobs.filter(job => job.name.startsWith('linux-desktop ('));
  assert.equal(linux.length, 2);
  for (const job of linux) for (const name of ['Verify Linux desktop artifacts', 'Check native supervisor and offline cleanup', 'Verify packaged archive worker without a display']) assert.equal(job.steps.find(step => step.name === name)?.conclusion, 'success');
  const androidJob = androidJobs[0];
  for (const name of ['Verify public versioned source', 'Build and verify production-signed APK and SDK']) assert.equal(androidJob?.steps.find(step => step.name === name)?.conclusion, 'success');
  const desktopArtifacts = api(`actions/runs/${desktopRun}/artifacts?per_page=100`).artifacts;
  const androidArtifacts = api(`actions/runs/${androidRun}/artifacts?per_page=100`).artifacts;
  const directory = await mkdtemp(join(tmpdir(), 'axiom-clients-publish-'));
  const outputs = new Map(), evidence = [];
  const token = process.env.GH_TOKEN || gh('auth', 'token').trim();
  const powershell = (script, env = {}) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { env: { ...process.env, ...env }, encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 });
  try {
    const extract = async (name, expected, runArtifacts) => {
      const item = selectArtifact(runArtifacts, name);
      assert.equal(item.expired, false);
      assert.ok(item.size_in_bytes > 0 && item.size_in_bytes < LIMIT);
      assert.match(item.digest, /^sha256:[a-f0-9]{64}$/);
      const redirect = await boundedFetch(`https://api.github.com/repos/${REPO}/actions/artifacts/${item.id}/zip`, { redirect: 'manual', headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } });
      assert.equal(redirect.status, 302);
      const location = new URL(redirect.headers.get('location'));
      assert.equal(location.protocol, 'https:');
      // Do not forward the API credential to the signed blob URL.
      const bytes = await boundedFetch(location);
      assert.equal(`sha256:${sha256(bytes)}`, item.digest);
      const zip = join(directory, `${item.id}.zip`), destination = join(directory, String(item.id));
      await writeFile(zip, bytes); await mkdir(destination);
      const env = { AXIOM_ZIP: zip, AXIOM_DEST: destination };
      const entries = JSON.parse(powershell("$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[IO.Compression.ZipFile]::OpenRead($env:AXIOM_ZIP); try { $size=0L; $names=@(); foreach($e in $z.Entries){ $size+=$e.Length; if($e.Length -gt 268435456 -or $size -gt 536870912){throw 'Expanded artifact too large'}; $names+=$e.FullName }; ConvertTo-Json -InputObject @($names) -Compress } finally {$z.Dispose()}", env));
      assert.deepEqual(entries.sort(), [...expected].sort(), `Unexpected ZIP entries in ${name}`);
      // Exact basename whitelist is checked before extracting; no paths or symlinks accepted.
      powershell("$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory($env:AXIOM_ZIP,$env:AXIOM_DEST)", env);
      evidence.push({ name, id: item.id, digest: item.digest, entries });
      return destination;
    };
    const add = async (file, name, kind) => {
      assert.ok(/^[\w.-]+$/.test(name) && !outputs.has(name));
      const bytes = await readFile(file); if (kind) verifyBinary(bytes, kind);
      const hash = sha256(bytes), existing = release.assets.find(item => item.name === name);
      if (existing) { assert.equal(existing.digest, `sha256:${hash}`, `Refusing to replace different asset ${name}`); assert.equal(existing.size, bytes.length); }
      if (sums.has(name)) assert.equal(sums.get(name), hash);
      sums.set(name, hash); outputs.set(name, bytes);
    };
    const mac = await extract('Axiom2-macOS-publish-evidence', ['macos-publish.json'], macArtifacts);
    const macProof = JSON.parse(await readFile(join(mac, 'macos-publish.json'), 'utf8'));
    assert.equal(macProof.tag, tag); assert.equal(macProof.source, source); assert.equal(macProof.runId, desktopRun);
    verifySourceProof(macProof.native?.sourceProof, { productSha: source, probeSha: desktop.head_sha, dmg: macProof.dmg });
    assert.equal(release.assets.find(item => item.name === 'Axiom2.dmg')?.digest, `sha256:${macProof.dmg.sha256}`);
    assert.equal(release.assets.find(item => item.name === 'Axiom2.dmg')?.size, macProof.dmg.size);
    for (const [name, id, digest] of [['Axiom2-macOS-universal', macProof.artifactId, macProof.artifactDigest], ['Axiom2-macOS-native-check', macProof.native.artifactId, macProof.native.artifactDigest]]) {
      const artifact = selectArtifact(desktopArtifacts, name);
      assert.equal(artifact?.id, id); assert.equal(artifact?.digest, digest);
    }
    const macJob = jobs.find(job => job.name === 'desktop (macos-latest)');
    for (const name of ['Verify macOS disk image and universal application', 'Smoke test macOS controller window', 'Check macOS single-window WebViews and service lifecycle']) assert.equal(macJob?.steps.find(step => step.name === name)?.conclusion, 'success');
    const win = await extract('Axiom2-Windows-x64', ['Axiom2.exe', 'Axiom2.msi'], desktopArtifacts);
    await add(join(win, 'Axiom2.exe'), 'Axiom2.exe', 'exe');
    await add(join(win, 'Axiom2.msi'), 'Axiom2.msi', 'msi');
    const product = JSON.parse(powershell("$ErrorActionPreference='Stop'; $i=New-Object -ComObject WindowsInstaller.Installer; $d=$null; try {$d=$i.OpenDatabase($env:AXIOM_MSI,0); $values=@{}; foreach($p in @('ProductName','ProductVersion')){$v=$d.OpenView(('SELECT `Value` FROM `Property` WHERE `Property` = '+[char]39+$p+[char]39)); try {$v.Execute();$r=$v.Fetch();try{$values[$p]=$r.StringData(1)}finally{if($r){[void][Runtime.InteropServices.Marshal]::ReleaseComObject($r)}}}finally{$v.Close();[void][Runtime.InteropServices.Marshal]::ReleaseComObject($v)}}; $s=$d.SummaryInformation(0); try {$values['Template']=$s.Property(7)} finally {[void][Runtime.InteropServices.Marshal]::ReleaseComObject($s)}; $values|ConvertTo-Json -Compress }finally{if($d){[void][Runtime.InteropServices.Marshal]::ReleaseComObject($d)};[void][Runtime.InteropServices.Marshal]::ReleaseComObject($i)}", { AXIOM_MSI: join(win, 'Axiom2.msi') }));
    assert.equal(product.ProductName, 'Axiom2'); assert.equal(product.ProductVersion, tag.slice(1));
    assert.equal(product.Template.split(';')[0], 'x64', 'MSI must target x64');
    for (const arch of ['x64', 'arm64']) {
      const path = await extract(`Axiom2-Linux-${arch}`, ['Axiom2-binary', 'Axiom2.deb', 'SHA256SUMS-linux'], desktopArtifacts);
      const linuxSums = parseSums(await readFile(join(path, 'SHA256SUMS-linux'), 'utf8'));
      assert.deepEqual([...linuxSums.keys()].sort(), ['Axiom2-binary', 'Axiom2.deb']);
      for (const [name, hash] of linuxSums) assert.equal(sha256(await readFile(join(path, name))), hash);
      await add(join(path, 'Axiom2-binary'), `Axiom2-Linux-${arch}`, arch);
      await add(join(path, 'Axiom2.deb'), `Axiom2-Linux-${arch}.deb`, 'deb');
    }
    const apk = await extract('Axiom2-Android-release', ['Axiom2-Android.apk', 'axiom2-android-sdk.aar', 'SHA256SUMS.txt', 'android-release.json'], androidArtifacts);
    const files = new Map();
    for (const name of ['Axiom2-Android.apk', 'axiom2-android-sdk.aar']) files.set(name, await readFile(join(apk, name)));
    verifyAndroid(JSON.parse(await readFile(join(apk, 'android-release.json'), 'utf8')), files, tag, source);
    const androidSums = parseSums(await readFile(join(apk, 'SHA256SUMS.txt'), 'utf8'));
    assert.deepEqual([...androidSums.keys()].sort(), [...files.keys()].sort());
    for (const [name, bytes] of files) { assert.equal(androidSums.get(name), sha256(bytes)); await add(join(apk, name), name, 'zip'); }
    await add(join(apk, 'android-release.json'), 'android-release.json');
    assert.equal(api(`commits/${tag}`).sha, source);
    if (!publish) { console.log(JSON.stringify({ verified: true, published: false, tag, source, artifacts: evidence, assets: [...outputs.keys()] })); return; }
    // The macOS publisher has finished. Serialize this one publisher; detect a changed manifest before replacing it.
    for (const [name, bytes] of outputs) if (!release.assets.some(item => item.name === name)) {
      const file = join(directory, name); await writeFile(file, bytes);
      gh('release', 'upload', tag, file, '--repo', REPO);
    }
    const beforeAssets = api(`releases/tags/${tag}`).assets;
    const beforeManifest = beforeAssets.find(item => item.name === 'SHA256SUMS');
    assert.equal(beforeManifest?.id, rootAsset.name === 'SHA256SUMS' ? rootAsset.id : undefined, 'Another publisher changed checksums; rerun to merge');
    if (beforeManifest) assert.equal(beforeManifest.digest, rootAsset.digest);
    const merged = [...sums].sort(([a], [b]) => a.localeCompare(b)).map(([name, hash]) => `${hash}  ${name}\n`).join('');
    if (rootAsset.name !== 'SHA256SUMS' || rootAsset.digest !== `sha256:${sha256(Buffer.from(merged))}`) {
    const nextName = `SHA256SUMS.next-${sha256(Buffer.from(merged))}`;
    let next = beforeAssets.find(item => item.name === nextName);
    if (!next) {
      await writeFile(join(directory, nextName), merged);
      gh('release', 'upload', tag, join(directory, nextName), '--repo', REPO);
      next = api(`releases/tags/${tag}`).assets.find(item => item.name === nextName);
    }
    assert.equal(next?.digest, `sha256:${sha256(Buffer.from(merged))}`);
    const rename = (id, name) => gh('api', '--method', 'PATCH', `repos/${REPO}/releases/assets/${id}`, '-f', `name=${name}`);
    // Shared workflow concurrency serializes both publishers. Two-phase rename keeps a recoverable old copy.
    try {
      if (beforeManifest) rename(rootAsset.id, `SHA256SUMS.previous-${rootAsset.digest.slice(7)}`);
      rename(next.id, 'SHA256SUMS');
    } catch (error) {
      const current = api(`releases/tags/${tag}`).assets;
      if (!current.some(item => item.name === 'SHA256SUMS') && current.some(item => item.id === rootAsset.id && item.digest === rootAsset.digest)) rename(rootAsset.id, 'SHA256SUMS');
      throw error;
    }
    }
    const published = api(`releases/tags/${tag}`);
    for (const asset of release.assets.filter(item => item.name !== 'SHA256SUMS' && !bookkeeping(item))) assert.equal(published.assets.find(item => item.name === asset.name)?.digest, asset.digest);
    assert.equal(api(`commits/${tag}`).sha, source);
    // Anonymous real downloads, including the earlier backend and macOS assets, not API status alone.
    const downloads = [];
    for (const [name, hash] of [...sums, ['SHA256SUMS', sha256(Buffer.from(merged))]]) {
      const asset = published.assets.find(item => item.name === name);
      assert.equal(asset?.digest, `sha256:${hash}`);
      let bytes;
      for (let attempt = 0; ; attempt++) {
        try { bytes = await boundedFetch(publicURL(name)); assert.equal(sha256(bytes), hash); assert.equal(bytes.length, asset.size); break; }
        catch (error) { if (attempt >= 2) throw error; await new Promise(resolve => setTimeout(resolve, 3000)); }
      }
      downloads.push({ name, url: publicURL(name), size: bytes.length, sha256: hash });
    }
    for (const asset of published.assets.filter(bookkeeping)) gh('api', '--method', 'DELETE', `repos/${REPO}/releases/assets/${asset.id}`);
    const proof = { tag, source, desktopRun, androidRun, macosPublishRun, artifacts: evidence, msi: product, downloads };
    await writeFile('clients-publish.json', JSON.stringify(proof, null, 2) + '\n');
    console.log(JSON.stringify(proof));
  } finally { await rm(directory, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await publishClients({ tag: process.env.AXIOM_RELEASE_TAG, desktopRun: process.env.AXIOM_DESKTOP_RUN, androidRun: process.env.AXIOM_ANDROID_RUN, macosPublishRun: process.env.AXIOM_MACOS_PUBLISH_RUN, publish: process.argv.includes('--publish') });
}
