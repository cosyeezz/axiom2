import { randomUUID } from "node:crypto";
import path from "node:path";
import type { BasisItem, CodeEvidenceInput, CodeEvidenceResult, EvidenceOperation, EvidenceRecord, FileSnapshot, ReadToken, RequestLedger, SourceRef, SourceSnapshot, StoredObject, SubmissionOwner } from "../contracts.js";
import { IndexError, publicIndexError, requireIndex } from "../domain/errors.js";
import { canonicalJson, digest, stableId } from "../domain/json.js";
import { parseEvidence } from "../domain/schema.js";
import { parseWorkspace, type ParsedWorkspace } from "../parser/typescript.js";
import { SqliteIndexStore, type PersistedScope } from "../store/sqlite.js";
import { FilePolicy, normalizeScope, scopeMatches, type FileManifest } from "./policy.js";
import { lineOffsets, mergeIntervals, refOffsets, sourceRef, textPageEnd } from "./positions.js";

interface PageCursor { ledgerId: string; binding: string; policyHash: string; contextHash: string; snapshotHash: string; offset: number; expiresAt: number }
function waitFor<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
export class SourceEvidence {
  private parsed: ParsedWorkspace | null = null;
  private parsedInput = "";
  private manifest: FileManifest | null = null;
  private current: SourceSnapshot | null = null;
  private scanning: Promise<SourceSnapshot> | null = null;
  private readonly lifetime = new AbortController();
  private readonly writers = new Map<string, Promise<void>>();
  private readonly cursors = new Map<string, PageCursor>();
  constructor(readonly store: SqliteIndexStore, readonly policy: FilePolicy, readonly workspaceId: string) {}
  async reconcile(signal?: AbortSignal): Promise<SourceSnapshot> {
    this.lifetime.signal.throwIfAborted(); signal?.throwIfAborted();
    if (!this.scanning) this.scanning = this.scan(this.lifetime.signal).finally(() => { this.scanning = null; });
    return waitFor(this.scanning, signal);
  }
  async withLedger<T>(ledgerId: string, work: (ledger: RequestLedger) => Promise<T>, signal?: AbortSignal): Promise<T> {
    const preceding = this.writers.get(ledgerId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const tail = preceding.then(() => gate);
    this.writers.set(ledgerId, tail);
    try {
      await waitFor(preceding, signal);
      this.lifetime.signal.throwIfAborted(); signal?.throwIfAborted();
      const ledger = this.ledger(ledgerId), result = await work(ledger);
      this.lifetime.signal.throwIfAborted(); signal?.throwIfAborted(); this.ledger(ledgerId);
      this.store.putLedger(ledger);
      return result;
    } finally { release(); void tail.then(() => { if (this.writers.get(ledgerId) === tail) this.writers.delete(ledgerId); }); }
  }
  private async scan(signal?: AbortSignal): Promise<SourceSnapshot> {
    const manifest = await this.policy.scan(signal);
    signal?.throwIfAborted();
    const parsedInput = digest({ files: [...manifest.files.values()].map(file => [file.path, file.contentHash]), policy: this.policy.hash });
    const parsed = this.parsed && parsedInput === this.parsedInput ? this.parsed : parseWorkspace(this.policy.root, this.workspaceId, manifest.files, this.policy.hash);
    const priorScopes = this.store.scopes();
    if (!priorScopes.length) {
      const definition = normalizeScope({ include: ["**/*"], exclude: [] }), definitionHash = digest(definition);
      priorScopes.push({ id: stableId("scope", definition), definition, definitionHash, revision: 0, contentDigest: "", members: [], complete: false });
    }
    const scopes: PersistedScope[] = priorScopes.map(scope => {
      const members = manifest.members.filter(file => scopeMatches(scope.definition, file.path));
      const complete = manifest.complete && members.every(member => member.state === "present");
      const contentDigest = digest({ definitionHash: scope.definitionHash, policyHash: this.policy.hash, analysisContextHash: parsed.contextHash, members, complete, gaps: manifest.gaps });
      return { ...scope, members, complete, contentDigest, revision: scope.revision + Number(contentDigest !== scope.contentDigest) };
    });
    const priorFiles = new Map(this.store.files().map(file => [file.path, file]));
    const missingState = (name: string) => manifest.complete && !manifest.members.some(member => member.path === name) && this.policy.allows(name) ? "deleted" as const : "unresolved" as const;
    const changed = new Set<string>();
    for (const file of manifest.files.values()) if (priorFiles.get(file.path)?.contentHash !== file.contentHash || priorFiles.get(file.path)?.status !== (parsed.parseErrors.has(file.path) ? "parse_error" : "present")) changed.add(file.path);
    for (const file of priorFiles.values()) if (!manifest.files.has(file.path) && file.status !== missingState(file.path)) changed.add(file.path);
    const scopesChanged = scopes.some(scope => priorScopes.find(prior => prior.id === scope.id)?.contentDigest !== scope.contentDigest);
    const contextChanged = this.store.meta("analysis_context_hash") !== parsed.contextHash || this.store.meta("policy_hash") !== this.policy.hash;
    this.store.transaction(() => {
      const epoch = changed.size || contextChanged || scopesChanged ? this.store.advance("observed") : this.store.epochs().observedEpoch;
      if (changed.size || contextChanged || scopesChanged || this.store.meta("reconciled") !== "true") this.store.advance("semantic");
      for (const file of manifest.files.values()) this.store.putFile({ path: file.path, contentHash: file.contentHash, language: path.extname(file.path).slice(1) || "text", status: parsed.parseErrors.has(file.path) ? "parse_error" : "present", sizeBytes: file.sizeBytes, observedEpoch: epoch });
      for (const old of priorFiles.values()) if (!manifest.files.has(old.path)) this.store.putFile({ ...old, status: missingState(old.path), observedEpoch: epoch });
      for (const scope of scopes) this.store.putScope(scope);
      const ids = new Set(parsed.symbols.map(symbol => symbol.id));
      for (const symbol of parsed.symbols) {
        const existing = this.store.object(symbol.id), hash = digest(symbol.body);
        const review = { basis: [{ kind: "file" as const, key: symbol.path, version: symbol.sourceRef.contentHash }, { kind: "context" as const, key: "analysis", version: parsed.contextHash }], evidenceIds: [], scopeIds: [] };
        const same = existing?.contentHash === hash;
        const recordSame = same && existing?.lifecycle === "active" && canonicalJson(existing.review) === canonicalJson(review);
        this.store.putSource(symbol.sourceRef);
        this.store.putObject({ id: symbol.id, kind: "symbol", name: symbol.name, naturalKey: symbol.body.naturalKey, filePath: symbol.path, body: symbol.body, contentHash: hash, contentRev: (existing?.contentRev ?? 0) + Number(!same), recordRev: (existing?.recordRev ?? 0) + Number(!recordSame), review, lifecycle: "active" });
      }
      for (const old of this.store.objects()) if (old.kind === "symbol" && old.lifecycle === "active" && !ids.has(old.id) && old.filePath && !parsed.parseErrors.has(old.filePath) && (manifest.files.has(old.filePath) || missingState(old.filePath) === "deleted")) this.store.putObject({ ...old, lifecycle: "retired", recordRev: old.recordRev + 1 });
      this.store.setMeta("analysis_context_hash", parsed.contextHash); this.store.setMeta("policy_hash", this.policy.hash); this.store.setMeta("reconciled", "true");
    });
    if (this.parsed !== parsed) this.parsed?.dispose();
    this.parsed = parsed; this.parsedInput = parsedInput; this.manifest = manifest;
    this.current = { files: manifest.files, scopes, policyHash: this.policy.hash, analysisContextHash: parsed.contextHash, complete: manifest.complete, gaps: [...manifest.gaps, ...parsed.gaps] };
    return this.current;
  }
  async createLedger(requestId: string, attemptId: string, owner: SubmissionOwner, expiresAt: number, signal?: AbortSignal): Promise<RequestLedger> {
    const snapshot = await this.reconcile(signal);
    const ledger: RequestLedger = { ledgerId: randomUUID(), requestId, attemptId, owner, basis: [{ kind: "context", key: "analysis", version: snapshot.analysisContextHash }, { kind: "context", key: "policy", version: snapshot.policyHash }], evidence: [], sourceRefs: [], readObjectIds: [], evidenceSources: [], readRanges: [], expiresAt };
    this.store.createLedger(ledger); return ledger;
  }
  token(ledger: RequestLedger, snapshot = this.current): ReadToken {
    requireIndex(snapshot, "NOT_READY", "索引尚未完成内容核对。");
    return { workspaceId: ledger.owner.workspaceId, ...this.store.epochs(), policyHash: snapshot.policyHash, analysisContextHash: snapshot.analysisContextHash, ledgerId: ledger.ledgerId, consistency: snapshot.complete ? "verified_basis" : "unresolved" };
  }
  ledger(id: string): RequestLedger {
    const ledger = this.store.ledger(id);
    requireIndex(ledger && ledger.expiresAt > Date.now(), "SNAPSHOT_EXPIRED", "证据读取尝试已到期。");
    requireIndex(ledger.basis.find(b => b.kind === "context" && b.key === "policy")?.version === this.policy.hash, "ACCESS_DENIED", "索引读取策略已改变。");
    return ledger;
  }
  recordObject(ledger: RequestLedger, object: StoredObject) {
    if (!ledger.readObjectIds.includes(object.id)) ledger.readObjectIds.push(object.id);
    this.basis(ledger, { kind: "object", key: object.id, version: String(object.contentRev) });
  }
  private basis(ledger: RequestLedger, basis: BasisItem) {
    const existing = ledger.basis.find(item => item.kind === basis.kind && item.key === basis.key);
    requireIndex(!existing || existing.version === basis.version, "FILE_CHANGED", "读取依据在当前尝试中发生变化。");
    if (!existing) ledger.basis.push(basis);
  }
  private recordSource(ledger: RequestLedger, file: FileSnapshot, start: number, end: number) {
    const ref = sourceRef(ledger.owner.workspaceId, file.path, file.contentHash, file.text, start, end);
    const record: EvidenceRecord = { id: stableId("ev", { kind: "source_range", sourceRefId: ref.id }), kind: "source_range", sourceRefId: ref.id };
    if (!ledger.sourceRefs.some(item => item.id === ref.id)) ledger.sourceRefs.push(ref);
    if (!ledger.evidence.some(item => item.id === record.id)) { ledger.evidence.push(record); ledger.evidenceSources.push({ evidenceId: record.id, paths: [file.path] }); }
    this.basis(ledger, { kind: "file", key: file.path, version: file.contentHash });
    let read = ledger.readRanges.find(item => item.path === file.path && item.contentHash === file.contentHash);
    if (!read) { read = { path: file.path, contentHash: file.contentHash, intervals: [] }; ledger.readRanges.push(read); }
    read.intervals = mergeIntervals(read.intervals, [start, end]);
    return { record, source: { ref, text: file.text.slice(start, end) } };
  }
  private observation(ledger: RequestLedger, scope: PersistedScope, operation: "search" | "changes", query: { text: string; caseSensitive: boolean } | null, complete: boolean): EvidenceRecord {
    const body = { kind: "scope_observation" as const, scopeId: scope.id, definition: scope.definition, definitionHash: scope.definitionHash, contentDigest: scope.contentDigest, policyHash: this.policy.hash, analysisContextHash: this.current!.analysisContextHash, operation, query, complete: complete && scope.complete, observation: complete ? "已完成本次允许范围的机械检索；不证明运行行为不存在。" : "本次检索未完整交付，不能据此断言未找到。" };
    const record: EvidenceRecord = { id: stableId("obs", body), ...body };
    if (!ledger.evidence.some(item => item.id === record.id)) { ledger.evidence.push(record); ledger.evidenceSources.push({ evidenceId: record.id, paths: scope.members.map(member => member.path) }); }
    this.basis(ledger, { kind: "scope", key: scope.id, version: scope.contentDigest });
    return record;
  }
  private operationBinding(operation: EvidenceOperation) { const { cursor: _cursor, ...input } = operation; return digest(input); }
  private pageState(ledger: RequestLedger, operation: EvidenceOperation, snapshotHash: string) {
    if (!operation.cursor) return 0;
    const cursor = this.cursors.get(operation.cursor);
    requireIndex(cursor && cursor.expiresAt > Date.now() && cursor.ledgerId === ledger.ledgerId && cursor.binding === this.operationBinding(operation), "SNAPSHOT_EXPIRED", "分页引用不属于当前读取。");
    requireIndex(cursor.policyHash === this.policy.hash, "ACCESS_DENIED", "分页授权已变化。");
    requireIndex(cursor.contextHash === this.current?.analysisContextHash && cursor.snapshotHash === snapshotHash, "FILE_CHANGED", "分页依据已变化，请重新读取。");
    return cursor.offset;
  }
  private cursor(ledger: RequestLedger, operation: EvidenceOperation, snapshotHash: string, offset: number) {
    for (const [key, value] of this.cursors) if (value.expiresAt < Date.now()) this.cursors.delete(key);
    requireIndex(this.cursors.size < 2048, "BUDGET_EXCEEDED", "证据分页数量达到上限。");
    const id = randomUUID(); this.cursors.set(id, { ledgerId: ledger.ledgerId, binding: this.operationBinding(operation), policyHash: this.policy.hash, contextHash: this.current!.analysisContextHash, snapshotHash, offset, expiresAt: ledger.expiresAt }); return id;
  }
  async read(ledgerId: string, input: CodeEvidenceInput, signal?: AbortSignal): Promise<CodeEvidenceResult> {
    const checked = parseEvidence(input);
    return this.withLedger(ledgerId, async ledger => {
    await this.reconcile(signal);
    requireIndex(ledger.basis.find(b => b.kind === "context" && b.key === "analysis")?.version === this.current?.analysisContextHash, "WORKSPACE_CHANGED", "解析上下文已变化，请重新开始读取。");
    const result: CodeEvidenceResult = { readToken: this.token(ledger), operations: [] };
    const perOperation = Math.floor((65_536 - 4096) / checked.operations.length);
    for (const [operationIndex, operation] of checked.operations.entries()) {
      signal?.throwIfAborted();
      try {
        const operationLedger = structuredClone(ledger);
        const item = await this.operation(operationLedger, operation, operationIndex, perOperation, signal);
        requireIndex(Buffer.byteLength(canonicalJson(item)) <= perOperation, "BUDGET_EXCEEDED", "单项证据超过交付上限。");
        Object.assign(ledger, operationLedger);
        result.operations.push(item);
      } catch (error) {
        signal?.throwIfAborted(); const { code, message } = publicIndexError(error);
        result.operations.push({ operationIndex, evidence: [], candidates: [], truncated: true, error: { code, message } });
      }
    }
    requireIndex(Buffer.byteLength(canonicalJson(result)) <= 65_536, "BUDGET_EXCEEDED", "证据批次超过交付上限。");
    requireIndex(ledger.evidence.length <= 2048 && ledger.sourceRefs.length <= 2048, "BUDGET_EXCEEDED", "本次读取证据数量达到上限。");
    return result;
    }, signal);
  }
  private async operation(ledger: RequestLedger, operation: EvidenceOperation, operationIndex: number, maxBytes: number, signal?: AbortSignal): Promise<CodeEvidenceResult["operations"][number]> {
    if (operation.kind === "read" || operation.kind === "fetch_ref") {
      const original = operation.kind === "fetch_ref" ? ledger.sourceRefs.find(ref => ref.id === operation.sourceRefId) ?? this.store.source(operation.sourceRefId, ledger.owner.workspaceId) : null;
      requireIndex(operation.kind !== "fetch_ref" || original, "INVALID_INPUT", "来源引用不可用。");
      const file = await this.policy.read(operation.kind === "read" ? operation.path : original!.path, signal);
      requireIndex(!original || original.contentHash === file.contentHash, "FILE_CHANGED", "源码已经变化，旧范围不能应用于新版本。");
      let start: number, end: number;
      if (operation.kind === "read") {
        const lines = lineOffsets(file.text);
        requireIndex(operation.startLine < lines.length && operation.endLine > operation.startLine && operation.endLine <= lines.length, "INVALID_INPUT", "读取行范围无效；使用零基半开区间。");
        start = lines[operation.startLine]; end = lines[operation.endLine] ?? file.text.length;
      } else [start, end] = refOffsets(file.text, original!);
      const snapshotHash = digest({ path: file.path, hash: file.contentHash, start, end });
      const cursorOffset = this.pageState(ledger, operation, snapshotHash);
      const at = operation.cursor ? cursorOffset : start;
      requireIndex(at >= start && at <= end, "INVALID_INPUT", "分页位置无效。");
      const finish = textPageEnd(file.text, at, end, Math.max(0, maxBytes - 1800 - Buffer.byteLength(file.path) * 2));
      requireIndex(finish > at || at === end, "BUDGET_EXCEEDED", "当前页预算无法容纳源码字符。");
      const evidence = this.recordSource(ledger, file, at, finish);
      return finish < end ? { operationIndex, evidence: [evidence], candidates: [], truncated: true, nextCursor: this.cursor(ledger, operation, snapshotHash, finish) } : { operationIndex, evidence: [evidence], candidates: [], truncated: false };
    }
    if (operation.kind === "definition" || operation.kind === "references") {
      const symbol = this.store.object(operation.symbolId);
      requireIndex(symbol?.kind === "symbol" && symbol.lifecycle === "active" && symbol.filePath && this.policy.allows(symbol.filePath), "ACCESS_DENIED", "符号不可用于当前读取。");
      const refs = operation.kind === "definition" ? this.parsed!.definitions(symbol.id) : this.parsed!.references(symbol.id);
      const snapshotHash = digest(refs.map(ref => ref.id)), offset = this.pageState(ledger, operation, snapshotHash);
      const candidates: CodeEvidenceResult["operations"][number]["candidates"] = [];
      let count = offset;
      while (count < refs.length) {
        const ref = refs[count], candidate = { path: ref.path, label: `${ref.path}:${ref.range.start.line + 1}`, symbolId: symbol.id };
        if (Buffer.byteLength(canonicalJson([...candidates, candidate])) > maxBytes - 1800) break;
        this.store.putSource(ref); candidates.push(candidate); count++;
      }
      requireIndex(count > offset || offset === refs.length, "BUDGET_EXCEEDED", "当前页预算无法容纳导航结果。");
      // Navigation only lists candidates; callers must read/fetch actual source.
      return count < refs.length ? { operationIndex, evidence: [], candidates, truncated: true, nextCursor: this.cursor(ledger, operation, snapshotHash, count) } : { operationIndex, evidence: [], candidates, truncated: false };
    }
    const scope = this.store.scopes().find(item => item.id === operation.scopeId);
    requireIndex(scope, "INVALID_INPUT", "索引范围不存在。");
    const candidates: CodeEvidenceResult["operations"][number]["candidates"] = [];
    const hits: { path: string; label: string }[] = [];
    let exhaustive = true;
    if (operation.kind === "search") {
      const needle = operation.caseSensitive ? operation.text : operation.text.toLowerCase();
      for (const member of scope.members) {
        const file = this.current!.files.get(member.path); if (!file) continue;
        const haystack = operation.caseSensitive ? file.text : file.text.toLowerCase();
        let from = 0;
        while ((from = haystack.indexOf(needle, from)) >= 0) {
          if (hits.length >= 10_000) { exhaustive = false; break; }
          const line = file.text.slice(0, from).split(/\r\n|\r|\n/).length;
          hits.push({ path: file.path, label: `${file.path}:${line}` }); from += Math.max(1, needle.length);
        }
        if (!exhaustive) break;
      }
    } else {
      const changes = this.store.changes(); exhaustive = changes.length <= 10_000;
      for (const change of changes.slice(0, 10_000)) if (this.policy.allows(change.path) && scopeMatches(scope.definition, change.path)) hits.push({ path: change.path, label: "文件变化提示；需要读取当前内容核对。" });
    }
    const snapshotHash = digest({ scope: scope.contentDigest, hits }), offset = this.pageState(ledger, operation, snapshotHash);
    let next = offset;
    while (next < hits.length && Buffer.byteLength(canonicalJson([...candidates, hits[next]])) < maxBytes - 2200) candidates.push(hits[next++]);
    requireIndex(next > offset || next === hits.length, "BUDGET_EXCEEDED", "当前页预算无法容纳检索结果。");
    const complete = next === hits.length;
    const record = this.observation(ledger, scope, operation.kind, operation.kind === "search" ? { text: operation.text, caseSensitive: operation.caseSensitive } : null, complete && exhaustive);
    if (complete && !exhaustive) return { operationIndex, evidence: [{ record }], candidates, truncated: true, error: { code: "BUDGET_EXCEEDED", message: "检索命中超过上限，请缩小范围；本次搜索不完整。" } };
    return complete ? { operationIndex, evidence: [{ record }], candidates, truncated: false } : { operationIndex, evidence: [{ record }], candidates, truncated: true, nextCursor: this.cursor(ledger, operation, snapshotHash, next) };
  }
  async verify(ledger: RequestLedger, signal?: AbortSignal) {
    requireIndex(ledger.expiresAt > Date.now(), "SNAPSHOT_EXPIRED", "读取尝试已到期。");
    const snapshot = await this.reconcile(signal);
    for (const basis of ledger.basis) {
      if (basis.kind === "context") requireIndex(basis.version === (basis.key === "policy" ? snapshot.policyHash : snapshot.analysisContextHash), "WORKSPACE_CHANGED", "读取上下文已变化。");
      if (basis.kind === "file") requireIndex(snapshot.files.get(basis.key)?.contentHash === basis.version, "FILE_CHANGED", "源码依据已变化。");
      if (basis.kind === "scope") requireIndex(snapshot.scopes.find(scope => scope.id === basis.key)?.contentDigest === basis.version, "WORKSPACE_CHANGED", "检索范围已变化。");
      if (basis.kind === "object") { const object = this.store.object(basis.key); requireIndex(object && String(object.contentRev) === basis.version, "RECORD_CHANGED", "读取的索引对象已变化。"); }
    }
    return snapshot;
  }
  revoke(ledgerId: string) { this.store.deleteLedger(ledgerId); for (const [key, value] of this.cursors) if (value.ledgerId === ledgerId) this.cursors.delete(key); }
  close() { this.lifetime.abort(); this.parsed?.dispose(); this.parsed = null; this.cursors.clear(); this.current = null; this.manifest = null; }
}
