import { randomUUID } from "node:crypto";
import { canonicalJson, digest } from "../domain/json.js";
import { parseQuery } from "../domain/schema.js";
import { requireIndex } from "../domain/errors.js";
import { evidenceIds, searchTerms } from "../domain/semantic.js";
import { AuthorizedReadView } from "./authorized-view.js";
export class IndexQuery {
    store;
    sources;
    cursors = new Map();
    constructor(store, sources) {
        this.store = store;
        this.sources = sources;
    }
    view(snapshot, workspaceId) { return new AuthorizedReadView(this.store, this.sources.policy, snapshot, workspaceId); }
    async query(ledgerId, input, signal) {
        const checked = parseQuery(input);
        return this.sources.withLedger(ledgerId, async (ledger) => {
            const snapshot = await this.sources.reconcile(signal);
            this.sources.verifyStored(ledger);
            const view = this.view(snapshot, ledger.owner.workspaceId), { cursor: supplied, ...parameters } = checked;
            const binding = digest(parameters), identity = digest({ ...this.store.epochs(), policy: snapshot.policyHash, context: snapshot.analysisContextHash });
            let offset = 0;
            if (supplied) {
                const cursor = this.cursors.get(supplied);
                requireIndex(cursor && cursor.expiresAt > Date.now() && cursor.ledgerId === ledgerId && cursor.binding === binding && cursor.snapshot === identity, "SNAPSHOT_EXPIRED", "索引查询分页已失效。");
                offset = cursor.offset;
            }
            const seeds = new Set(checked.ids ?? []), selected = new Set(seeds), words = searchTerms(checked.query ?? "");
            const scores = new Map(this.store.terms(words).map(item => [item.id, item.score]));
            for (const object of view.objects.values())
                if (object.kind === "symbol") {
                    const haystack = `${object.name} ${object.filePath ?? ""}`.toLowerCase();
                    const score = words.reduce((sum, word) => sum + Number(haystack.includes(word)) * 4, 0);
                    if (score)
                        scores.set(object.id, score);
                }
            for (const link of this.store.links()) {
                const neighbor = checked.direction === "incoming" ? "objectId" in link.target && seeds.has(link.target.objectId) : seeds.has(link.fromId);
                if (neighbor && view.allowed(link.id)) {
                    selected.add(link.id);
                    if (checked.direction === "incoming")
                        selected.add(link.fromId);
                    else if ("objectId" in link.target)
                        selected.add(link.target.objectId);
                }
            }
            const scopeIds = new Set(checked.scopeIds ?? []);
            const candidates = [...view.objects.values()].filter(object => view.allowed(object.id)
                && (!scopeIds.size || object.review.scopeIds.some(id => scopeIds.has(id)))
                && (!checked.ids?.length && !checked.query || selected.has(object.id) || scores.has(object.id)))
                .sort((a, b) => Number(selected.has(b.id)) - Number(selected.has(a.id)) || (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0) || a.id.localeCompare(b.id));
            const scopes = this.store.scopes().filter(scope => scope.members.length ? scope.members.every(member => view.pathAllowed(member.path)) : scope.definition.include.every(pattern => pattern === "**/*"));
            const result = { readToken: this.sources.token(ledger, snapshot), objects: [], evidence: [], sourceRefs: [], scopes: scopes.map(scope => ({ id: scope.id, definition: scope.definition, definitionHash: scope.definitionHash })), coverage: { mode: "partial", scopeIds: scopes.map(scope => scope.id), gaps: snapshot.gaps } };
            requireIndex(Buffer.byteLength(canonicalJson(result)) < 60_000, "BUDGET_EXCEEDED", "范围元数据超过查询页限额。");
            let next = offset;
            while (next < candidates.length && result.objects.length < 50) {
                const object = candidates[next], page = structuredClone(result);
                page.objects.push({ id: object.id, kind: object.kind, name: object.name, lifecycle: object.lifecycle, contentRev: object.contentRev, recordRev: object.recordRev, freshness: view.freshness(object.id), body: object.body });
                this.references(page, object, view);
                if (Buffer.byteLength(canonicalJson(page)) > 63_000)
                    break;
                Object.assign(result, page);
                this.sources.recordObject(ledger, object);
                next++;
            }
            requireIndex(next > offset || next === candidates.length, "BUDGET_EXCEEDED", "对象无法装入查询页；未截断事实正文。");
            if (next < candidates.length) {
                for (const [key, cursor] of this.cursors)
                    if (cursor.expiresAt <= Date.now())
                        this.cursors.delete(key);
                requireIndex(this.cursors.size < 2048, "BUDGET_EXCEEDED", "索引查询游标达到上限。");
                const cursor = randomUUID();
                this.cursors.set(cursor, { ledgerId, binding, snapshot: identity, offset: next, expiresAt: ledger.expiresAt });
                result.nextCursor = cursor;
            }
            requireIndex(Buffer.byteLength(canonicalJson(result)) <= 65_536, "BUDGET_EXCEEDED", "索引查询页超过限额。");
            return result;
        }, signal);
    }
    references(result, object, view) {
        const sourceIds = new Set();
        for (const id of new Set([...evidenceIds(object), ...object.review.evidenceIds])) {
            const record = this.store.evidence(id)?.record;
            if (!record)
                continue;
            if (!result.evidence.some(evidence => evidence.id === id))
                result.evidence.push(record);
            if (record.kind === "source_range")
                sourceIds.add(record.sourceRefId);
        }
        if ("sourceRefId" in object.body)
            sourceIds.add(object.body.sourceRefId);
        if ("authoritySourceIds" in object.body)
            for (const id of object.body.authoritySourceIds)
                sourceIds.add(id);
        if ("target" in object.body && "sourceRefId" in object.body.target)
            sourceIds.add(object.body.target.sourceRefId);
        for (const id of sourceIds) {
            const ref = view.source(id);
            if (ref && !result.sourceRefs.some(source => source.id === id))
                result.sourceRefs.push(ref);
        }
    }
    close() { this.cursors.clear(); }
}
//# sourceMappingURL=query.js.map