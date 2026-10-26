// Identical measurement preload for every benchmark build; never loaded by the product.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
if (process.env.AXIOM_BENCH_PROBE && process.send) {
  let peakRSS=0, ticks=0;
  const probeId=randomUUID(),file=join(process.env.AXIOM_BENCH_PROBE,`${process.pid}-${probeId}.json`);
  const save=(exited=false)=>{try{const usage=process.resourceUsage(),cpu=process.cpuUsage();peakRSS=Math.max(peakRSS,process.memoryUsage().rss);writeFileSync(file,JSON.stringify({probeId,pid:process.pid,observedAt:Date.now(),exited,cpuMs:(cpu.user+cpu.system)/1000,maxRSSBytes:usage.maxRSS*1024,sampledPeakRSS:peakRSS,lastRSS:process.memoryUsage().rss,activeNodeHandles:process._getActiveHandles().length,ticks}));}catch{}};
  const interval=setInterval(()=>{ticks++;save();},100);interval.unref();
  process.on('exit',()=>save(true));process.on('beforeExit',()=>save());process.on('message',()=>save());save();
}
