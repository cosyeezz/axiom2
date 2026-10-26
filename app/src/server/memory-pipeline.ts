import { basename, relative } from "node:path";
import type { Memories, MemoryExecution, MemoryReadAccess } from "./memories.js";
import { MemoryTreeStore, type QueuedPurpose, type OrganizationClaim } from "./memory-tree.js";
import { organizationJSON } from "./memory-organization-state.js";
import { memoryDirectory, referencedPaths } from "./memory-files.js";
import { memoryOrganizerPrompt, memoryMatchPrompt, memoryAnswerPrompt } from "../shared/memory-prompts.js";
import { projectMemoryTree } from "../shared/memory-query-projection.js";
import { uniqueMemoryDocuments } from "../shared/memory-directory.js";
import { memoryOrganizationWatermarks, memoryOrganizationOutputChars, type MemoryPurpose, type MemoryDocumentRef, type MemoryIndexNode } from "../shared/memory-tree.js";
import { AppError, type Scope } from "../shared/protocol.js";
import { type MemoryDocument, type MemoryQueryResult } from "../shared/memory.js";
import { memoryPurposes } from "../shared/memory-purposes.js";
import { locateMemoryPurpose } from "../shared/memory-purpose-locator.js";
import type { Selection } from "../shared/agent.js";
import type { LeaseRef } from "./execution-protocol.js";

