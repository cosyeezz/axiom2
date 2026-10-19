// Benchmark-only overrides. The frozen production constructor validates every supplied value.
export async function configurePool(pool, args) {
  const names = { 'max-live':'maxLiveProcesses', 'max-idle':'maxIdleRetained', 'ready':'targetReadyTotal', 'max-prewarming':'maxPrewarming', 'idle-ttl':'idleTtlMs', 'max-lifetime':'maxLifetimeMs' };
  const overrides=Object.fromEntries(Object.entries(names).filter(([flag])=>args[flag]!==undefined).map(([flag,key])=>[key,Number(args[flag])]));
  if(Object.keys(overrides).length){
    if(!pool)throw Error('Pool overrides require a pooled production build');
    const validation=new pool.constructor(overrides,pool.mode);
    Object.assign(pool.limits,validation.limits);await validation.close();
  }
  return pool?{...pool.limits}:null;
}
