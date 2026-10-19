// Validate benchmark-only overrides before opening a fixture or starting any workers.
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
export async function loadPoolLimits(build, args) {
  const names = { 'max-live':'maxLiveProcesses', 'max-idle':'maxIdleRetained', 'ready':'targetReadyTotal', 'max-prewarming':'maxPrewarming', 'idle-ttl':'idleTtlMs', 'max-lifetime':'maxLifetimeMs' };
  const overrides=Object.fromEntries(Object.entries(names).filter(([flag])=>args[flag]!==undefined).map(([flag,key])=>[key,Number(args[flag])]));
  if(!Object.keys(overrides).length)return undefined;
  const {ExecutionPool}=await import(pathToFileURL(join(resolve(build),'server','execution-pool.js')).href);
  const validation=new ExecutionPool(overrides,args.mode||'D');
  const limits={...validation.limits};await validation.close();return limits;
}
