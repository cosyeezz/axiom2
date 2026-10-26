import { randomUUID } from "node:crypto";
import { requireIndex } from "../domain/errors.js";
import { canonicalJson, digest } from "../domain/json.js";
import { parseProposal } from "../domain/schema.js";
import { evidenceIds, objectTerms, semanticHash } from "../domain/semantic.js";
import { validateGraph } from "../domain/graph.js";
import { AuthorizedReadView } from "../query/authorized-view.js";
import { category } from "../source/policy.js";
const revision = (object) => ({ id: object.id, contentRev: object.contentRev, recordRev: object.recordRev });
/** Sole semantic writer. Tools can accept a frozen proposal but cannot commit it. */
export class CommitCoordinator {
    store;
    sources;
    accepted = new Map();
    constructor(store, sources) {
        this.store = store;
        this.sources = sources;
    }
    accept(ledgerId, input) {
        for (const [key, value] of this.accepted)
            if (value.expiresAt <= Date.now())
                this.accepted.delete(key);
        const ledger = this.sources.ledger(ledgerId), proposal = parseProposal(input);
        requireIndex(proposal.requestId === ledger.requestId, "ACCESS_DENIED", "提案不属于当前请求。");
        const proposalDigest = digest(proposal), existing = this.accepted.get(ledgerId);
        requireIndex(!existing || existing.digest === proposalDigest, "INVALID_PROPOSAL", "本次尝试已经接受另一份提案。");
        if (!existing) {
            requireIndex(this.accepted.size < 64, "BUDGET_EXCEEDED", "等待提交的提案达到上限。");
            this.accepted.set(ledgerId, { digest: proposalDigest, proposal, attemptId: ledger.attemptId, expiresAt: ledger.expiresAt });
        }
        return { accepted: true, proposalDigest, committed: false };
    }
    revoke(ledgerId) { this.accepted.delete(ledgerId); this.sources.revoke(ledgerId); }
    frozen(ledger, proposalDigest) {
        const frozen = this.accepted.get(ledger.ledgerId);
        requireIndex(frozen && frozen.digest === proposalDigest && frozen.attemptId === ledger.attemptId && frozen.expiresAt > Date.now(), "INVALID_PROPOSAL", "已接受提案不可用或摘要不匹配。");
        return frozen;
    }
    validateEvidence(proposal, ledger, snapshot) {
        const available = new Map(ledger.evidence.map(record => [record.id, record]));
        const refs = new Map(ledger.sourceRefs.map(ref => [ref.id, ref]));
        const prove = (ids, code) => {
            requireIndex(ids.length > 0 && ids.every(id => available.has(id)), "INVALID_PROPOSAL", "提案引用了本次尝试未实际交付的证据。");
            if (code)
                requireIndex(ids.some(id => { const evidence = available.get(id); return evidence.kind === "source_range" && refs.has(evidence.sourceRefId) && category(refs.get(evidence.sourceRefId).path) === "code"; }), "INVALID_PROPOSAL", "已观察到的运行行为需要本次实际读取的源码证据。");
        };
        const coverage = (item) => {
            requireIndex(item.scopeIds.every(id => snapshot.scopes.some(scope => scope.id === id)), "INVALID_PROPOSAL", "覆盖声明引用未知范围。");
            if (item.mode !== "reviewed_scope")
                return;
            requireIndex(item.scopeIds.length > 0, "INVALID_PROPOSAL", "完整范围声明必须包含范围。");
            for (const id of item.scopeIds) {
                const scope = this.store.scopes().find(scope => scope.id === id);
                requireIndex(scope?.complete && ledger.evidence.some(record => record.kind === "scope_observation" && record.scopeId === id && record.complete), "INVALID_PROPOSAL", "范围清单尚未完整核对。");
                for (const member of scope.members) {
                    const file = snapshot.files.get(member.path), read = ledger.readRanges.find(read => read.path === member.path && read.contentHash === member.contentHash);
                    requireIndex(file && read?.intervals.some(([start, end]) => start === 0 && end === file.text.length), "INVALID_PROPOSAL", "未完整读取声明范围中的全部文件。");
                }
            }
        };
        for (const node of proposal.nodes) {
            for (const fact of node.facts)
                prove(fact.evidenceIds, fact.assertion === "observed");
            if (node.kind === "feature")
                for (const flow of node.flows)
                    prove(flow.evidenceIds, true);
            if (node.kind === "knowledge") {
                requireIndex(node.authoritySourceIds.length > 0 && node.authoritySourceIds.every(id => refs.has(id)), "INVALID_PROPOSAL", "知识必须引用本次已读取的权威来源。");
                requireIndex(node.facts.every(fact => fact.assertion === node.assertion), "INVALID_PROPOSAL", "知识的事实分类必须一致。");
            }
            coverage(node.coverage);
        }
        for (const edge of proposal.edges)
            prove(edge.evidenceIds, edge.relation === "uses" || edge.relation === "code");
        for (const item of [...proposal.retire, ...proposal.reactivate, ...proposal.reviews]) {
            prove(item.evidenceIds, false);
            for (const id of item.evidenceIds) {
                const record = available.get(id);
                requireIndex(record.kind !== "scope_observation" || record.complete, "INVALID_PROPOSAL", "不完整范围观察不能作为核验或生命周期依据。");
            }
        }
        coverage(proposal.result.coverage);
        for (const id of proposal.result.searchedScopeIds)
            requireIndex(ledger.evidence.some(record => record.kind === "scope_observation" && record.scopeId === id && record.operation === "search" && (proposal.result.status !== "not_found" || record.complete)), "INVALID_PROPOSAL", "搜索结果未获得对应范围的实际观察。");
        if (proposal.result.status === "not_found")
            requireIndex(proposal.result.searchedScopeIds.length > 0 && !proposal.result.selection.objectIds.length && !proposal.result.selection.locations.length, "INVALID_PROPOSAL", "未找到必须绑定已完成搜索范围。");
        for (const location of proposal.result.selection.locations)
            requireIndex(refs.has(location.sourceRefId), "INVALID_PROPOSAL", "结果位置不是本次已读取的真实来源。");
    }
    build(input, ledger, snapshot, allocate = false) {
        const objects = new Map(this.store.objects().map(object => [object.id, object]));
        const view = new AuthorizedReadView(this.store, this.sources.policy, snapshot, ledger.owner.workspaceId);
        const groups = [input.nodes, input.edges, input.reviews, input.retire, input.reactivate];
        const uses = new Map();
        for (const [groupIndex, group] of groups.entries()) {
            const local = new Set();
            for (const item of group) {
                requireIndex(!local.has(item.id), "INVALID_PROPOSAL", "同一操作数组包含重复标识。");
                local.add(item.id);
                uses.set(item.id, [...(uses.get(item.id) ?? []), groupIndex]);
            }
        }
        for (const [id, indices] of uses)
            if (indices.length > 1) {
                const existing = objects.get(id);
                requireIndex(indices.length === 2 && indices.includes(4) && (indices.includes(0) || indices.includes(1)) && existing?.lifecycle === "retired", "INVALID_PROPOSAL", "对象操作冲突；仅允许退休对象正文更新与恢复组合。");
            }
        const idMap = {};
        for (const [groupIndex, group] of groups.entries())
            for (const item of group) {
                const existing = objects.get(item.id), creation = item.expectedContentRev === null && item.expectedRecordRev === null;
                if (creation) {
                    requireIndex(groupIndex < 2 && !existing && item.id.startsWith("tmp:"), "INVALID_PROPOSAL", "新建对象必须使用临时标识和空双版本。");
                    idMap[item.id] ??= allocate ? `obj_${randomUUID()}` : item.id;
                }
                else {
                    requireIndex(existing && view.allowed(item.id) && ledger.readObjectIds.includes(item.id), "INVALID_PROPOSAL", "更新对象尚未在本次尝试中读取。");
                    requireIndex(existing.contentRev === item.expectedContentRev && existing.recordRev === item.expectedRecordRev, "RECORD_CHANGED", "索引记录双版本冲突。");
                    if (groupIndex < 2)
                        requireIndex(existing.lifecycle === "active" || uses.get(item.id)?.includes(4), "INVALID_PROPOSAL", "修改退休对象必须同时恢复。");
                    if (groupIndex === 4)
                        requireIndex(existing.lifecycle === "retired", "INVALID_PROPOSAL", "只能恢复退休对象。");
                    if (groupIndex === 3 || groupIndex === 2)
                        requireIndex(existing.lifecycle === "active", "INVALID_PROPOSAL", "退休或核验操作要求活跃对象。");
                }
            }
        requireIndex(new Set(Object.values(idMap)).size === Object.keys(idMap).length && Object.values(idMap).every(id => !objects.has(id)), "INVALID_PROPOSAL", "临时标识映射冲突。");
        const mapId = (id) => idMap[id] ?? id;
        const proposal = structuredClone(input);
        for (const node of proposal.nodes) {
            node.id = mapId(node.id);
            if (node.kind === "feature")
                for (const flow of node.flows) {
                    flow.beforeEdgeId = mapId(flow.beforeEdgeId);
                    flow.afterEdgeId = mapId(flow.afterEdgeId);
                }
        }
        for (const edge of proposal.edges) {
            edge.id = mapId(edge.id);
            edge.fromId = mapId(edge.fromId);
            if ("objectId" in edge.target)
                edge.target.objectId = mapId(edge.target.objectId);
        }
        proposal.result.selection.objectIds = proposal.result.selection.objectIds.map(mapId);
        proposal.result.selection.knowledgeIds = proposal.result.selection.knowledgeIds.map(mapId);
        proposal.result.selection.featurePaths = proposal.result.selection.featurePaths.map(ids => ids.map(mapId));
        for (const location of proposal.result.selection.locations)
            if (location.symbolId)
                location.symbolId = mapId(location.symbolId);
        const touched = new Set();
        const scopes = new Map(snapshot.scopes.map(scope => [scope.id, scope.definition]));
        for (const body of [...proposal.nodes, ...proposal.edges]) {
            const kind = "kind" in body ? body.kind : "edge", old = objects.get(body.id);
            requireIndex(!old || old.kind === kind, "INVALID_PROPOSAL", "不能改变对象种类。");
            if ("fromId" in body) {
                for (const endpoint of [body.fromId, ...("objectId" in body.target ? [body.target.objectId] : [])])
                    requireIndex(proposal.nodes.some(node => node.id === endpoint) || view.allowed(endpoint) && ledger.readObjectIds.includes(endpoint), "INVALID_PROPOSAL", "关系端点尚未在本次尝试中读取。");
                if ("sourceRefId" in body.target)
                    requireIndex(ledger.sourceRefs.some(ref => ref.id === body.target.sourceRefId), "INVALID_PROPOSAL", "关系来源尚未在本次尝试中读取。");
            }
            const contentHash = semanticHash(body, id => scopes.get(id) ?? null);
            if (!old && kind !== "edge")
                requireIndex(![...objects.values()].some(object => object.kind === kind && object.contentHash === contentHash), "AMBIGUOUS_REUSE", "存在正文完全相同的候选；请读取并明确复用。");
            const scopeIds = "coverage" in body ? body.coverage.scopeIds : [];
            const basis = ledger.basis.filter(item => !(item.kind === "object" && item.key === body.id));
            const review = { basis, evidenceIds: evidenceIds(body), scopeIds };
            // Expected revisions are wire preconditions, not persisted body content.
            const normalizedBody = { ...body, expectedContentRev: null, expectedRecordRev: null };
            objects.set(body.id, { id: body.id, kind, name: "name" in body ? body.name : body.relation, naturalKey: null, filePath: null, body: normalizedBody, contentHash, contentRev: old ? old.contentRev + Number(old.contentHash !== contentHash) : 1, recordRev: old?.recordRev ?? 0, review, lifecycle: old?.lifecycle ?? "active" });
            touched.add(body.id);
        }
        for (const item of proposal.reviews) {
            const old = objects.get(item.id);
            // Review alone never drops historical source dependencies/provenance.
            const basis = new Map(old.review.basis.map(basis => [`${basis.kind}:${basis.key}`, basis]));
            for (const next of ledger.basis)
                if (!(next.kind === "object" && next.key === item.id))
                    basis.set(`${next.kind}:${next.key}`, next);
            objects.set(item.id, { ...old, review: { basis: [...basis.values()], evidenceIds: [...new Set([...old.review.evidenceIds, ...item.evidenceIds])], scopeIds: [...new Set([...old.review.scopeIds, ...item.scopeIds])] } });
            touched.add(item.id);
        }
        for (const [group, lifecycle] of [[proposal.retire, "retired"], [proposal.reactivate, "active"]])
            for (const item of group) {
                const old = objects.get(item.id);
                const basis = new Map(old.review.basis.map(basis => [`${basis.kind}:${basis.key}`, basis]));
                for (const next of ledger.basis)
                    if (!(next.kind === "object" && next.key === item.id))
                        basis.set(`${next.kind}:${next.key}`, next);
                objects.set(item.id, { ...old, lifecycle, review: { ...old.review, basis: [...basis.values()], evidenceIds: [...new Set([...old.review.evidenceIds, ...item.evidenceIds])] } });
                touched.add(item.id);
            }
        const changed = [];
        for (const id of touched) {
            const next = objects.get(id), old = this.store.object(id);
            const basis = next.review.basis.map(item => item.kind === "object" && touched.has(item.key) ? { ...item, version: String(objects.get(item.key).contentRev) } : item);
            next.review = { ...next.review, basis: basis.sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b))), evidenceIds: [...new Set(next.review.evidenceIds)].sort(), scopeIds: [...new Set(next.review.scopeIds)].sort() };
            const stateChanged = !old || canonicalJson({ body: old.body, review: old.review, lifecycle: old.lifecycle }) !== canonicalJson({ body: next.body, review: next.review, lifecycle: next.lifecycle });
            next.recordRev = (old?.recordRev ?? 0) + Number(stateChanged);
            if (stateChanged)
                changed.push(next);
        }
        const sourceIds = new Set([...ledger.sourceRefs.map(ref => ref.id)]);
        for (const object of objects.values()) {
            if (object.kind === "edge" && "target" in object.body && "sourceRefId" in object.body.target && this.store.source(object.body.target.sourceRefId, ledger.owner.workspaceId))
                sourceIds.add(object.body.target.sourceRefId);
        }
        validateGraph(objects, sourceIds);
        for (const id of [...proposal.result.selection.objectIds, ...proposal.result.selection.knowledgeIds])
            requireIndex(objects.get(id)?.lifecycle === "active" && (touched.has(id) || view.allowed(id)), "INVALID_PROPOSAL", "结果引用不可用对象。");
        for (const id of proposal.result.selection.knowledgeIds)
            requireIndex(objects.get(id)?.kind === "knowledge", "INVALID_PROPOSAL", "知识选择必须引用知识对象。");
        for (const location of proposal.result.selection.locations)
            if (location.symbolId) {
                const symbol = objects.get(location.symbolId), ref = ledger.sourceRefs.find(ref => ref.id === location.sourceRefId);
                requireIndex(symbol?.kind === "symbol" && symbol.lifecycle === "active" && symbol.filePath === ref?.path && view.allowed(symbol.id), "INVALID_PROPOSAL", "结果符号与来源不一致。");
            }
        for (const ids of proposal.result.selection.featurePaths) {
            requireIndex(ids.every(id => objects.get(id)?.kind === "feature" && objects.get(id)?.lifecycle === "active" && (touched.has(id) || view.allowed(id))), "INVALID_PROPOSAL", "功能路径引用无效。");
            for (let i = 1; i < ids.length; i++)
                requireIndex([...objects.values()].some(object => { const edge = object.body; return object.kind === "edge" && object.lifecycle === "active" && edge.relation === "contains" && edge.fromId === ids[i - 1] && "objectId" in edge.target && edge.target.objectId === ids[i]; }), "INVALID_PROPOSAL", "功能路径缺少已提交组织关系。");
        }
        return { objects, changed, idMap, proposal };
    }
    async replay(requestId, owner, proposalDigest, signal) {
        const submission = this.store.submission(requestId);
        if (!submission)
            return null;
        requireIndex(submission.proposalDigest === proposalDigest && canonicalJson(submission.owner) === canonicalJson(owner), "ACCESS_DENIED", "提交标识不属于当前请求或提案。");
        const snapshot = await this.sources.reconcile(signal);
        return this.disclose(submission, snapshot);
    }
    disclose(submission, snapshot) {
        const view = snapshot && new AuthorizedReadView(this.store, this.sources.policy, snapshot, submission.owner.workspaceId);
        const selection = submission.outcome.result.selection;
        const visible = view && view.basisAllowed(submission.outcome.basis)
            && [...selection.objectIds, ...selection.knowledgeIds, ...selection.featurePaths.flat(), ...selection.locations.flatMap(location => location.symbolId ? [location.symbolId] : [])].every(id => !!view.get(id))
            && Object.values(submission.outcome.idMap).every(id => view.allowed(id))
            && selection.locations.every(location => !!view.source(location.sourceRefId))
            && [...submission.outcome.result.coverage.scopeIds, ...submission.outcome.result.searchedScopeIds].every(id => view.scopeAllowed(id));
        const receipt = { requestId: submission.requestId, proposalDigest: submission.proposalDigest, committedAt: submission.committedAt };
        if (!visible)
            return { receipt, idMap: {}, objectRevisions: [], freshness: "stale", disclosure: "restricted", result: { status: "partial", selection: { objectIds: [], knowledgeIds: [], featurePaths: [], locations: [] }, searchedScopeIds: [], coverage: { mode: "partial", scopeIds: [], gaps: [{ code: "access_unavailable", description: "当前来源或授权不足，部分历史结果无法重新披露。" }] } } };
        const current = this.submissionCurrent(submission, snapshot), result = structuredClone(submission.outcome.result);
        if (!current) {
            result.status = "partial";
            result.coverage.mode = "partial";
            result.coverage.gaps.push({ code: "basis_changed", description: "提交依据已经变化，结果需要重新核验。" });
        }
        return { receipt, result, idMap: { ...submission.outcome.idMap }, objectRevisions: structuredClone(submission.outcome.objectRevisions), freshness: current ? "current" : "stale", disclosure: "complete" };
    }
    submissionCurrent(submission, snapshot) {
        const view = new AuthorizedReadView(this.store, this.sources.policy, snapshot, submission.owner.workspaceId);
        const basisValid = submission.outcome.basis.every(basis => {
            if (basis.kind === "context")
                return basis.version === (basis.key === "policy" ? snapshot.policyHash : snapshot.analysisContextHash);
            if (basis.kind === "file")
                return view.pathAllowed(basis.key) && snapshot.files.get(basis.key)?.contentHash === basis.version;
            if (basis.kind === "scope")
                return snapshot.scopes.find(scope => scope.id === basis.key)?.contentDigest === basis.version;
            return String(view.get(basis.key)?.contentRev) === basis.version && view.freshness(basis.key) === "current";
        });
        return basisValid && submission.outcome.objectRevisions.every(revision => {
            const object = view.get(revision.id);
            return object?.contentRev === revision.contentRev && object.recordRev === revision.recordRev && view.freshness(object.id) === "current";
        }) && submission.outcome.result.selection.locations.every(location => {
            const ref = view.source(location.sourceRefId);
            return ref && snapshot.files.get(ref.path)?.contentHash === ref.contentHash;
        });
    }
    async commit(ledgerId, proposalDigest, admit, signal) {
        const ledger = this.sources.ledger(ledgerId);
        const replay = await this.replay(ledger.requestId, ledger.owner, proposalDigest, signal);
        if (replay)
            return replay;
        const frozen = this.frozen(ledger, proposalDigest), snapshot = await this.sources.verify(ledger, signal);
        this.validateEvidence(frozen.proposal, ledger, snapshot);
        this.build(frozen.proposal, ledger, snapshot);
        signal?.throwIfAborted();
        await admit();
        const submission = this.store.transaction(() => {
            // No filesystem reads, IPC or model calls can occur in this transaction.
            signal?.throwIfAborted();
            this.sources.ledger(ledgerId);
            const prior = this.store.submission(ledger.requestId);
            if (prior) {
                requireIndex(prior.proposalDigest === proposalDigest && canonicalJson(prior.owner) === canonicalJson(ledger.owner), "ACCESS_DENIED", "提交标识冲突。");
                return prior;
            }
            this.frozen(ledger, proposalDigest);
            this.sources.verifyStored(ledger);
            const final = this.build(frozen.proposal, ledger, snapshot, true);
            const lifecycleChanges = ([...final.proposal.retire.map(item => ({ ...item, action: "retire" })), ...final.proposal.reactivate.map(item => ({ ...item, action: "reactivate" }))]).map(item => ({ id: item.id, action: item.action, reason: item.reason, evidenceIds: item.evidenceIds, before: revision(this.store.object(item.id)), after: revision(final.objects.get(item.id)) }));
            for (const ref of ledger.sourceRefs)
                this.store.putSource(ref);
            for (const record of ledger.evidence)
                this.store.putEvidence(record, ledger.evidenceSources.find(item => item.evidenceId === record.id)?.paths ?? []);
            for (const object of final.changed)
                this.store.putObject(object);
            for (const object of final.changed)
                if (object.kind === "edge") {
                    const edge = object.body;
                    this.store.putLink({ id: object.id, fromId: edge.fromId, target: edge.target, relation: edge.relation, slot: edge.slot });
                }
            for (const object of final.changed)
                this.store.putTerms(object.id, objectTerms(object));
            if (final.changed.length)
                this.store.advance("semantic");
            const selection = final.proposal.result.selection;
            const selected = new Set([...selection.objectIds, ...selection.knowledgeIds, ...selection.featurePaths.flat(), ...selection.locations.flatMap(location => location.symbolId ? [location.symbolId] : [])]);
            for (const ids of selection.featurePaths)
                for (let i = 1; i < ids.length; i++)
                    for (const object of final.objects.values()) {
                        const edge = object.body;
                        if (object.kind === "edge" && object.lifecycle === "active" && edge.relation === "contains" && edge.fromId === ids[i - 1] && "objectId" in edge.target && edge.target.objectId === ids[i])
                            selected.add(object.id);
                    }
            const basis = ledger.basis.filter(item => item.kind !== "object" || !final.changed.some(object => object.id === item.key));
            const result = { requestId: ledger.requestId, proposalDigest, owner: ledger.owner, outcome: { result: final.proposal.result, objectRevisions: [...final.objects.values()].filter(object => selected.has(object.id)).map(revision), idMap: final.idMap, basis, lifecycleChanges }, committedAt: Date.now() };
            this.store.putSubmission(result);
            return result;
        });
        this.accepted.delete(ledgerId);
        // The durable commit remains valid even if later external edits invalidate the answer.
        try {
            const current = await this.sources.verify({ ...ledger, basis: ledger.basis.filter(basis => basis.kind !== "object") }, signal);
            return this.disclose(submission, current);
        }
        catch {
            return this.disclose(submission, null);
        }
    }
}
//# sourceMappingURL=commit.js.map