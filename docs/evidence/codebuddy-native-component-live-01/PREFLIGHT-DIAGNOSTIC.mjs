import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { Socket } from 'node:net';

// One read-only metadata diagnostic. No model/auth network and no raw exceptions.
const output = join(dirname(fileURLToPath(import.meta.url)), 'preflight-diagnostic-01.json');
let stage = 'bindings', runtime, attempts = 0, result;
const oldFetch = globalThis.fetch, oldConnect = Socket.prototype.connect;
const deny = () => { attempts++; throw Error('Blocked'); };
globalThis.fetch = deny; Socket.prototype.connect = deny;
try {
  for (const key of ['AXIOM_EXECUTION_PROFILE', 'AXIOM_MODEL_ACCOUNT_BINDINGS', 'AXIOM_MODEL_MANAGED_ACCOUNTS', 'AXIOM_EXECUTION_INSTANCE', 'AXIOM_EXECUTION_GENERATION']) delete process.env[key];
  const root = process.env.AXIOM_PI_DIR || join(homedir(), '.pi/agent');
  const authPath = join(root, 'auth.json'), modelsPath = join(root, 'models.json');
  stage = 'imports';
  const m = await import('../../../app/dist/server/model-runtime.js');
  const account = await import('../../../app/dist/server/model-account-storage.js');
  const observer = await import('../../../app/dist/server/provider-request-observer.js');
  const sender = await import('../../../app/dist/native-providers/codebuddy/http.js');
  stage = 'config-snapshot'; const config = existsSync(modelsPath) ? readFileSync(modelsPath, 'utf8') : undefined;
  stage = 'runtime-metadata';
  runtime = await m.createModelRuntime({ modelsPath, authPath, providerScope: 'codebuddy-cn', metadataOnly: true, refreshOnCreate: false, allowModelNetwork: false });
  stage = 'model-selection'; const model = runtime.getModel('codebuddy-cn', 'deepseek-v4.1-flash');
  const native = !!model && observer.providerRequestDefaultTransport(runtime, model) === sender.codeBuddyNativeFetch;
  stage = 'normal-credential-route'; const credential = account.readModelCredential('codebuddy-cn', authPath);
  stage = 'proxy-config'; const network = await import('../../../app/dist/server/integrations/model-proxy-env.js');
  const proxyMode = network.readProviderProxy(modelsPath, 'codebuddy-cn').mode;
  stage = 'config-check'; const unchanged = config === (existsSync(modelsPath) ? readFileSync(modelsPath, 'utf8') : undefined);
  result = { passed: native && unchanged && !runtime.getError() && credential?.type === 'oauth' && attempts === 0, stage, native, unchanged, oauth: credential?.type === 'oauth', proxyMode };
} catch (error) {
  result = { passed: false, stage, kind: error instanceof TypeError ? 'TypeError' : error instanceof SyntaxError ? 'SyntaxError' : 'Other',
    code: ['ENOENT', 'EACCES', 'EPERM'].includes(error?.code) ? error.code : undefined };
} finally {
  try { runtime?.getRegisteredNativeProvider('codebuddy-cn')?.dispose(); } catch { result.disposeFailed = true; }
  globalThis.fetch = oldFetch; Socket.prototype.connect = oldConnect;
}
result.networkAttempts = attempts;
writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify(result)); if (!result.passed) process.exitCode = 1;
