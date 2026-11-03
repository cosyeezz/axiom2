import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fetchKiroCatalog } from '../../../app/src/native-providers/kiro/catalog.js';
import { readModelCredential } from '../../../app/src/server/model-account-storage.js';
import { getGlobalDispatcher } from '../../../app/node_modules/undici/index.js';
const dir = new URL('./', import.meta.url);
const project = (text:string) => ({profileRequired: /profileArn is required/i.test(text)});
async function main() {
  if (!project('{"message":"profileArn is required for this request."}').profileRequired || project('secret').profileRequired) throw Error('SELFTEST');
  if (process.argv[2] !== '--live') { console.log('selftest passed'); return; }
  for (const k of ['AXIOM_EXECUTION_PROFILE','AXIOM_MODEL_ACCOUNT_BINDINGS','AXIOM_MODEL_MANAGED_ACCOUNTS']) delete process.env[k];
  writeFileSync(new URL('baseline.claim',dir),'consumed\n',{flag:'wx',mode:0o600});
  const report:any = {requests:0,status:0,profileRequired:false,success:false};
  try {
    const account = readModelCredential('kiro',join(homedir(),'.pi/agent/auth.json'));
    const models = await fetchKiroCatalog(account,AbortSignal.timeout(15000),async (input,init) => {
      if (report.requests++ >= 1 || new URL(String(input)).hostname !== 'q.us-east-1.amazonaws.com' || new Headers(init?.headers).get('x-amz-target') !== 'AmazonCodeWhispererService.ListAvailableModels') throw Error('BUDGET');
      const res = await fetch(input,init); report.status=res.status;
      if (!res.ok) { const reader=res.clone().body!.getReader(); let size=0,text=''; try { for (;;) {const v=await reader.read(); if(v.done)break;size+=v.value.length;if(size>16384)break;text+=new TextDecoder().decode(v.value);} Object.assign(report,project(text)); } finally {void reader.cancel();} }
      return res;
    });
    report.success=true;report.models=models.length;
  } catch { report.failure='catalog-failed'; }
  finally { await getGlobalDispatcher().close(); report.dispatcherClosed=true; writeFileSync(new URL('baseline.json',dir),JSON.stringify(report,null,2)+'\n',{flag:'wx'}); }
  console.log(JSON.stringify(report));
}
main().catch(()=>{console.log('harness-failed');process.exitCode=1;});
