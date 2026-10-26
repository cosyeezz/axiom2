import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { createServer as httpServer } from 'node:http';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
const repo = fileURLToPath(new URL('../../', import.meta.url));
const children = new Map();
async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'fs-')));
  const probe = createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  t.after(async () => {
    for (const running of children.get(root) || []) { if (running.process.exitCode === null && running.process.signalCode === null) running.process.kill(); await running.done; }
    children.delete(root); await rm(root, { recursive: true, force: true });
  });
  return { root, env: { ...process.env, AXIOM_DATA_DIR: root, AXIOM_PORT: String(port), AXIOM_PI_DIR: join(root, 'pi') } };
}
function child(t, args, env, cwd) {
  const process = spawn(globalThis.process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let out = '', err = ''; process.stdout.on('data', bytes => { out += bytes.toString(); }); process.stderr.on('data', bytes => { err += bytes.toString(); });
  const done = new Promise((resolve, reject) => { process.once('error', reject); process.once('close', (code, signal) => resolve({ code, signal, out, err })); });
  const timer = setTimeout(() => process.kill(), 10000);
  t.after(async () => { clearTimeout(timer); if (process.exitCode === null && process.signalCode === null) process.kill(); await done; });
  const running = { process, done };
  const list = children.get(env.AXIOM_DATA_DIR) || []; list.push(running); children.set(env.AXIOM_DATA_DIR, list);
  return running;
}
async function noStartup(root) {
  const db = new DatabaseSync(join(root, 'service-startup.sqlite'));
  try { assert.equal(db.prepare('SELECT count(*) AS n FROM startup').get().n, 0); } finally { db.close(); }
}
test('first foreground launch creates a missing relative data directory before reserving startup', async t => {
  const f = await fixture(t), data = join(f.root, 'fresh', 'data');
  const script = `import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {join} from 'node:path';import {serve} from ${JSON.stringify(pathToFileURL(join(repo, 'bin/service.mjs')).href)};await serve(false,{cli:'fresh-installation',version:'0.4.19',initialize:async({root})=>{assert.equal(root,${JSON.stringify(data)});assert.equal(JSON.parse(await readFile(join(root,'installation.json'),'utf8')).cli,'fresh-installation');return {accessUrl:'http://127.0.0.1/fixture',store:{db:{prepare(){return {all(){return []}}}}},async close(){}}}});`;
  const running = child(t, ['--input-type=module', '--eval', script], { ...f.env, AXIOM_DATA_DIR: join('fresh', 'data') }, f.root);
  await new Promise((resolve, reject) => {
    let output = '';
    running.process.stdout.on('data', bytes => { output += bytes; if (output.includes('Axiom2 已启动')) resolve(); });
    running.done.then(result => reject(Error(`fresh launch exited before readiness: ${JSON.stringify(result)}`)), reject);
  });
  const meta = JSON.parse(await readFile(join(data, 'service-control.json'), 'utf8'));
  const options = { headers: { Authorization: `Bearer ${meta.token}` }, signal: AbortSignal.timeout(2000) };
  const state = await (await fetch(`http://127.0.0.1:${meta.port}/status`, options)).json();
  assert.equal(state.state, 'running'); assert.equal(state.background, false);
  const response = await fetch(`http://127.0.0.1:${meta.port}/stop`, { ...options, method: 'POST', signal: AbortSignal.timeout(2000) });
  assert.equal(response.status, 200);
  const result = await running.done; assert.equal(result.code, 0, result.err); assert.equal(result.signal, null);
  await noStartup(data); await assert.rejects(readFile(join(data, 'service-control.json')), { code: 'ENOENT' });
});
test('a service appearing inside reserve cannot change the prior installation registration', async t => {
  const f = await fixture(t), token = 'a'.repeat(64); let requests = 0;
  const server = httpServer((_req, res) => {
    if (++requests === 1) { res.writeHead(503); res.end(); }
    else { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ instance: token, state: 'running', active: [] })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  await writeFile(join(f.root, 'service-control.json'), JSON.stringify({ token, port: server.address().port }));
  const retained = '{"node":"retained","cli":"retained"}'; await writeFile(join(f.root, 'installation.json'), retained);
  const script = `import assert from 'node:assert/strict';import {serve} from ${JSON.stringify(pathToFileURL(join(repo, 'bin/service.mjs')).href)};await assert.rejects(serve(false,{cli:'replacement',version:'0.4.17',initialize:async()=>{throw Error('must not initialize')}}),/服务已经运行或正在退出/);`;
  const result = await child(t, ['--input-type=module', '--eval', script], f.env).done;
  assert.equal(result.code, 0, result.err); assert.equal(result.signal, null); assert.equal(requests, 2);
  assert.equal(await readFile(join(f.root, 'installation.json'), 'utf8'), retained); await noStartup(f.root);
});
test('descriptor publication failure releases startup without changing installation registration', async t => {
  const f = await fixture(t); await mkdir(join(f.root, 'service-control.json'));
  const retained = '{"node":"retained","cli":"retained"}'; await writeFile(join(f.root, 'installation.json'), retained);
  const script = `import assert from 'node:assert/strict';import {serve} from ${JSON.stringify(pathToFileURL(join(repo, 'bin/service.mjs')).href)};let initialized=false;await assert.rejects(serve(false,{cli:'replacement',version:'0.4.17',initialize:async()=>{initialized=true;throw Error('must not initialize')}}));assert.equal(initialized,false);`;
  const result = await child(t, ['--input-type=module', '--eval', script], f.env).done;
  assert.equal(result.code, 0, result.err); assert.equal(result.signal, null);
  assert.equal(await readFile(join(f.root, 'installation.json'), 'utf8'), retained); await noStartup(f.root);
});
test('bundled foreground entry resolves installed import-only ESM exports without running its legacy launcher', async t => {
  const f = await fixture(t), runtime = join(f.root, 'runtime'); await mkdir(runtime);
  for (const name of ['foreground-service.mjs', 'foreground-artifacts.mjs']) await copyFile(join(repo, 'app/desktop', name), join(runtime, name));
  await copyFile(join(repo, 'bin/service.mjs'), join(runtime, 'service-controller.mjs'));
  const packageRoot = join(f.root, 'service', 'node_modules', '@cosyeezz', 'axiom2');
  await mkdir(join(packageRoot, 'bin'), { recursive: true }); await mkdir(join(packageRoot, 'app/dist/server'), { recursive: true });
  const cli = join(packageRoot, 'bin/axiom2.mjs');
  await writeFile(cli, 'throw Error("the legacy launcher must never execute");');
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ name: '@cosyeezz/axiom2', version: '0.4.17', type: 'module' }));
  await writeFile(join(packageRoot, 'app/dist/server/index.js'), 'export async function startServer(){return {accessUrl:"http://127.0.0.1/fixture",store:{db:{prepare(){return {all(){return []}}}}},async close(){}}}');
  const pi = join(packageRoot, 'node_modules/@earendil-works/pi-coding-agent'); await mkdir(pi, { recursive: true });
  await writeFile(join(pi, 'package.json'), JSON.stringify({ name: '@earendil-works/pi-coding-agent', type: 'module', exports: { '.': { import: './index.js' } } }));
  await writeFile(join(pi, 'index.js'), 'export const getAgentDir=()=>process.env.AXIOM_PI_DIR;');
  await writeFile(join(f.root, 'installation.json'), JSON.stringify({ node: process.execPath, cli }));
  // A package next to the desktop bundle must never override the installed SDK.
  const decoy = join(runtime, 'node_modules/@earendil-works/pi-coding-agent'); await mkdir(decoy, { recursive: true });
  await writeFile(join(decoy, 'package.json'), JSON.stringify({ name: '@earendil-works/pi-coding-agent', type: 'module', exports: { '.': { import: './index.js' } } }));
  await writeFile(join(decoy, 'index.js'), 'throw Error("resolved desktop SDK instead of installed SDK");');
  const running = child(t, ['--experimental-import-meta-resolve', join(runtime, 'foreground-service.mjs'), cli], f.env);
  await new Promise((resolve, reject) => {
    let text = '';
    running.process.stdout.on('data', bytes => { text += bytes.toString(); if (text.includes('Axiom2 已启动')) resolve(); });
    running.done.then(result => reject(Error(`entry exited before readiness: ${JSON.stringify(result)}`)), reject);
  });
  const meta = JSON.parse(await readFile(join(f.root, 'service-control.json'), 'utf8'));
  const response = await fetch(`http://127.0.0.1:${meta.port}/status`, { headers: { Authorization: `Bearer ${meta.token}` }, signal: AbortSignal.timeout(2000) });
  const state = await response.json(); assert.equal(state.state, 'running'); assert.equal(state.version, '0.4.17'); assert.equal(state.background, false);
  assert.equal(JSON.parse(await readFile(join(f.root, 'installation.json'), 'utf8')).cli, cli);
  const stopped = await fetch(`http://127.0.0.1:${meta.port}/stop`, { method: 'POST', headers: { Authorization: `Bearer ${meta.token}` }, signal: AbortSignal.timeout(2000) }); assert.equal(stopped.status, 200);
  const result = await running.done; assert.equal(result.code, 0, result.err); assert.equal(result.signal, null);
  await noStartup(f.root); await assert.rejects(readFile(join(f.root, 'service-control.json')), { code: 'ENOENT' });
});
