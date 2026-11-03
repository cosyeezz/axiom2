import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readModelCredential } from '../../../app/src/server/model-account-storage.js';
for (const k of ['AXIOM_EXECUTION_PROFILE','AXIOM_MODEL_ACCOUNT_BINDINGS','AXIOM_MODEL_MANAGED_ACCOUNTS']) delete process.env[k];
const dir = join(homedir(), '.pi/agent');
try {
  const c = readModelCredential('kiro', join(dir,'auth.json')) as any;
  const p = JSON.parse(readFileSync(join(dir,'models.json'),'utf8')).providers?.kiro;
  console.log(JSON.stringify({oauth: c?.type === 'oauth', authMethod: ['social','builder-id','identity-center'].includes(c?.authMethod) ? c.authMethod : 'unknown', profilePresent: !!c?.profileArn, expired: c?.expires <= Date.now(), proxyMode: p?.axiomProxy?.mode ?? 'direct', explicitBaseUrl: !!p?.baseUrl, api: p?.api === 'kiro-chat' ? 'kiro-chat' : 'other-or-absent', modelIds: p?.models?.map((m:any)=>m.id).filter((id:any)=>typeof id==='string' && /^[a-z0-9._:-]{1,100}$/i.test(id)) ?? []}));
} catch { console.log(JSON.stringify({preflight:'failed'})); process.exitCode=1; }