export class MemoryPipeline {
  readonly tree: MemoryTreeStore;
  constructor(private memories: Memories) {
    this.tree = new MemoryTreeStore(memories.store, (_workspaceId, purposes) => {
      const { organizerModel, timeoutMs, readChars } = memories.preferences();
      const pending = purposes.find(purpose => memories.store.db.prepare("SELECT 1 FROM memory_purposes WHERE id=? AND processedAt IS NULL").get(purpose.id));
      const row = pending && memories.store.db.prepare("SELECT selection FROM agent_sessions WHERE sessionId=?").get(pending.source.sessionId);
      const selection: Selection | undefined = organizerModel ?? (row?.selection ? JSON.parse(String(row.selection)) : undefined);
      return organizationJSON([selection, timeoutMs, readChars, memories.runner?.configurationKey?.(selection) ?? ""]);
    });
  }
  private full(scope: Scope, path: string, signal?: AbortSignal): MemoryDocument & { access: MemoryReadAccess } {
    let content = "", offset = 0, first: MemoryDocument | undefined, access: MemoryReadAccess | undefined;
    do {
      signal?.throwIfAborted();
      const page = this.memories.read(scope, path, offset, 16000, { includeImage: false });
      if (page.image || page.content === "图片产物") throw new AppError("MEMORY_READ_FAILED", "记忆查询只读取文本资料");
      const pageAccess = this.memories.readAccessFor(page);
      if (first && (page.revision !== first.revision || pageAccess.actual !== access!.actual || pageAccess.external !== access!.external))
        throw new AppError("REVISION_CONFLICT", "资料读取期间正文或实际路径已变化");
      first ??= page; access ??= pageAccess; content += page.content;
      if (page.nextOffset === null) break;
      offset = page.nextOffset;
    } while (true);
    return { ...first!, content, offset: 0, nextOffset: null, access: access! };
  }
  private verify(scope: Scope, documents: Array<MemoryDocument & { sessionId: string; access: MemoryReadAccess }>, refs: MemoryDocumentRef[]) {
    this.memories.owner(scope);
    const live = new Set(this.tree.entries(scope.workspaceId).filter(purpose => !purpose.blocked && purpose.processedAt !== null).map(purpose => purpose.id));
    const currentReferences = new Map(this.tree.nodes.documentReferences(scope.workspaceId).map(ref => [JSON.stringify([ref.sessionId, ref.path]), ref]));
    const actualBindings = documents.flatMap(document => currentReferences.get(JSON.stringify([document.sessionId, document.path])) ?? []);
    if ([...refs, ...actualBindings].some(ref => !ref.purposeIds.some(id => live.has(id))))
      throw new AppError("MEMORY_LOCATOR_INVALID", "资料来源已撤销，结果未发布");
    const corrections = this.memories.store.db.prepare("SELECT target FROM memory_corrections WHERE workspaceId=?").all(scope.workspaceId);
    for (const document of documents) {
      this.memories.verifyReadAccess({ workspaceId: scope.workspaceId, sessionId: document.sessionId }, document.path, document.access);
      if (corrections.some(row => document.content.includes(String(row.target))))
        throw new AppError("MEMORY_CORRECTION_PENDING", "资料已被明确否定，结果未发布");
    }
  }
  private locate(purpose: MemoryPurpose, document: MemoryDocument, peers: readonly MemoryPurpose[]) {
    const headings = memoryPurposes(document.content);
    const found = locateMemoryPurpose(purpose, headings, peers);
    if (!found || !found.complete)
      throw new AppError("MEMORY_LOCATOR_INVALID", "原目的定位已失效；不能猜测来源或使用旧目录回答");
    return found;
  }
  private async execute(input: Omit<MemoryExecution, "read">, stage: string, candidates?: ReturnType<typeof projectMemoryTree>["bindings"]) {
    const id = input.processingId;
    // Bindings are audit data only, never part of the model input or worker request.
    const callId = id ? this.memories.records.callStart(id, stage, { systemPrompt: input.systemPrompt, prompt: input.prompt,
      ...(candidates ? { candidateBindings: candidates } : {}) }, input.selection) : undefined;
    try {
      if (!this.memories.runner) throw new AppError("MEMORY_UNAVAILABLE", "记忆执行器不可用");
      const result = await this.memories.runner.execute({ ...input, processingCallId: callId, read: () => { throw Error("分类与查询模型不提供任意文件读取工具"); } });
      if (id && callId) this.memories.records.callFinish(id, callId, result.answer, result.incomplete ? "模型返回不完整" : undefined);
      return result;
    } catch (error) { if (id && callId) this.memories.records.callFinish(id, callId, undefined, error); throw error; }
  }
  startOrganization(batch: QueuedPurpose[]) {
    const scope = { workspaceId: batch[0].workspaceId, sessionId: batch[0].source.sessionId };
    return this.memories.records.start(scope, "memory.organize", `批量分类 ${batch.length} 个已完成目的`, undefined, undefined, false,
      { batch: { purposeIds: batch.map(purpose => purpose.id), sessionIds: [...new Set(batch.map(purpose => purpose.source.sessionId))], published: false } });
  }
  async organize(batch: QueuedPurpose[], selection: Selection, signal: AbortSignal, recordId?: string) {
    if (!batch.length) return;
    const scope = { workspaceId: batch[0].workspaceId, sessionId: batch[0].source.sessionId };
    const processingId = recordId ?? this.startOrganization(batch), originalBatch = batch, peers = this.tree.entries(scope.workspaceId);
    const deadlineAt = Date.now() + this.memories.preferences().timeoutMs;
    signal = AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, deadlineAt - Date.now()))]);
    let claim: OrganizationClaim | undefined, guardedPurposes: MemoryPurpose[] = batch;
    const batchContext = (published = false) => ({ purposeIds: originalBatch.map(purpose => purpose.id), sessionIds: [...new Set(originalBatch.map(purpose => purpose.source.sessionId))], published, skipped: originalBatch.length - batch.length });
    const guardDeadline = () => {
      signal.throwIfAborted();
      if (Date.now() >= deadlineAt) throw new AppError("MEMORY_BUDGET", "整理总执行时限已到，未发布");
    };
    const guard = () => {
      guardDeadline();
      for (const purpose of guardedPurposes) {
        const source = { workspaceId: scope.workspaceId, sessionId: purpose.source.sessionId };
        this.memories.owner(source); this.locate(purpose, this.full(source, "MEMORY.md", signal), peers);
      }
      guardDeadline();
    };
    try {
      this.memories.records.stage(processingId, "核对批次来源", selection);
      // Preserve pre-request audit failures while isolating invalid locators:
      // a removed/reopened goal must not poison other completed purposes.
      batch = batch.filter(purpose => {
        signal.throwIfAborted();
        try {
          const source = { workspaceId: purpose.workspaceId, sessionId: purpose.source.sessionId };
          this.memories.owner(source); this.locate(purpose, this.full(source, "MEMORY.md", signal), peers); return true;
        } catch (error) { signal.throwIfAborted(); this.tree.suspend(purpose, error); return false; }
      });
      this.memories.records.annotate(processingId, { batch: batchContext() });
      if (!batch.length) {
        this.memories.records.finish(processingId, "invalidated", "全部目的定位已失效，未请求模型");
        this.memories.publishTree(scope.workspaceId); return;
      }
      guardedPurposes = batch; guard();
      const snapshot = this.tree.snapshot(scope.workspaceId), purposes = [...snapshot.purposes, ...batch];
      guardedPurposes = purposes; guard();
      claim = this.tree.claim(scope.workspaceId, batch, purposes, snapshot.version, processingId);
      const size = (roots: MemoryIndexNode[]) => Array.from(projectMemoryTree(roots).catalog).length;
      const organize = async (roots: MemoryIndexNode[], sources: MemoryPurpose[], stage: string, target?: number) => {
        signal.throwIfAborted();
        const titles = [...new Set(sources.map(purpose => purpose.text))];
        // Only tree text and exact titles enter the model. Bindings remain frozen here.
        const prompt = JSON.stringify({ existingTree: this.tree.modelTree(roots), titles });
        const systemPrompt = `${memoryOrganizerPrompt}\n\n语义目录体积按实际查询文本计数：前缀“目录：”及换行、每级两个空格缩进、目录名称和换行；不计原标题叶。${target ? `本阶段是压缩重整，必须不超过${target}个Unicode码点。` : `最终不得超过${memoryOrganizationWatermarks.maximum}个Unicode码点。`}`;
        if (Array.from(prompt).length + Array.from(systemPrompt).length > this.memories.preferences().readChars)
          throw new AppError("MEMORY_LIMIT", "完整整理输入超过预算，未截断目的或目录，队列保留");
        this.memories.records.stage(processingId, stage, selection);
        const result = await this.execute({ scope, selection, kind: "organize", signal, deadlineAt, processingId,
          systemPrompt, prompt, outputReserve: Buffer.byteLength(JSON.stringify(titles.map(title => ({ title }))), "utf8") + 1024 }, stage);
        signal.throwIfAborted();
        if (result.incomplete || result.answer.length > memoryOrganizationOutputChars)
          throw new AppError("MEMORY_BUDGET", "整理输出未完整完成或超过容量，未发布");
        this.memories.records.stage(processingId, "校验分类结果");
        const candidate = this.tree.classify(result.answer, sources);
        if (target && size(candidate) > target) throw new AppError("MEMORY_LIMIT", "重整未达到目标体积，未发布任何中间结果");
        return candidate;
      };
      let existing = snapshot.roots;
      if (size(existing) >= memoryOrganizationWatermarks.early)
        existing = await organize(existing, snapshot.purposes, "前置重整旧目录", memoryOrganizationWatermarks.target);
      let roots = await organize(existing, purposes, "纳入本批原标题");
      if (size(roots) > memoryOrganizationWatermarks.maximum)
        roots = await organize(roots, purposes, "压缩超限候选目录", memoryOrganizationWatermarks.target);
      this.memories.records.stage(processingId, "校验分类结果");
      this.memories.records.stage(processingId, "复核目的来源");
      guard();
      this.memories.records.stage(processingId, "原子发布分类");
      this.tree.publish(scope.workspaceId, batch, roots, snapshot.version, () => {
        this.memories.records.annotate(processingId, { outcome: "applied", batch: batchContext(true) });
        this.memories.records.stage(processingId, "分类已发布");
        this.memories.records.finish(processingId, "completed", undefined, { publishedPurposeIds: batch.map(purpose => purpose.id), indexVersion: snapshot.version + 1 });
      }, claim, deadlineAt);
      this.memories.publishTree(scope.workspaceId);
    } catch (error) {
      this.tree.failure(batch, error, claim); this.memories.publishTree(scope.workspaceId);
      this.memories.records.failure(processingId, error, signal); throw error;
    }
  }
  async query(scope: Scope, question: string, selection: Selection, signal: AbortSignal, deadlineAt: number, parentLease?: LeaseRef, recordId?: string): Promise<MemoryQueryResult> {
    const id = recordId ?? this.memories.records.start(scope, "memory.query", `记忆查询：${question.slice(0, 160)}`);
    try {
      const result = await this.queryIndex(scope, question, selection, signal, deadlineAt, parentLease, id);
      if (!recordId) this.memories.records.finish(id, result.incomplete ? "failed" : "completed", undefined, result);
      return result;
    } catch (error) { this.memories.records.failure(id, error, signal); throw error; }
  }
  private async queryIndex(scope: Scope, question: string, selection: Selection, signal: AbortSignal, deadlineAt: number, parentLease: LeaseRef | undefined, processingId: string): Promise<MemoryQueryResult> {
    this.memories.owner(scope); signal.throwIfAborted();
    this.memories.records.stage(processingId, "读取完整目录快照", selection);
    // The directory AND its references are captured once. Never rescan sources,
    // re-enter classification, or switch to a newly published tree mid-query.
    const snapshot = this.tree.nodeSnapshot(scope.workspaceId), base = { scope, selection, kind: "query" as const, signal, deadlineAt, parentLease, processingId };
    const empty: MemoryQueryResult = { answer: "", scope, incomplete: false, sources: [], indexVersion: snapshot.version };
    if (!snapshot.roots.length) return empty;
    const projection = projectMemoryTree(snapshot.roots);
    const knownReferences = new Map(this.tree.nodes.documentReferences(scope.workspaceId).map(ref => [JSON.stringify([ref.sessionId, ref.path]), ref]));
    this.memories.records.stage(processingId, "全树一次匹配", selection);
    const matched = await this.execute({ ...base, systemPrompt: memoryMatchPrompt,
      prompt: JSON.stringify({ question, catalog: projection.catalog }) }, "全树一次匹配", projection.bindings);
    signal.throwIfAborted();
    if (matched.incomplete) throw new AppError("MEMORY_UNAVAILABLE", "目录匹配未完整完成");
    const selected = projection.resolve(matched.answer);
    if (!selected.length) {
      this.memories.owner(scope);
      this.memories.records.annotate(processingId, { outcome: "no_match" });
      this.memories.records.stage(processingId, "无匹配目录"); return empty;
    }
    // Expand captured descendants in program code, never a second model lookup.
    const descendants = (node: MemoryIndexNode): MemoryDocumentRef[] => [
      ...node.documentRefs ?? [], ...node.children.flatMap(descendants),
    ];
    const refs = uniqueMemoryDocuments(selected.flatMap(descendants));
    const verifiedRefs = new Map(refs.map(ref => [JSON.stringify([ref.sessionId, ref.path]), ref]));
    const documents = new Map<string, MemoryDocument & { sessionId: string; access: MemoryReadAccess }>();
    const read = (sessionId: string, path: string) => {
      const key = JSON.stringify([sessionId, path]);
      if (documents.has(key)) return documents.get(key)!;
      try {
        const value = { ...this.full({ workspaceId: scope.workspaceId, sessionId }, path, signal), sessionId };
        documents.set(key, value); return value;
      } catch (error) {
        signal.throwIfAborted();
        // Ordinary unavailable files are misses; path, authorization, paging,
        // model and program errors remain real execution failures.
        const code = (error as NodeJS.ErrnoException).code;
        if (["ENOENT", "ENOTDIR", "EACCES", "EPERM", "MEMORY_BINARY"].includes(code ?? "")) return undefined;
        throw error;
      }
    };
    this.memories.records.stage(processingId, "批量读取关联文档");
    this.verify(scope, [], refs);
    const evidence = new Map<string, { purposes: string[]; heading: string; state: string; ancestors: MemoryDocumentRef["ancestors"]; content: string; linkedFrom?: string }>();
    const add = (ref: MemoryDocumentRef, document: MemoryDocument & { sessionId: string }, linkedFrom?: string) => {
      if (!document.content.trim()) return;
      evidence.set(JSON.stringify([document.sessionId, document.path]), {
        purposes: snapshot.purposes.filter(purpose => ref.purposeIds.includes(purpose.id)).map(purpose => purpose.text),
        heading: ref.title, state: ref.state, ancestors: ref.ancestors, content: document.content, ...(linkedFrom ? { linkedFrom } : {}) });
    };
    for (const ref of refs) {
      const document = read(ref.sessionId, ref.path);
      if (!document) continue;
      add(ref, document);
      const root = memoryDirectory(this.memories.store.root, ref.sessionId);
      for (const file of referencedPaths(`${root}/${ref.path}`, document.content).filter(file => /\.(md|txt)$/i.test(file))) {
        const path = relative(root, file).replaceAll("\\", "/");
        if (path === ref.path || path === "MEMORY.md") continue;
        const key = JSON.stringify([ref.sessionId, path]), bound = knownReferences.get(key);
        if (bound) { this.verify(scope, [], [bound]); verifiedRefs.set(key, bound); }
        else if (path.startsWith("details/")) throw new AppError("MEMORY_LOCATOR_INVALID", "链接任务详情不在捕获的来源快照中，不能猜测其归属或绕过撤销");
        const reference = read(ref.sessionId, path);
        // A linked task detail retains its own purpose/state, not the linking
        // task's identity. Unbound reference material has no asserted task state.
        if (reference) add(bound ?? { ...ref, path, title: basename(file), state: "", ancestors: [] }, reference, ref.path);
      }
    }
    const readDocuments = [...documents.values()].map(({ sessionId, path, revision }) => ({ sessionId, path, revision }));
    if (!evidence.size) {
      this.verify(scope, [...documents.values()], [...verifiedRefs.values()]);
      this.memories.records.annotate(processingId, { outcome: "no_evidence" });
      this.memories.records.stage(processingId, "目录已匹配，但无有效依据"); return { ...empty, readDocuments };
    }
    this.memories.records.stage(processingId, "归纳原文答案", selection);
    const result = await this.execute({ ...base, systemPrompt: memoryAnswerPrompt,
      prompt: JSON.stringify({ question, evidence: [...evidence.values()] }) }, "归纳原文答案");
    signal.throwIfAborted();
    // Check authority/corrections, not later byte revisions of already-read files.
    this.verify(scope, [...documents.values()], [...verifiedRefs.values()]);
    if (result.incomplete) this.memories.records.annotate(processingId, { outcome: "incomplete" });
    this.memories.records.stage(processingId, result.incomplete ? "查询结果不完整" : "查询结果已核验");
    return { ...result, scope, indexVersion: snapshot.version,
      sources: [...new Map(readDocuments.map(({ sessionId, revision }) => [sessionId, { sessionId, revision }])).values()], readDocuments };
  }
}
