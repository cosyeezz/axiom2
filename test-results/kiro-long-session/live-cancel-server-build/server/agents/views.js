import { statSync } from "node:fs";
import { historyProjection } from "../history-projection.js";
import { AppError, scopeKey } from "../../shared/protocol.js";
import { agentScope, threadScope, messageScope, readRunOrigin, } from "../../shared/agent.js";
import { threadDelivery, threadGroups } from "../../shared/thread-layout.js";
import { contextUsage } from "../context-usage.js";
import { lastRequestUsage } from "../request-usage.js";
import { memoryDirectory } from "../memory-files.js";
import { Lru } from "../../shared/lru.js";
import { boundedMessage, openTranscript, transcriptMessages, transcriptEntries, transcriptImage, } from "../transcript.js";
export class AgentViews {
    store;
    publish;
    observed;
    constructor(store, publish, observed = () => true) {
        this.store = store;
        this.publish = publish;
        this.observed = observed;
    }
    messages = new Lru(5);
    // In-flight deltas are execution state, not an idle history cache. They cannot
    // be reconstructed from JSONL until pi finalizes them.
    transient = new Map();
    contextRevision = new Map();
    layouts = new WeakMap();
    originals = new Lru(5);
    originalCleanup;
    histories = new Lru(5);
    counts = new Lru(256);
    countChanges = new Set();
    timers = new Map();
    changedMessages = new Map();
    queues = new Map();
    owner(scope) {
        return this.store.session(scope.workspaceId, scope.sessionId);
    }
    origins(scope) {
        return new Map(this.store.db.prepare("SELECT id,origin FROM runs WHERE sessionId=? AND origin IS NOT NULL").all(scope.sessionId)
            .flatMap(row => { const origin = readRunOrigin(row.origin); return origin ? [[String(row.id), origin]] : []; }));
    }
    source(scope, message, origins) {
        const origin = message.runId ? origins ? origins.get(message.runId)
            : readRunOrigin(this.store.db.prepare("SELECT origin FROM runs WHERE id=? AND sessionId=?").get(message.runId, scope.sessionId)?.origin) : undefined;
        return origin || message.runOrigin ? { ...message, runOrigin: origin } : message;
    }
    info(scope) {
        this.owner(scope);
        const row = this.store.db
            .prepare("SELECT * FROM agent_sessions WHERE sessionId=?")
            .get(scope.sessionId);
        const run = this.store.db
            .prepare("SELECT * FROM runs WHERE sessionId=? ORDER BY startedAt DESC,rowid DESC LIMIT 1")
            .get(scope.sessionId);
        const task = this.store.db
            .prepare("SELECT id,parentSessionId,status FROM tasks WHERE sessionId=?")
            .get(scope.sessionId);
        const usage = row?.usage ? JSON.parse(String(row.usage)) : null;
        // Recover older snapshots from native history, never from cumulative totals.
        // Missing/unreadable history stays unknown and this read does not write it.
        if (usage && row?.file && (usage.lastRequest === undefined || (usage.context && usage.context.tokens == null))) {
            try {
                const manager = openTranscript(String(row.file), this.store.workspace(scope.workspaceId).path, { readOnly: true });
                if (usage.lastRequest === undefined)
                    usage.lastRequest = lastRequestUsage(manager);
                if (usage.context && usage.context.tokens == null)
                    usage.context = contextUsage(manager, usage.context);
            }
            catch { /* Keep the original unknown reading. */ }
        }
        return {
            ...(task
                ? { task: task }
                : {}),
            activeTaskCount: Number(this.store.db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE parentSessionId=? AND status IN ('queued','starting','running','stopping')").get(scope.sessionId)?.n ?? 0),
            queue: this.queues.get(scope.sessionId) ?? [],
            selection: row?.selection ? JSON.parse(String(row.selection)) : null,
            memoryDirectory: task ? null : memoryDirectory(this.store.root, scope.sessionId),
            environment: row?.environment
                ? JSON.parse(String(row.environment))
                : null,
            usage,
            completedRunDurationMs: Number(this.store.db.prepare("SELECT COALESCE(SUM(MAX(0,endedAt-startedAt)),0) AS ms FROM runs WHERE sessionId=? AND endedAt IS NOT NULL").get(scope.sessionId).ms),
            run: run
                ? {
                    ...run,
                    selection: JSON.parse(String(run.selection)),
                    retry: run.retry ? JSON.parse(String(run.retry)) : null,
                    origin: readRunOrigin(run.origin),
                }
                : null,
        };
    }
    transcript(scope) {
        this.owner(scope);
        let messages = this.messages.get(scope.sessionId);
        if (!messages) {
            const row = this.store.db
                .prepare("SELECT file FROM agent_sessions WHERE sessionId=?")
                .get(scope.sessionId);
            const manager = row?.file
                ? openTranscript(String(row.file), this.store.workspace(scope.workspaceId).path, { readOnly: true })
                : null;
            const origins = this.origins(scope);
            const list = manager ? transcriptMessages(manager).map(message => this.source(scope, message, origins)) : [];
            messages = new Map(list.map((m) => [m.id, m]));
            for (const [id, message] of this.transient.get(scope.sessionId) ?? [])
                messages.set(id, message);
            this.messages.set(scope.sessionId, messages);
        }
        return messages;
    }
    thread(scope) {
        const owner = this.owner(scope);
        try {
            const projection = this.transcript(scope);
            let layout = this.layouts.get(projection);
            if (!layout) {
                const messages = [...projection.values()];
                layout = { ids: messages.map((message) => message.id), groups: threadGroups(messages) };
                this.layouts.set(projection, layout);
            }
            const run = this.store.db.prepare("SELECT id,status,phase FROM runs WHERE sessionId=? ORDER BY startedAt DESC,rowid DESC LIMIT 1").get(scope.sessionId);
            return {
                contextRevision: this.contextRevision.get(scope.sessionId) ?? 0,
                runId: run ? String(run.id) : undefined,
                runStatus: run?.status,
                runPhase: run?.phase,
                resultVersion: owner.resultVersion,
                readVersion: owner.readVersion,
                resultTasks: this.store.db.prepare("SELECT t.taskId,t.id AS resultId FROM session_results e JOIN task_results t ON t.id=e.sourceId WHERE e.sessionId=? AND e.kind='task' AND e.version>? AND t.delivery!='discarded'").all(scope.sessionId, owner.readVersion ?? 0),
                ...layout,
            };
        }
        catch (e) {
            return { ids: [], groups: [], error: e.message };
        }
    }
    messageCount(scope) {
        try {
            const row = this.store.db.prepare("SELECT file FROM agent_sessions WHERE sessionId=?").get(scope.sessionId);
            const file = row?.file ? String(row.file) : null;
            const stat = file ? statSync(file, { bigint: true }) : null;
            const source = `${file}:${stat?.dev}:${stat?.ino}:${stat?.size}:${stat?.mtimeNs}:${stat?.ctimeNs}:${this.contextRevision.get(scope.sessionId) ?? 0}`;
            let saved = this.counts.get(scope.sessionId);
            if (saved?.source !== source) {
                const entries = file ? transcriptEntries(openTranscript(file, this.store.workspace(scope.workspaceId).path, { readOnly: true }), true) : [];
                const ids = new Set(entries.filter(({ message }) => message.role === "user" || message.role === "assistant" ||
                    message.role === "custom" && message.customType === "axiom-append").map(entry => entry.id));
                saved = { source, ids };
                this.counts.set(scope.sessionId, saved);
            }
            let count = saved.ids.size;
            for (const [id, message] of this.transient.get(scope.sessionId) ?? [])
                if (!saved.ids.has(id) && (message.role === "user" || message.role === "assistant"))
                    count++;
            return count;
        }
        catch {
            return undefined;
        } // Unreadable history is unknown, not an empty conversation.
    }
    original(scope) {
        this.owner(scope);
        const row = this.store.db.prepare("SELECT file FROM agent_sessions WHERE sessionId=?").get(scope.sessionId);
        const file = row?.file ? String(row.file) : null;
        const stat = file ? statSync(file, { bigint: true }) : null;
        const source = `${file}:${stat?.dev}:${stat?.ino}:${stat?.size}:${stat?.mtimeNs}:${stat?.ctimeNs}:${this.contextRevision.get(scope.sessionId) ?? 0}`;
        let saved = this.originals.get(scope.sessionId);
        if (saved?.source !== source) {
            const origins = this.origins(scope);
            const list = file ? transcriptMessages(openTranscript(file, this.store.workspace(scope.workspaceId).path, { readOnly: true }), true)
                .map(message => this.source(scope, message, origins)) : [];
            const bytes = list.reduce((total, message) => total + 256 + 2 * (message.id.length + message.text.length +
                (message.thinking?.length ?? 0) + (message.error?.length ?? 0) + (message.calls?.reduce((sum, call) => sum + call.input.length, 0) ?? 0)), 0);
            saved = { source, messages: new Map(list.map((message) => [message.id, message])), bytes };
            // Same-turn reuse has both a five-session and estimated 32 MiB text budget.
            this.originals.delete(scope.sessionId);
            if (bytes <= 32 * 1024 * 1024) {
                while ([...this.originals.values()].reduce((sum, item) => sum + item.bytes, bytes) > 32 * 1024 * 1024)
                    this.originals.delete(this.originals.keys().next().value);
                this.originals.set(scope.sessionId, saved);
            }
            if (!this.originalCleanup)
                this.originalCleanup = setImmediate(() => { this.originals.clear(); this.originalCleanup = undefined; });
        }
        const messages = new Map(saved.messages);
        // Current deltas may precede native persistence; never hydrate the default projection just to overlay them.
        for (const message of this.messages.peek(scope.sessionId)?.values() ?? [])
            if (!message.compression)
                messages.set(message.id, message);
        for (const [id, message] of this.transient.get(scope.sessionId) ?? [])
            messages.set(id, message);
        return messages;
    }
    history(scope) {
        this.owner(scope);
        const row = this.store.db.prepare("SELECT file FROM agent_sessions WHERE sessionId=?").get(scope.sessionId);
        const file = row?.file ? String(row.file) : null;
        if (!file)
            return { index: { revision: "empty", segments: [] }, messages: new Map(), bytes: 0 };
        const stat = statSync(file, { bigint: true });
        const source = `${file}:${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}:${this.contextRevision.get(scope.sessionId) ?? 0}`;
        let saved = this.histories.get(scope.sessionId);
        if (saved?.source !== source) {
            saved = { source, projection: historyProjection(openTranscript(file, this.store.workspace(scope.workspaceId).path, { readOnly: true }), source, this.origins(scope), this.transient.get(scope.sessionId)?.values()) };
            this.histories.delete(scope.sessionId);
            if (saved.projection.bytes <= 32 * 1024 * 1024) {
                while ([...this.histories.values()].reduce((sum, value) => sum + value.projection.bytes, saved.projection.bytes) > 32 * 1024 * 1024)
                    this.histories.delete(this.histories.keys().next().value);
                this.histories.set(scope.sessionId, saved);
            }
        }
        return saved.projection;
    }
    historyIndex(scope) { return this.history(scope).index; }
    historyRead(scope, segmentId, groupId) {
        const projection = this.history(scope);
        const segment = projection.index.segments.find(segment => segment.id === segmentId);
        if (!segment)
            throw new AppError("NOT_FOUND", "历史区间已变化，请重新加载");
        const group = groupId === undefined ? undefined : segment.groups.find(group => group.id === groupId);
        if (groupId !== undefined && !group)
            throw new AppError("NOT_FOUND", "对话分组不属于此区间");
        const ids = new Set(group?.ids ?? [segment.id]);
        for (const id of [...ids])
            for (const call of projection.messages.get(id)?.calls ?? [])
                ids.add(`tool-${call.id}`);
        return { revision: projection.index.revision, messages: [...ids].flatMap(id => {
                // IDs are already validated against this segment's calls; a result delta can precede disk persistence.
                const value = this.current(scope, id) ?? projection.messages.get(id);
                return value ? [boundedMessage(value)] : [];
            }) };
    }
    message(scope, id, full = false) {
        this.owner(scope);
        const value = this.current(scope, id) ?? this.transcript(scope).get(id) ?? (full ? this.history(scope).messages.get(id) : undefined);
        if (!value) {
            if (id.startsWith("tool-"))
                return null;
            throw new AppError("NOT_FOUND", "消息不存在或不属于此会话");
        }
        return full ? value : boundedMessage(value);
    }
    image(scope, messageId, imageId) {
        this.owner(scope);
        const workspace = this.store.workspace(scope.workspaceId);
        if (!workspace.authorized)
            throw new AppError("AUTHORIZATION_REQUIRED", "请先授权工作空间文件访问");
        const row = this.store.db.prepare("SELECT file FROM agent_sessions WHERE sessionId=?").get(scope.sessionId);
        if (!row?.file)
            throw new AppError("NOT_FOUND", "此会话没有已保存图片");
        // No bytes in view caches, subscriptions or persisted command receipts.
        return transcriptImage(openTranscript(String(row.file), workspace.path, { readOnly: true }), messageId, imageId, true);
    }
    changed(scope) {
        if (this.observed(threadScope(scope)))
            this.publish(threadScope(scope), this.thread(scope));
        if (this.observed(agentScope(scope)))
            this.publish(agentScope(scope), this.info(scope));
        this.publish(`sessions:${scope.workspaceId}`);
        this.publish(scopeKey(scope));
    }
    messageChanged(scope, message) {
        this.owner(scope);
        message = this.source(scope, message);
        const messages = this.messages.peek(scope.sessionId) ??
            (this.observed(threadScope(scope)) || this.observed(`messages:${scope.workspaceId}:${scope.sessionId}`) ? this.transcript(scope) : undefined);
        const previous = messages?.get(message.id) ?? this.transient.get(scope.sessionId)?.get(message.id);
        // message_end precedes native persistence. Retain terminal deltas until a complete disk record acknowledges them.
        const active = this.transient.get(scope.sessionId) ?? new Map();
        active.set(message.id, message);
        this.transient.set(scope.sessionId, active);
        if (!previous && (message.role === "user" || message.role === "assistant"))
            this.countChanges.add(scope.sessionId);
        const fresh = !messages?.has(message.id), layoutChanged = previous?.phase !== message.phase ||
            previous?.runId !== message.runId ||
            previous?.role !== message.role ||
            JSON.stringify(previous?.selectionChange) !== JSON.stringify(message.selectionChange) ||
            (message.role === "assistant" &&
                !!previous?.calls?.length !== !!message.calls?.length) ||
            (!!previous && JSON.stringify(threadGroups([previous])) !== JSON.stringify(threadGroups([message])));
        // A completed final can settle archives before its native record is written.
        // Refresh their catalogue exactly on delivery transitions, not every delta.
        if (!!previous && threadDelivery(previous) !== threadDelivery(message) || !previous && threadDelivery(message)) {
            this.contextRevision.set(scope.sessionId, (this.contextRevision.get(scope.sessionId) ?? 0) + 1);
            this.histories.delete(scope.sessionId);
        }
        messages?.set(message.id, message);
        if (messages && (fresh || layoutChanged)) {
            this.layouts.delete(messages);
            if (this.observed(threadScope(scope)))
                this.publish(threadScope(scope), this.thread(scope));
        }
        const pending = this.changedMessages.get(scope.sessionId) ?? new Map();
        pending.set(message.id, message);
        this.changedMessages.set(scope.sessionId, pending);
        if (!this.timers.has(scope.sessionId))
            this.timers.set(scope.sessionId, setTimeout(() => this.flush(scope), 32));
    }
    flush(scope) {
        clearTimeout(this.timers.get(scope.sessionId));
        this.timers.delete(scope.sessionId);
        for (const [id, message] of this.changedMessages.get(scope.sessionId) ?? [])
            if (this.observed(messageScope(scope, id)))
                this.publish(messageScope(scope, id), {
                    ...boundedMessage(message), ...(message.deliveryTiming ? { deliveryTiming: message.deliveryTiming } : {}),
                });
        this.changedMessages.delete(scope.sessionId);
        if (this.countChanges.delete(scope.sessionId))
            this.publish(`sessions:${scope.workspaceId}`);
    }
    publishMessages(scope) {
        const key = `messages:${scope.workspaceId}:${scope.sessionId}`;
        if (this.observed(key))
            this.publish(key);
    }
    current(scope, id) {
        return this.transient.get(scope.sessionId)?.get(id) ?? this.messages.peek(scope.sessionId)?.get(id);
    }
    persisted(scope, ids) {
        const active = this.transient.get(scope.sessionId);
        for (const id of ids) {
            const message = active?.get(id);
            if (message && !message.streaming && message.status !== "running")
                active.delete(id);
        }
        if (!active?.size)
            this.transient.delete(scope.sessionId);
    }
    forget(scope) {
        clearTimeout(this.timers.get(scope.sessionId));
        this.timers.delete(scope.sessionId);
        this.changedMessages.delete(scope.sessionId);
        this.transient.delete(scope.sessionId);
        this.originals.delete(scope.sessionId);
        this.histories.delete(scope.sessionId);
        this.contextRevision.delete(scope.sessionId);
        this.messages.delete(scope.sessionId);
        this.queues.delete(scope.sessionId);
        this.counts.delete(scope.sessionId);
        this.countChanges.delete(scope.sessionId);
    }
    recoverRequestUsage(scope) {
        this.owner(scope);
        const row = this.store.db.prepare("SELECT file,usage FROM agent_sessions WHERE sessionId=?").get(scope.sessionId);
        const usage = row?.usage ? JSON.parse(String(row.usage)) : null;
        if (!usage)
            return;
        // A terminated worker can persist message_end before its usage IPC arrives.
        // Reconcile once after exit; never infer a new request from the run status.
        usage.lastRequest = null;
        if (row?.file) {
            try {
                usage.lastRequest = lastRequestUsage(openTranscript(String(row.file), this.store.workspace(scope.workspaceId).path, { readOnly: true }));
            }
            catch { /* Unreadable native history cannot confirm the latest reading. */ }
        }
        this.store.db.prepare("UPDATE agent_sessions SET usage=? WHERE sessionId=?").run(JSON.stringify(usage), scope.sessionId);
    }
    settled(scope) { this.transient.delete(scope.sessionId); this.originals.delete(scope.sessionId); }
    refresh(scope) {
        this.flush(scope); // Old deltas must precede the compaction/reset snapshot.
        this.contextRevision.set(scope.sessionId, (this.contextRevision.get(scope.sessionId) ?? 0) + 1);
        this.originals.delete(scope.sessionId);
        this.histories.delete(scope.sessionId);
        this.transient.delete(scope.sessionId);
        this.messages.delete(scope.sessionId);
        this.publishMessages(scope);
        this.changed(scope);
    }
}
//# sourceMappingURL=views.js.map