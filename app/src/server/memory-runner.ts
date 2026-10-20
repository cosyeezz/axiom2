import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { ChildProcess } from "node:child_process";
import type { Memories, MemoryExecution, MemoryRunner } from "./memories.js";
import type { ModelService } from "./model-service.js";
import type { MemoryWorkerInput } from "./memory-worker.js";
import { AppError } from "../shared/protocol.js";
import { ExecutionPool, type ExecutionLease } from "./execution-pool.js";
import { ExecutionProfiles } from "./execution-profile.js";
import { memoryIncompleteMessages, type MemoryExecutionResult, type MemoryIncompleteReason } from "../shared/memory.js";
import { sameLease } from "./execution-protocol.js";

type Job = { controller: AbortController; provider: string; promise?: Promise<unknown> };
type MemoryReadOptions = { includeImage?: boolean };
type RevisionAwareExecution = MemoryExecution & {
  read: (sessionId: string, path: string, offset?: number, limit?: number, options?: MemoryReadOptions) => ReturnType<MemoryExecution["read"]>;
  revision?: (sessionId: string, path: string) => string;
};
export class PooledMemoryRunner implements MemoryRunner {
  private jobs = new Set<Job>();
  private stopped = false;
  readonly pool: ExecutionPool;
  private readonly profiles: ExecutionProfiles;
  private readonly ownsPool: boolean;
  constructor(private readonly memories: Memories, private readonly models: ModelService, pool?: ExecutionPool, profiles?: ExecutionProfiles) {
    this.ownsPool=!pool;this.pool=pool??new ExecutionPool();this.profiles=profiles??new ExecutionProfiles(memories.store.root);
  }
  execute(input: MemoryExecution) {
    const started=performance.now();
    const job: Job = { controller: new AbortController(), provider: input.selection.provider };
    this.jobs.add(job);
    const promise = this.run(input, job.controller,started).finally(() => this.jobs.delete(job));
    job.promise = promise;
    return promise;
  }
  private async run(input: MemoryExecution, controller: AbortController, requestStartedAtMonoMs:number) {
    if(this.stopped)throw Error("记忆执行器已关闭");
    const preferences = this.memories.preferences();
    const deadlineAt=input.deadlineAt??Date.now()+preferences.timeoutMs;
    const remaining=Math.max(0,deadlineAt-Date.now());
    if (!remaining) throw Error('记忆执行已超时；未返回完整结果');
    const timeout = AbortSignal.timeout(remaining);
    const timeoutError = () => Error(`记忆执行时限已到（${Math.round((input.deadlineAt ? remaining : preferences.timeoutMs) / 1000)} 秒，含排队）；请在记忆设置中提高执行时限后重试`);
    const signal = AbortSignal.any([controller.signal, timeout, ...(input.signal ? [input.signal] : [])]);
    signal.throwIfAborted();
    const cwd = this.memories.store.workspace(input.scope.workspaceId).path;
    const environment=this.profiles.prepare({entry:'memory',cwd,modelDir:this.models.dir,modelsRaw:await this.models.raw(),selection:input.selection,mode:this.pool.mode});
    let lease:ExecutionLease|undefined;
    try {
      lease=await this.pool.acquire({environment,kind:input.kind==='query'?'memory-query':'memory-organize',requestStartedAtMonoMs,signal,deadlineAt,parentLease:input.parentLease,memory:{concurrency:preferences.concurrency,queue:preferences.queue}});
      if(!environment.current())throw Error('记忆模型配置已变化，请重试');
      const child=await lease.ensureReady();
      signal.throwIfAborted();
      if(!environment.current())throw Error('记忆模型配置在准备期间变化，请重试');
      const revisionAware = input as RevisionAwareExecution;
      return await this.observe(child,lease,revisionAware,signal,{executionGate:true,root:this.memories.store.root,cwd,modelsFile:lease.environment.modelsFile,selection:input.selection,prompt:input.prompt,readChars:input.readChars??preferences.readChars,maxTurns:preferences.maxTurns,revisionChecks:typeof revisionAware.revision === "function"});
    } catch(error) {
      if(lease)await this.pool.retire(lease.ref,'memory_failed');
      if(timeout.aborted)throw timeoutError();
      if(signal.aborted)throw Error('记忆执行已取消或超时；未返回完整结果');
      throw error;
    } finally {environment.release();}
  }
  private observe(child:ChildProcess,lease:ExecutionLease,input:RevisionAwareExecution,signal:AbortSignal,start:MemoryWorkerInput):Promise<MemoryExecutionResult> {
    return new Promise((resolve,reject)=>{
      let result:MemoryExecutionResult|undefined,failure:Error|undefined,used=0,settled=false;
      let reap:NodeJS.Timeout|undefined;
      const charges=new Map<string,string>();
      const cleanup=()=>{clearTimeout(reap);signal.removeEventListener('abort',abort);child.removeListener('message',message);child.removeListener('error',error);child.removeListener('close',close);};
      const finish=(err?:Error)=>{if(settled)return;settled=true;cleanup();if(err)reject(err);else resolve(result!);};
      const send=(value:object)=>{try{if(child.connected)child.send({...value,lease:lease.ref},error=>{if(error){failure=Error('记忆工作进程通信失败');void this.pool.retire(lease.ref,'ipc_failed');}});}catch{failure=Error('记忆工作进程通信失败');void this.pool.retire(lease.ref,'ipc_failed');}};
      const abort=()=>{failure=Error('记忆执行已取消或超时；未返回完整结果');send({type:'stop'});void this.pool.retire(lease.ref,'memory_cancel');};
      const error=()=>{failure=Error('记忆工作进程异常');};
      const close=()=>finish(failure??Error('记忆进程未正常完成，未发布结果。'));
      const message=(event:any)=>{
        if(!sameLease(event.lease,lease.ref)||settled)return;
        try {
          // Already incurred usage always belongs to this original lease, including after cancellation.
          if(event.type==='usage'){
            const id=charges.get(event.id)??randomUUID();charges.set(event.id,id);
            this.memories.store.db.prepare('INSERT INTO memory_usage(id,sessionId,kind,provider,model,usage,createdAt) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET provider=excluded.provider,model=excluded.model,usage=excluded.usage')
              .run(id,input.scope.sessionId,input.kind,event.provider,event.model,event.usage?JSON.stringify(event.usage):null,Date.now());
            this.memories.publish(`costs:${input.scope.workspaceId}:${input.scope.sessionId}`,{revision:Date.now()});
          }
          if(signal.aborted)return;
          if(event.type==='read'){
            try{if(used>=start.readChars)throw Error('读取预算已到');const document=input.read(event.sessionId,event.path,event.offset,Math.min(event.limit??16000,start.readChars-used),{includeImage:event.includeImage!==false});used+=document.content.length;
              send({type:'read-result',id:event.id,document:{...document,image:document.image?'图片产物；本次查询未读取图像内容':undefined}});
            }catch(error){send({type:'read-result',id:event.id,error:error instanceof Error?error.message:'读取失败'});}
          }
          if(event.type==='revision'){
            try {
              if (!input.revision) throw Error('记忆执行器未提供轻量修订校验');
              send({type:'revision-result',id:event.id,revision:input.revision(event.sessionId,event.path)});
            } catch(error) { send({type:'revision-result',id:event.id,error:error instanceof Error?error.message:'修订校验失败'}); }
          }
          if(event.type==='completed'){
            if(typeof event.answer!=='string'||!event.answer||event.answer.length>32000||typeof event.incomplete!=='boolean')throw Error('记忆结果无效');
            if(event.incompleteReason !== undefined && (typeof event.incompleteReason !== 'string' || !Object.hasOwn(memoryIncompleteMessages,event.incompleteReason)))throw Error('记忆未完成原因无效');
            result={answer:event.answer,incomplete:event.incomplete,...(event.incompleteReason ? {incompleteReason:event.incompleteReason as MemoryIncompleteReason} : {})};
            reap=setTimeout(()=>{failure=Error('记忆清理未完成');void this.pool.retire(lease.ref,'cleanup_timeout');},1500);
          }
          if(event.type==='failed'){failure=Error(typeof event.error==='string'?event.error:'记忆执行失败');void this.pool.retire(lease.ref,'memory_failed');}
          if(event.type==='cleaned'){
            if(!result||failure||event.clean!==true)throw Error('记忆执行未提供有效清理结果');
            clearTimeout(reap);
            // Single-use mode still waits for actual exit; cross-binding waits for validated cleanup.
            child.removeListener('close',close);
            void this.pool.release(lease.ref,{clean:true,keepSession:false}).then(()=>finish(signal.aborted?Error('记忆执行已取消或超时'):failure)).catch(error=>{void this.pool.retire(lease.ref,'cleanup_failed').then(()=>finish(error));});
          }
        }catch(error){failure=error as Error;void this.pool.retire(lease.ref,'memory_failed');}
      };
      child.on('message',message);child.once('error',error);child.once('close',close);signal.addEventListener('abort',abort,{once:true});
      if(signal.aborted)abort();else send({type:'start',input:start});
    });
  }
  async stopProviders(providers:string[],confirmed:boolean) {
    const affected=[...this.jobs].filter(job=>providers.includes(job.provider));
    if(affected.length&&!confirmed)throw new AppError('ACTIVE_RUNS','该供应商仍有记忆查询或整理执行，需要确认停止');
    for(const job of affected)job.controller.abort();
    await Promise.allSettled(affected.flatMap(job=>job.promise?[job.promise]:[]));
    await this.pool.invalidate(providers);
  }
  async close(){this.stopped=true;for(const job of this.jobs)job.controller.abort();await Promise.allSettled([...this.jobs].flatMap(job=>job.promise?[job.promise]:[]));if(this.ownsPool)await this.pool.close();}
}
// Keep the old constructor export for integrations; it now participates in the physical pool.
export { PooledMemoryRunner as ColdMemoryRunner };
