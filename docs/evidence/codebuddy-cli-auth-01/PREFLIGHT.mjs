// Read-only metadata projection. No token output, resolving helpers, or network.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import childProcess from 'node:child_process';
let deniedCalls = 0;
const deny = () => { deniedCalls++; throw new Error('PREFLIGHT_IO_FORBIDDEN'); };
globalThis.fetch = deny;
http.request = http.get = https.request = https.get = deny;
net.Socket.prototype.connect = deny;
for (const key of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) childProcess[key] = deny;
syncBuiltinESMExports();
try {
  const repo = fileURLToPath(new URL('../../../', import.meta.url));
  const dir = process.env.AXIOM_PI_DIR;
  assert.ok(dir && resolve(dir) === dir, 'AUTH_ROOT_REQUIRED');
  // This child follows the current account selection, not this AI worker's snapshot.
  delete process.env.AXIOM_EXECUTION_PROFILE;
  delete process.env.AXIOM_MODEL_ACCOUNT_BINDINGS;
  const { readModelCredential, selectedAuthPath } = await import(pathToFileURL(join(repo, 'app/dist/server/model-account-storage.js')).href);
  const provider = 'codebuddy-cn';
  const authPath = join(dir, 'auth.json');
  const selected = selectedAuthPath(provider, authPath);
  const paths = [selected, join(dir, 'model-accounts/index.json'), join(dir, 'models.json')];
  const read = path => existsSync(path) ? readFileSync(path) : undefined;
  const before = paths.map(read);
  const credential = readModelCredential(provider, authPath);
  const oauth = credential?.type === 'oauth';
  const validExpiry = oauth && Number.isFinite(credential.expires);
  const unchanged = paths.every((path, i) => {
    const current = read(path);
    return before[i] === undefined ? current === undefined : current !== undefined && before[i].equals(current);
  });
  assert.ok(unchanged);
  assert.equal(deniedCalls, 0);
  console.log(JSON.stringify({
    phase: 'metadata-only', passed: true, provider,
    present: !!credential, type: credential?.type === 'oauth' ? 'oauth' : credential?.type === 'api_key' ? 'api_key' : 'absent-or-unsupported',
    accessPresent: oauth && typeof credential.access === 'string' && credential.access.length > 0,
    refreshPresent: oauth && typeof credential.refresh === 'string' && credential.refresh.length > 0,
    expiryKnown: !!validExpiry, expired: validExpiry ? credential.expires <= Date.now() : null,
    refreshNeededWithinFiveMinutes: validExpiry ? credential.expires <= Date.now() + 300000 : null,
    selectedAccountRoute: selected !== authPath, storedFilesUnchanged: unchanged,
    deniedNetworkOrProcessCalls: deniedCalls,
    limits: ['Local presence/expiry metadata only; not server validity or official CLI authentication'],
  }, null, 2));
} catch {
  console.log(JSON.stringify({ phase: 'metadata-only', passed: false, code: 'PREFLIGHT_FAILED', deniedNetworkOrProcessCalls: deniedCalls }));
  process.exitCode = 1;
}
