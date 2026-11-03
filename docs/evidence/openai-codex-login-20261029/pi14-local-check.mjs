// Read-only package resolution and source-shape check. Does not import or run Pi.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const app = '/Volumes/D_Work/axiom2/app';
const global = '/Users/dane/.local/share/pi-node/node-v22.23.2-darwin-arm64/lib/node_modules/@earendil-works/pi-coding-agent';
const sha256 = value => createHash('sha256').update(value).digest('hex');
function resolvePackage(entry, name) {
  const resolved = fileURLToPath(import.meta.resolve(name, pathToFileURL(entry).href));
  for (let root = dirname(resolved); root !== dirname(root); root = dirname(root)) {
    const manifest = join(root, 'package.json');
    if (!existsSync(manifest)) continue;
    const bytes = readFileSync(manifest), meta = JSON.parse(bytes);
    if (meta.name === name) return { entry, name, resolved, root, manifest, version: meta.version, manifestSha256: sha256(bytes) };
  }
  throw Error(`No owning manifest for ${name}`);
}
const resolutions = [];
for (const entry of [join(app, 'dist/server/agent-worker.js'), join(global, 'dist/bundle/cli.js')]) {
  for (const name of ['@earendil-works/pi-ai', '@earendil-works/pi-coding-agent']) resolutions.push(resolvePackage(entry, name));
}
for (const row of resolutions) assert.equal(row.version, row.entry.startsWith(app) ? '1.1.0' : '1.4.0');
const ai = resolutions.find(r => r.version === '1.4.0' && r.name.endsWith('/pi-ai')).root;
const snippets = [];
function inspect(relative, start, end, predicates) {
  const path = join(ai, relative), bytes = readFileSync(path), text = bytes.toString();
  for (const predicate of predicates) assert.ok(predicate(text), path);
  snippets.push({ path, sha256: sha256(bytes), lines: text.split('\n').length, excerptStart: start, excerptEnd: end, excerpt: text.split('\n').slice(start - 1, end).join('\n') });
}
inspect('dist/api/openai-responses.js', 128, 162, [s => s.includes('client.responses.create(params, requestOptions).withResponse()'), s => !/WebSocket|websocket/.test(s), s => s.includes('stream: true')]);
inspect('dist/api/openai-codex-responses.js', 184, 202, [s => s.includes('const transport = options?.transport || "auto"'), s => s.includes('await processWebSocketStream('), s => s.includes('previous_response_id: continuation.lastResponseId')]);
inspect('dist/api/openai-codex-responses.js', 1153, 1193, [s => s.includes('const useCachedContext = options?.transport === "websocket-cached" || options?.transport === "auto"')]);
const workerSource = readFileSync(join(app, 'dist/server/agent-worker.js'), 'utf8');
assert.ok(workerSource.includes('from "@earendil-works/pi-coding-agent"'));
assert.ok(workerSource.includes('from "@earendil-works/pi-ai"'));
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), mode: 'read-only static source and ESM resolution; no SDK execution or credential access', piExecutable: realpathSync('/Users/dane/.local/share/pi-node/node-v22.23.2-darwin-arm64/bin/pi'), resolutions, workerUsesExternalPiImports: true, conclusions: { globalPiVersion: '1.4.0', axiomWorkerResolvedPiVersion: '1.1.0', pi14OpenAIDirectTransport: 'HTTP/SSE, no WebSocket branch', pi14CodexDefaultTransport: 'auto: WebSocket first, conditional SSE fallback', pi14CodexContinuation: 'previous_response_id plus delta when matching same-connection state' }, snippets, networkCalls: 0, assertions: 'passed' }, null, 2));
