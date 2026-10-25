import { relative } from "node:path";
import type { Memories, MemoryExecution } from "./memories.js";
import { MemoryTreeStore, type QueuedPurpose } from "./memory-tree.js";
import { memoryDirectory, referencedPaths } from "./memory-files.js";
import { memoryOrganizerPrompt, memoryMatchPrompt, memoryAnswerPrompt } from "../shared/memory-prompts.js";
import type { MemoryPurpose, MemorySource, MemoryIndexNode } from "../shared/memory-tree.js";
import { AppError, type Scope } from "../shared/protocol.js";
import { type MemoryDocument, type MemoryQueryResult } from "../shared/memory.js";
import { memoryPurposes } from "../shared/memory-purposes.js";
import { locateMemoryPurpose, queryMemorySnapshot } from "../shared/memory-purpose-locator.js";
import { availableMemoryDetails } from "./memory-detail-files.js";
import type { Selection } from "../shared/agent.js";
import type { LeaseRef } from "./execution-protocol.js";

export class MemoryPipeline {
  readonly tree: MemoryTreeStore;
  constructor(private memories: Memories) { this.tree = new MemoryTreeStore(memories.store); }
  private full(scope: Scope, path: string, signal?: AbortSignal): MemoryDocument {
    let content = "", offset = 0, first: MemoryDocument | undefined;
    do {
      signal?.throwIfAborted();
      const page = this.memories.read(scope, path, offset, 16000, { includeImage: false });
      if (page.image || page.content === "图片产物") throw new AppError("MEMORY_READ_FAILED", "记忆查询只读取文本资料");
      if (first && page.revision !== first.revision) throw new AppError("REVISION_CONFLICT", "资料读取期间已变化");
      first ??= page; content += page.content;
      if (page.nextOffset === null) break;
      offset = page.nextOffset;
    } while (true);
    return { ...first!, content, offset: 0, nextOffset: null };
  }
  private verify(scope: Scope, documents: MemorySource[]) {
    this.memories.owner(scope);
    for (const source of documents) {
      this.memories.owner({ workspaceId: scope.workspaceId, sessionId: source.sessionId });
      if (this.memories.read({ workspaceId: scope.workspaceId, sessionId: source.sessionId }, source.path, 0, 1, { includeImage: false }).revision !== source.revision)
        throw new AppError("REVISION_CONFLICT", "读取依据已变化，结果未发布");
    }
  }
  private locate(purpose: MemoryPurpose, document: MemoryDocument, peers: readonly MemoryPurpose[]) {
    const headings = memoryPurposes(document.content);
    const found = locateMemoryPurpose(purpose, headings, peers);
    if (!found || !found.complete)
      throw new AppError("MEMORY_LOCATOR_INVALID", "原目的定位已失效；不能猜测来源或使用旧目录回答");
    return found;
  }
  private async execute(input: Omit<MemoryExecution, "read">, stage: string) {
    const id = input.processingId;
    const callId = id ? this.memories.records.callStart(id, stage, { systemPrompt: input.systemPrompt, prompt: input.prompt }, input.selection) : undefined;
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
    const batchContext = (published = false) => ({ purposeIds: originalBatch.map(purpose => purpose.id), sessionIds: [...new Set(originalBatch.map(purpose => purpose.source.sessionId))], published, skipped: originalBatch.length - batch.length });
    const guard = () => {
      signal.throwIfAborted();
      for (const purpose of batch) {
        const source = { workspaceId: scope.workspaceId, sessionId: purpose.source.sessionId };
        this.memories.owner(source); this.locate(purpose, this.full(source, "MEMORY.md", signal), peers);
      }
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
      guard();
      const snapshot = this.tree.snapshot(scope.workspaceId), entries = new Map(this.tree.entries(scope.workspaceId).map(purpose => [purpose.id, purpose]));
      const purposes = [...snapshot.purposes, ...batch];
      // No source/session/path, original details or execution tree enter classification.
      const prompt = JSON.stringify({ existingTree: this.tree.modelTree(snapshot.roots),
        purposes: purposes.map(purpose => ({ id: purpose.id, text: purpose.text, context: entries.get(purpose.id)?.context ?? [] })),
        batchIds: batch.map(purpose => purpose.id) });
      if (prompt.length + memoryOrganizerPrompt.length > this.memories.preferences().readChars)
        throw new AppError("MEMORY_LIMIT", "完整分类输入超过预算，未截断目的或目录，队列保留");
      this.memories.records.stage(processingId, "批量语义分类", selection);
      const result = await this.execute({ scope, selection, kind: "organize", signal, processingId,
        systemPrompt: memoryOrganizerPrompt, prompt }, "批量语义分类");
      this.memories.records.stage(processingId, "校验分类结果");
      if (result.incomplete) throw new AppError("MEMORY_BUDGET", "批分类未完整完成，队列保留");
      const roots = this.tree.classify(result.answer, purposes);
      this.memories.records.stage(processingId, "复核目的来源");
      guard();
      this.memories.records.stage(processingId, "原子发布分类");
      this.tree.publish(scope.workspaceId, batch, roots, snapshot.version, () => {
        this.memories.records.annotate(processingId, { outcome: "applied", batch: batchContext(true) });
        this.memories.records.stage(processingId, "分类已发布");
        this.memories.records.finish(processingId, "completed", undefined, { publishedPurposeIds: batch.map(purpose => purpose.id), indexVersion: snapshot.version + 1 });
      });
      this.memories.publishTree(scope.workspaceId);
    } catch (error) {
      this.tree.failure(batch, error); this.memories.publishTree(scope.workspaceId);
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
    this.memories.records.stage(processingId, "读取已发布目的索引", selection);
    // Capture once, at invocation, before any model call. No session-directory
    // restriction, no rescan, and no switching versions midway through a query.
    const snapshot = queryMemorySnapshot(this.tree.snapshot(scope.workspaceId)), base = { scope, selection, kind: "query" as const, signal, deadlineAt, parentLease, processingId };
    const empty: MemoryQueryResult = { answer: "", scope, incomplete: false, sources: [], indexVersion: snapshot.version };
    let turns = 0;
    const match = async (stage: string, candidates: Array<{ id: string; text: string; [key: string]: unknown }>) => {
      signal.throwIfAborted();
      if (!candidates.length) return [] as string[];
      if (++turns >= this.memories.preferences().maxTurns) throw new AppError("MEMORY_BUDGET", "索引导航轮数达到上限，查询未完成");
      const label = stage === "directories" ? "匹配目录与目的" : "选择记忆详情";
      this.memories.records.stage(processingId, label, selection);
      const result = await this.execute({ ...base, systemPrompt: memoryMatchPrompt, prompt: JSON.stringify({ question, stage, candidates }) }, label);
      signal.throwIfAborted();
      this.memories.records.stage(processingId, "校验索引导航结果");
      if (result.incomplete) throw new AppError("MEMORY_UNAVAILABLE", "索引导航未完整完成");
      const selected: unknown = JSON.parse(result.answer), allowed = new Set(candidates.map(candidate => candidate.id));
      if (!Array.isArray(selected) || selected.some(id => typeof id !== "string" || !allowed.has(id)) || new Set(selected).size !== selected.length)
        throw new AppError("MEMORY_UNAVAILABLE", "索引导航返回越界或重复标识");
      return selected as string[];
    };
    let frontier = snapshot.roots;
    const chosen = new Set<string>();
    while (frontier.length) {
      const selected = new Set(await match("directories", frontier.map(node => ({ id: node.id, text: node.name, kind: node.purposeId ? "purpose" : "directory" }))));
      const next: MemoryIndexNode[] = [];
      for (const node of frontier) if (selected.has(node.id)) {
        if (node.purposeId) chosen.add(node.purposeId); else next.push(...node.children);
      }
      frontier = next;
    }
    if (!chosen.size) {
      this.memories.records.annotate(processingId, { outcome: "no_match" });
      this.memories.records.stage(processingId, "无匹配目的"); return empty;
    }
    this.memories.records.stage(processingId, "读取匹配目的与详情提纲");
    const documents = new Map<string, MemoryDocument & { sessionId: string }>();
    const read = (sessionId: string, path: string) => {
      const key = JSON.stringify([sessionId, path]);
      let value = documents.get(key);
      if (!value) { value = { ...this.full({ workspaceId: scope.workspaceId, sessionId }, path, signal), sessionId }; documents.set(key, value); }
      return value;
    };
    const details = new Map<string, { purpose: MemoryPurpose; path: string; heading: string; state: string }>();
    const outlines: Array<{ purpose: string; content: string }> = [];
    const located = new Set<string>();
    for (const purpose of snapshot.purposes.filter(purpose => chosen.has(purpose.id))) {
      const entry = read(purpose.source.sessionId, "MEMORY.md"), heading = this.locate(purpose, entry, snapshot.purposes);
      // Old and reference-annotated leaves can coexist in historical snapshots.
      // Validate every selected locator, but read the same current goal only once.
      const key = JSON.stringify([purpose.source.sessionId, heading.key]);
      if (located.has(key)) continue;
      located.add(key);
      outlines.push({ purpose: purpose.text, content: heading.content });
      const directory = memoryDirectory(this.memories.store.root, purpose.source.sessionId);
      for (const { node, path } of availableMemoryDetails(directory, entry.content)) {
        if (node.line < heading.line || node.line >= heading.endLine) continue;
        const id = JSON.stringify([purpose.id, path]);
        details.set(id, { purpose, path, heading: node.title, state: node.abandoned ? "已放弃" : node.state ?? "" });
      }
    }
    const selectedDetails = await match("details", [...details].map(([id, detail]) => ({ id, text: detail.heading, state: detail.state, purpose: detail.purpose.text })));
    // A title alone is not evidence. An empty detail selection is a genuine miss,
    // but still verify that the consulted locators were not changed in flight.
    const evidence: Array<{ purpose: string; heading: string; state: string; content: string }> = [];
    this.memories.records.stage(processingId, "读取选中详情及直接文本依据");
    for (const id of selectedDetails) {
      const detail = details.get(id)!;
      const document = read(detail.purpose.source.sessionId, detail.path);
      evidence.push({ purpose: detail.purpose.text, heading: detail.heading, state: detail.state, content: document.content });
      const root = memoryDirectory(this.memories.store.root, detail.purpose.source.sessionId);
      // Resolve direct references relative to the selected independent file.
      for (const file of referencedPaths(`${root}/${detail.path}`, document.content).filter(file => /\.(md|txt)$/i.test(file))) {
        const path = relative(root, file).replaceAll("\\", "/");
        if (path === detail.path || path === "MEMORY.md") continue;
        const reference = read(detail.purpose.source.sessionId, path);
        evidence.push({ purpose: detail.purpose.text, heading: detail.heading, state: detail.state, content: reference.content });
      }
    }
    const readDocuments = [...documents.values()].map(({ sessionId, path, revision }) => ({ sessionId, path, revision }));
    if (!evidence.length) {
      this.memories.records.stage(processingId, "复核查询依据"); this.verify(scope, readDocuments);
      this.memories.records.annotate(processingId, { outcome: "no_evidence" });
      this.memories.records.stage(processingId, "目的已匹配，但无有效依据"); return { ...empty, readDocuments };
    }
    this.memories.records.stage(processingId, "归纳原文答案", selection);
    const result = await this.execute({ ...base, systemPrompt: memoryAnswerPrompt,
      prompt: JSON.stringify({ question, outlines, evidence }) }, "归纳原文答案");
    signal.throwIfAborted();
    this.memories.records.stage(processingId, "复核查询依据");
    this.verify(scope, readDocuments);
    if (result.incomplete) this.memories.records.annotate(processingId, { outcome: "incomplete" });
    this.memories.records.stage(processingId, result.incomplete ? "查询结果不完整" : "查询结果已核验");
    return { ...result, scope, indexVersion: snapshot.version,
      sources: [...new Map(readDocuments.map(({ sessionId, revision }) => [sessionId, { sessionId, revision }])).values()], readDocuments };
  }
}
