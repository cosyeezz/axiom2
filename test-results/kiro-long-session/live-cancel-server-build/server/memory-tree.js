import { createHash, randomUUID } from "node:crypto";
import { emptyMemoryTree, memoryBatchSize, memoryBatchWaitMs, memoryContextPurposeLimit, memoryTopicBlock } from "../shared/memory-tree.js";
import { memoryPurposes } from "../shared/memory-purposes.js";
import { canonicalMemoryPurpose, locateMemoryPurpose } from "../shared/memory-purpose-locator.js";
import { AppError } from "../shared/protocol.js";
import { processingError } from "./processing-records.js";
import { MemoryNodeStore } from "./memory-nodes.js";
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
export class MemoryTreeStore {
    store;
    nodes;
    constructor(store) {
        this.store = store;
        // Keep the original purpose queue and organizer projection for compatibility.
        store.db.exec(`CREATE TABLE IF NOT EXISTS memory_purposes(
      id TEXT PRIMARY KEY,workspaceId TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      sessionId TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,sourceKey TEXT NOT NULL,
      queuedAt INTEGER NOT NULL,processedAt INTEGER,retryAfter INTEGER NOT NULL DEFAULT 0,
      blocked INTEGER NOT NULL DEFAULT 0,error TEXT,body TEXT NOT NULL,UNIQUE(sessionId,sourceKey));
      CREATE INDEX IF NOT EXISTS memory_purposes_pending ON memory_purposes(workspaceId,processedAt,blocked,retryAfter,queuedAt);
      CREATE TABLE IF NOT EXISTS memory_purpose_indexes(workspaceId TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,body TEXT NOT NULL);`);
        this.nodes = new MemoryNodeStore(store);
        // Metadata-only backfill: never scan source files on a query or constructor.
        // The normal successful source scan supplies actual document references.
        for (const row of store.db.prepare("SELECT workspaceId,body FROM memory_purpose_indexes").all()) {
            const workspaceId = String(row.workspaceId);
            if (this.nodes.initialized(workspaceId))
                continue;
            store.db.exec("BEGIN IMMEDIATE");
            try {
                this.nodes.publish(JSON.parse(String(row.body)), workspaceId);
                store.db.exec("COMMIT");
            }
            catch (error) {
                store.db.exec("ROLLBACK");
                throw error;
            }
        }
    }
    nodeSnapshot(workspaceId) {
        return this.nodes.snapshot(workspaceId, this.snapshot(workspaceId));
    }
    /** Runs before applyScan's unchanged fast path, including already-known goals. */
    syncDocuments(scope, entry, files) {
        this.store.db.exec("BEGIN IMMEDIATE");
        try {
            const previous = this.snapshot(scope.workspaceId), live = this.entries(scope.workspaceId).filter(purpose => !purpose.blocked);
            const changed = this.nodes.syncSource(scope, entry, files, live);
            const published = new Set(previous.purposes.map(purpose => purpose.id));
            const refresh = changed.some(id => published.has(id));
            if (refresh) {
                const next = { ...previous, version: previous.version + 1 };
                this.store.db.prepare("UPDATE memory_purpose_indexes SET version=?,body=? WHERE workspaceId=?").run(next.version, JSON.stringify(next), scope.workspaceId);
                this.nodes.publish(next, scope.workspaceId);
            }
            this.store.db.exec("COMMIT");
            return refresh;
        }
        catch (error) {
            this.store.db.exec("ROLLBACK");
            throw error;
        }
    }
    /** Keep derived leaves coherent with a completed source scan, never during a query.
     * Raw task titles/files are immutable here; revoked IDs remain available for safe reuse.
     */
    reconcile(scope, entry) {
        const headings = memoryPurposes(entry), existing = this.entries(scope.workspaceId).filter(purpose => purpose.source.sessionId === scope.sessionId);
        const invalid = existing.filter(purpose => {
            const heading = locateMemoryPurpose(purpose, headings, existing);
            const duplicate = canonicalMemoryPurpose(purpose, existing) !== purpose || heading && purpose.source.key !== heading.key && existing.some(other => other.source.key === heading.key && other.text === heading.title);
            return (!heading?.complete || duplicate) && (purpose.processedAt !== null || !purpose.blocked);
        });
        if (!invalid.length)
            return false;
        this.revoke(scope.sessionId, invalid.map(purpose => purpose.source.key));
        return true;
    }
    enqueue(scope, entry, now = Date.now()) {
        const headings = memoryPurposes(entry);
        const existing = this.entries(scope.workspaceId).filter(purpose => purpose.source.sessionId === scope.sessionId);
        const insert = this.store.db.prepare(`INSERT OR IGNORE INTO memory_purposes(id,workspaceId,sessionId,sourceKey,queuedAt,body) VALUES(?,?,?,?,?,?)`);
        let added = 0;
        for (const [index, heading] of headings.entries()) {
            if (!heading.complete)
                continue;
            const prior = existing.find(purpose => purpose.source.key === heading.key) ?? existing.find(purpose => canonicalMemoryPurpose(purpose, existing) === purpose && locateMemoryPurpose(purpose, headings, existing)?.key === heading.key);
            if (prior) {
                // Explicit correction or a temporarily invalid locator keeps the same ID.
                if (prior.blocked && prior.processedAt === null)
                    added += Number(this.store.db.prepare("UPDATE memory_purposes SET blocked=0,error=NULL,retryAfter=0 WHERE id=?").run(prior.id).changes);
                continue;
            }
            const context = headings.map((other, position) => ({ other, distance: Math.abs(position - index), position }))
                .filter(({ position }) => position !== index).sort((a, b) => a.distance - b.distance || a.position - b.position)
                .slice(0, memoryContextPurposeLimit).sort((a, b) => a.position - b.position)
                .map(({ other }) => ({ text: other.title, state: other.state }));
            // IDs are independent of labels, file paths and model output. Stable source
            // bindings survive state changes and descendant additions and service restarts. Goal titles
            // are immutable in the task-tree contract; no rename guessing is attempted.
            const purpose = { id: `p-${randomUUID()}`, text: heading.title,
                source: { sessionId: scope.sessionId, path: "MEMORY.md", key: heading.key }, context };
            added += Number(insert.run(purpose.id, scope.workspaceId, scope.sessionId, heading.key, now, JSON.stringify(purpose)).changes);
        }
        return added;
    }
    entries(workspaceId) {
        return this.store.db.prepare(`SELECT p.* FROM memory_purposes p JOIN sessions s ON s.id=p.sessionId
      WHERE p.workspaceId=? AND NOT EXISTS(SELECT 1 FROM tasks t WHERE t.sessionId=s.id) ORDER BY p.queuedAt,p.rowid`).all(workspaceId)
            .map(row => ({ ...JSON.parse(String(row.body)), workspaceId, queuedAt: Number(row.queuedAt),
            processedAt: row.processedAt === null ? null : Number(row.processedAt), retryAfter: Number(row.retryAfter),
            blocked: !!row.blocked, ...(row.error ? { error: String(row.error) } : {}) }));
    }
    batch(workspaceId, now = Date.now()) {
        const pending = this.entries(workspaceId).filter(purpose => purpose.processedAt === null && !purpose.blocked && purpose.retryAfter <= now);
        if (pending.length < memoryBatchSize && (!pending.length || now - pending[0].queuedAt < memoryBatchWaitMs))
            return [];
        return pending.slice(0, memoryBatchSize);
    }
    snapshot(workspaceId) {
        const row = this.store.db.prepare("SELECT body FROM memory_purpose_indexes WHERE workspaceId=?").get(workspaceId);
        return row ? JSON.parse(String(row.body)) : emptyMemoryTree();
    }
    tree(workspaceId, now = Date.now(), activeIds = []) {
        const pending = this.entries(workspaceId).filter(purpose => purpose.processedAt === null), active = new Set(activeIds);
        const waiting = pending.filter(purpose => !active.has(purpose.id));
        const eligible = waiting.filter(purpose => !purpose.blocked && purpose.retryAfter <= now), backoff = waiting.filter(purpose => !purpose.blocked && purpose.retryAfter > now);
        return { ...this.nodeSnapshot(workspaceId), pending: pending.filter(purpose => !purpose.blocked).length, failed: pending.filter(purpose => purpose.error).length,
            queue: { waiting: waiting.length, eligible: eligible.length, backoff: backoff.length, blocked: waiting.filter(purpose => purpose.blocked).length,
                oldestQueuedAt: eligible[0]?.queuedAt ?? null,
                nextBatchAt: eligible.length >= memoryBatchSize ? now : eligible.length ? eligible[0].queuedAt + memoryBatchWaitMs : null,
                retryAt: backoff.length ? Math.min(...backoff.map(purpose => purpose.retryAfter)) : null } };
    }
    /** Validate the whole proposed tree and bind every leaf ourselves. No lossy truncation. */
    classify(answer, purposes) {
        const value = JSON.parse(answer), remaining = new Map(purposes.map(purpose => [purpose.id, purpose]));
        let count = 0;
        const visit = (input, path, depth) => {
            if (++count > 100_000 || depth > 64 || !input || typeof input !== "object" || Array.isArray(input))
                throw Error("分类树结构无效或过深");
            const node = input, keys = Object.keys(node).sort().join(",");
            if (keys === "purposeId") {
                if (!depth || typeof node.purposeId !== "string" || !remaining.has(node.purposeId))
                    throw Error("目的ID缺失、重复或越界");
                const purpose = remaining.get(node.purposeId);
                remaining.delete(purpose.id);
                return { id: purpose.id, name: purpose.text, purposeId: purpose.id, children: [] };
            }
            if (keys !== "children,name" || typeof node.name !== "string" || !/^[\p{Script=Han}A-Za-z]+$/u.test(node.name) ||
                ["其他", "通用", "未分类", "优化", "处理", "开发"].includes(node.name.trim()) || !Array.isArray(node.children) || !node.children.length)
                throw Error("目录必须名称具体且包含子节点；不能返回来源信息或四字段记录");
            const name = node.name.trim(), current = [...path, name];
            const children = node.children.map(child => visit(child, current, depth + 1));
            if (new Set(children.filter(child => !child.purposeId).map(child => child.name)).size !== children.filter(child => !child.purposeId).length)
                throw Error("同级目录名称重复");
            return { id: `d-${hash(current)}`, name, children };
        };
        if (!Array.isArray(value) || (!value.length && purposes.length))
            throw Error("分类结果必须是完整目录JSON数组");
        const roots = value.map(node => visit(node, [], 0));
        if (new Set(roots.map(root => root.name)).size !== roots.length || remaining.size)
            throw Error("分类结果遗漏目的或目录重复");
        memoryTopicBlock(roots);
        return roots;
    }
    modelTree(roots) {
        return roots.map(node => node.purposeId ? { purposeId: node.purposeId } : { name: node.name, children: this.modelTree(node.children) });
    }
    publish(workspaceId, batch, roots, expectedVersion, recordApplied) {
        this.store.db.exec("BEGIN IMMEDIATE");
        try {
            const previous = this.snapshot(workspaceId);
            if (previous.version !== expectedVersion)
                throw new AppError("REVISION_CONFLICT", "记忆索引已变化，未发布旧分类");
            const live = new Map(this.entries(workspaceId).map(purpose => [purpose.id, purpose]));
            if (batch.some(purpose => !live.has(purpose.id) || live.get(purpose.id).processedAt !== null || live.get(purpose.id).blocked))
                throw new AppError("REVISION_CONFLICT", "目的队列已失效，未发布旧分类");
            const purposes = [...previous.purposes, ...batch.map(({ id, text, source }) => ({ id, text, source }))];
            const tree = { version: previous.version + 1, roots, purposes,
                nameChars: Array.from(roots.map(root => root.name).join("\n")).length, pending: 0, failed: 0 };
            this.store.db.prepare(`INSERT INTO memory_purpose_indexes VALUES(?,?,?) ON CONFLICT(workspaceId) DO UPDATE SET version=excluded.version,body=excluded.body`)
                .run(workspaceId, tree.version, JSON.stringify(tree));
            const update = this.store.db.prepare("UPDATE memory_purposes SET processedAt=?,error=NULL,retryAfter=0 WHERE id=? AND processedAt IS NULL AND blocked=0");
            for (const purpose of batch)
                if (!update.run(Date.now(), purpose.id).changes)
                    throw new AppError("REVISION_CONFLICT", "目的已被其他整理领取");
            this.nodes.publish(tree, workspaceId);
            // This callback must remain synchronous: the original queue/index transaction
            // also commits its diagnostic application fact before returning to the event loop.
            recordApplied?.();
            this.store.db.exec("COMMIT");
        }
        catch (error) {
            this.store.db.exec("ROLLBACK");
            throw error;
        }
    }
    failure(batch, error) {
        const update = this.store.db.prepare("UPDATE memory_purposes SET error=?,retryAfter=? WHERE id=? AND processedAt IS NULL AND blocked=0");
        for (const purpose of batch)
            update.run(processingError(error instanceof Error ? error : "批分类失败").slice(0, 1000), Date.now() + 60_000, purpose.id);
    }
    suspend(purpose, error) {
        this.store.db.prepare("UPDATE memory_purposes SET blocked=1,error=? WHERE id=? AND processedAt IS NULL")
            .run(processingError(error instanceof Error ? error : "目的定位失效"), purpose.id);
    }
    /** Revoke affected derived leaves atomically before correcting raw bytes.
     * A crash cannot leave a stale published leaf; a later valid scan reuses IDs. */
    revoke(sessionId, keys) {
        this.store.db.exec("BEGIN IMMEDIATE");
        try {
            const rows = this.store.db.prepare("SELECT DISTINCT workspaceId FROM memory_purposes WHERE sessionId=?").all(sessionId);
            for (const row of rows) {
                const workspaceId = String(row.workspaceId), old = this.snapshot(workspaceId);
                const affected = this.entries(workspaceId).filter(purpose => purpose.source.sessionId === sessionId && (!keys || keys.includes(purpose.source.key)));
                if (!affected.length)
                    continue;
                const ids = new Set(affected.map(purpose => purpose.id));
                const update = this.store.db.prepare("UPDATE memory_purposes SET blocked=1,processedAt=NULL,error=NULL WHERE id=?");
                for (const id of ids)
                    update.run(id);
                const prune = (nodes) => nodes.flatMap(node => {
                    if (node.purposeId)
                        return ids.has(node.purposeId) ? [] : [node];
                    const children = prune(node.children);
                    return children.length ? [{ ...node, children }] : [];
                });
                const roots = prune(old.roots), next = { ...old, version: old.version + 1, roots,
                    purposes: old.purposes.filter(purpose => !ids.has(purpose.id)), nameChars: Array.from(roots.map(root => root.name).join("\n")).length };
                this.store.db.prepare(`INSERT INTO memory_purpose_indexes VALUES(?,?,?) ON CONFLICT(workspaceId) DO UPDATE SET version=excluded.version,body=excluded.body`).run(workspaceId, next.version, JSON.stringify(next));
                this.nodes.publish(next, workspaceId);
            }
            this.store.db.exec("COMMIT");
        }
        catch (error) {
            this.store.db.exec("ROLLBACK");
            throw error;
        }
    }
}
//# sourceMappingURL=memory-tree.js.map