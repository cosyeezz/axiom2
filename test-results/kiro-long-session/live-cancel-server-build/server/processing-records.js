import { randomUUID } from "node:crypto";
import { AppError, object, text } from "../shared/protocol.js";
import { processingKinds, processingStates } from "../shared/processing.js";
const instances = new WeakMap();
const secretKey = /^(authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password|headers)$/i;
function redact(value) {
    // Prompts often contain a serialized document. Sanitize its string values before
    // the enclosing payload escapes quotation marks again.
    try {
        const parsed = JSON.parse(value);
        if ((parsed && typeof parsed === "object") || typeof parsed === "string")
            return JSON.stringify(sanitize(parsed)) ?? "";
    }
    catch {
        // Older versions truncated serialized model documents before filtering them.
        // An incomplete JSON document cannot safely be projected field by field. Hide
        // the whole diagnostic instead of guessing where private reasoning ends.
        if (/^\s*(?:\{|\[\s*(?:[\[{"\d-]|true\b|false\b|null\b|$)|")/.test(value) || privateFragment(value))
            return "（结构化诊断内容不完整或无效，已隐藏以保护私有模型信息）";
    }
    return value.replace(/\bBearer\s+[^\s"'<>]+/gi, "Bearer [已隐藏]")
        .replace(/\b(sk-[a-zA-Z0-9_-]{16,})\b/g, "[已隐藏]")
        .replace(/(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password)["']?\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi, '$1"[已隐藏]"');
}
const privateMetadata = /^(?:thinkingSignature|textSignature|providerMetadata|signature|reasoning(?:_?(?:content|details|signature))?)$/i;
const privateBlock = (value) => !!value && typeof value === "object" && ["thinking", "reasoning", "redacted_thinking"].includes(String(value.type));
function privateFragment(value) {
    // A log prefix or Markdown fence can wrap incomplete serialized diagnostics.
    // Decode only a detection copy, including JSON Unicode escapes in known keys.
    // Consume entire backslash runs even for unknown escapes to avoid quadratic
    // rescanning. Bound nested decoding; hide rather than guess beyond that limit.
    let probe = value;
    for (let depth = 0; depth < 8; depth++) {
        const normalized = probe.replace(/\\+(?:u([a-f0-9]{4})|(["nrt]))?/gi, (escape, hex, token) => hex ? String.fromCharCode(Number.parseInt(hex, 16)) : token === '"' ? '"' : token ? " " : escape);
        if (normalized === probe)
            break;
        probe = normalized;
        if (depth === 7)
            return true;
    }
    if (/"type"\s*:\s*"(?:thinking|reasoning|redacted_thinking)"/i.test(probe))
        return true;
    if (/"role"\s*:\s*"assistant"/i.test(probe) && /"thinking"\s*:/i.test(probe))
        return true;
    for (const match of probe.matchAll(/"([^"\\]+)"\s*:/g))
        if (privateMetadata.test(match[1]))
            return true;
    return false;
}
function sanitize(value) {
    if (privateBlock(value))
        return undefined;
    if (typeof value === "string")
        return redact(value);
    if (Array.isArray(value))
        return value.filter(part => !privateBlock(part)).map(sanitize);
    if (value && typeof value === "object") {
        // Inputs can contain previous assistant messages (not only the latest output).
        const source = publicModelOutput(value);
        return Object.fromEntries(Object.entries(source).filter(([key]) => !privateMetadata.test(key) && !(source.role === "assistant" && key === "thinking"))
            .map(([key, val]) => [key, secretKey.test(key) ? "[已隐藏]" : sanitize(val)]).filter(([, val]) => val !== undefined));
    }
    return value;
}
export function processingError(error) { return redact(error instanceof Error ? error.message : String(error ?? "处理失败")); }
/** Diagnostic model output excludes private reasoning, signatures and provider metadata. */
function publicModelOutput(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return value;
    const message = value;
    if (message.role !== "assistant" || !Array.isArray(message.content))
        return value;
    return { ...Object.fromEntries(["role", "api", "provider", "model", "usage", "stopReason", "errorMessage", "timestamp"].filter(key => key in message).map(key => [key, message[key]])),
        content: message.content.flatMap(part => part?.type === "text" ? [{ type: "text", text: part.text }] : part?.type === "toolCall" ? [{ type: "toolCall", id: part.id, name: part.name, arguments: part.arguments }] : []) };
}
function payload(value) {
    const clean = typeof value === "string" ? redact(value) : JSON.stringify(sanitize(value), null, 2) ?? "", limit = 2_000_000;
    return { text: clean.slice(0, limit), truncated: clean.length > limit };
}
export class ProcessingRecords {
    store;
    static for(store) { let value = instances.get(store); if (!value) {
        value = new ProcessingRecords(store);
        instances.set(store, value);
    } return value; }
    listeners = new Set();
    revisions = new Map();
    pending = new Set();
    scheduled = false;
    /** Payload-free invalidation; multiple writes in one turn share a notification. */
    observe(listener) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
    invalidation(workspaceId) { this.authorize(workspaceId); return { revision: this.revisions.get(workspaceId) ?? 0 }; }
    changed(workspaceId) {
        this.revisions.set(workspaceId, (this.revisions.get(workspaceId) ?? 0) + 1);
        if (!this.listeners.size)
            return;
        this.pending.add(workspaceId);
        if (this.scheduled)
            return;
        this.scheduled = true;
        queueMicrotask(() => {
            this.scheduled = false;
            const workspaces = [...this.pending];
            this.pending.clear();
            for (const id of workspaces)
                for (const listener of this.listeners) {
                    try {
                        listener(id);
                    }
                    catch { /* An observer must never change a business outcome. */ }
                }
        });
    }
    constructor(store) {
        this.store = store;
        store.db.exec(`CREATE TABLE IF NOT EXISTS processing_records(id TEXT PRIMARY KEY, workspaceId TEXT NOT NULL, sessionId TEXT NOT NULL, kind TEXT NOT NULL, state TEXT NOT NULL, startedAt INTEGER NOT NULL, summary TEXT NOT NULL, body TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS processing_records_workspace ON processing_records(workspaceId,startedAt DESC);
      CREATE INDEX IF NOT EXISTS processing_records_session ON processing_records(sessionId);`);
        for (const row of store.db.prepare("SELECT body FROM processing_records WHERE state IN ('running','cancelling')").all()) {
            const record = JSON.parse(String(row.body));
            this.finish(record.id, "interrupted", "服务已重启，未自动重新发起请求");
        }
    }
    write(record) {
        const { calls, stages, result, ...summary } = record;
        this.store.db.prepare("INSERT INTO processing_records VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,summary=excluded.summary,body=excluded.body")
            .run(record.id, record.workspaceId, record.sessionId, record.kind, record.state, record.startedAt, JSON.stringify(summary), JSON.stringify(record));
        this.changed(record.workspaceId);
    }
    read(id) { const row = this.store.db.prepare("SELECT body FROM processing_records WHERE id=?").get(id); return row ? JSON.parse(String(row.body)) : undefined; }
    start(scope, kind, title, id = randomUUID(), startedAt = Date.now(), legacy = false, context = {}) {
        if (!this.read(id))
            this.write({ ...sanitize(context), workspaceId: scope.workspaceId, sessionId: scope.sessionId, id, kind, title: redact(title), startedAt, legacy, endedAt: null, state: "running", stage: "准备", error: null, stages: legacy ? [] : [{ name: "准备", at: startedAt }], calls: [] });
        return id;
    }
    annotate(id, context) {
        const record = this.read(id);
        if (!record)
            return;
        Object.assign(record, sanitize(context));
        this.write(record);
    }
    stage(id, stage, selection) {
        const record = this.read(id);
        if (!record || !["running", "cancelling"].includes(record.state))
            return;
        if (record.stage !== stage)
            record.stages.push({ name: stage, at: Date.now() });
        record.stage = stage;
        if (selection)
            record.selection = selection;
        this.write(record);
    }
    cancelling(id, error) { const record = this.read(id); if (record && record.state === "running") {
        record.state = "cancelling";
        if (error)
            record.error = processingError(error);
        this.write(record);
    } }
    finish(id, state, error, result) {
        const record = this.read(id);
        if (!record)
            return;
        // Preserve the first terminal outcome. Explicit compression recovery can reconcile application separately.
        if (!["running", "cancelling"].includes(record.state))
            return;
        record.state = state;
        record.endedAt = Date.now();
        record.error = error == null ? null : processingError(error);
        if (result !== undefined)
            record.result = payload(result);
        for (const call of record.calls)
            if (call.state === "running" || call.state === "cancelling") {
                call.state = state === "completed" ? "interrupted" : state;
                call.endedAt = record.endedAt;
                call.error = record.error ?? "未收到完整模型响应";
            }
        this.write(record);
    }
    failure(id, error, signal) {
        const code = error?.code;
        this.finish(id, code === "REVISION_CONFLICT" ? "invalidated" : code === "MEMORY_CANCELLED" || error?.name === "AbortError" || signal?.aborted && signal.reason?.name !== "TimeoutError" ? "cancelled" : "failed", signal?.aborted ? signal.reason ?? error : error);
    }
    callStart(id, stage, input, selection, callId = randomUUID()) {
        const record = this.read(id);
        if (!record || !["running", "cancelling"].includes(record.state))
            return callId;
        if (record.calls.some((call) => call.id === callId))
            return callId;
        record.calls.push({ id: callId, stage, state: "running", startedAt: Date.now(), endedAt: null, selection, input: payload(input) });
        this.write(record);
        return callId;
    }
    callSent(id, callId) {
        const record = this.read(id), call = record?.calls.find((item) => item.id === callId);
        if (record && call && !call.sentAt) {
            call.sentAt = Date.now();
            this.write(record);
        }
    }
    callFinish(id, callId, output, error, usage) {
        const record = this.read(id), call = record?.calls.find((call) => call.id === callId);
        if (!record || !call)
            return;
        if (output !== undefined && !call.output)
            call.output = payload(publicModelOutput(output));
        if (usage !== undefined)
            call.usage = sanitize(usage);
        if (call.state === "running") {
            call.state = error == null ? "completed" : error?.code === "MEMORY_CANCELLED" || error?.name === "AbortError" ? "cancelled" : "failed";
            call.endedAt = Date.now();
            if (error != null)
                call.error = processingError(error);
        }
        this.write(record);
    }
    syncCompression(scope, job) {
        const absent = !this.read(job.id);
        this.start(scope, "compression", "上下文压缩", job.id, job.startedAt, absent);
        const record = this.read(job.id);
        const unconfirmed = job.state === "completed" && job.phase !== "done";
        const stage = unconfirmed ? "应用状态待核实" : job.stage ?? { snapshot: "等待安全点快照", summarizing: "生成摘要", applying: "等待安全点校验并应用", done: "摘要已应用" }[job.phase] ?? job.phase;
        // Legacy jobs have no per-stage timestamps; discard synthetic import times too.
        if (record.legacy)
            record.stages = [];
        else if (record.stage !== stage)
            record.stages.push({ name: stage, at: Date.now() });
        record.stage = stage;
        record.selection = job.selection;
        if (job.error)
            record.error = processingError(job.error);
        if (job.state !== "running") {
            record.state = unconfirmed ? "interrupted" : job.state;
            record.endedAt = job.endedAt;
            record.error = job.error ? processingError(job.error) : unconfirmed ? "摘要已生成，但没有确认应用结果；未自动重发。" : null;
            if (job.state === "completed" && job.phase === "done")
                record.outcome = "applied";
            if (job.summary)
                record.result = payload(job.summary);
            for (const call of record.calls)
                if (call.state === "running") {
                    call.state = job.state === "completed" ? "interrupted" : record.state;
                    call.endedAt = job.endedAt;
                    call.error = record.error ?? "未收到完整模型响应";
                }
        }
        this.write(record);
    }
    authorize(workspaceId, sessionId) {
        if (!this.store.workspace(workspaceId).authorized)
            throw new AppError("AUTHORIZATION_REQUIRED", "请先授权工作空间访问");
        if (sessionId && !this.store.db.prepare("SELECT id FROM sessions WHERE id=? AND workspaceId=?").get(sessionId, workspaceId))
            throw new AppError("NOT_FOUND", "来源会话不可用");
    }
    command(c) {
        const workspaceId = text(c.workspaceId, "工作空间"), p = object(c.params ?? {});
        this.authorize(workspaceId);
        if (c.op === "processing.get") {
            const record = this.read(text(p.id, "处理记录"));
            if (!record || record.workspaceId !== workspaceId)
                throw new AppError("NOT_FOUND", "处理记录不存在或不属于当前工作空间");
            // Read-time projection also protects records saved by older versions; no data rewrite.
            this.authorize(workspaceId, record.sessionId);
            return sanitize(record);
        }
        if (c.op !== "processing.list")
            throw new AppError("UNKNOWN_OPERATION", "不支持的处理记录操作");
        const kind = p.kind ? text(p.kind, "类型") : "", state = p.state ? text(p.state, "状态") : "";
        if (kind && !Object.hasOwn(processingKinds, kind) || state && !Object.hasOwn(processingStates, state))
            throw new AppError("INVALID_INPUT", "处理记录筛选无效");
        const sessionId = p.sessionId ? text(p.sessionId, "会话") : "", query = typeof p.query === "string" ? p.query.trim().slice(0, 200) : "";
        if (sessionId)
            this.authorize(workspaceId, sessionId);
        const toolCallId = p.toolCallId ? text(p.toolCallId, "工具调用") : "";
        const before = p.before === undefined ? Number.MAX_SAFE_INTEGER : Number(p.before), since = p.since === undefined ? 0 : Number(p.since);
        if (!Number.isSafeInteger(before) || before < 0 || !Number.isSafeInteger(since) || since < 0)
            throw new AppError("INVALID_INPUT", "记录分页参数无效");
        const rows = this.store.db.prepare(`SELECT r.rowid AS cursor,r.summary FROM processing_records r JOIN sessions s ON s.id=r.sessionId AND s.workspaceId=r.workspaceId
      WHERE r.workspaceId=? AND r.rowid<? AND r.startedAt>=? AND (?='' OR r.kind=?) AND (?='' OR r.state=?) AND (?='' OR r.sessionId=?) AND (?='' OR json_extract(r.summary,'$.toolCallId')=?) ORDER BY r.rowid DESC`)
            .iterate(workspaceId, before, since, kind, kind, state, state, sessionId, sessionId, toolCallId, toolCallId);
        const items = [], search = query.toLowerCase();
        let cursor = 0;
        for (const row of rows) {
            // Search only the public projection, including old records. Raw JSON must
            // not become an oracle for hidden credentials or provider reasoning.
            const summary = sanitize(JSON.parse(String(row.summary)));
            if (search && !JSON.stringify(summary).toLowerCase().includes(search))
                continue;
            if (items.length === 50)
                return { items, next: cursor };
            items.push(summary);
            cursor = Number(row.cursor);
        }
        return { items, next: null };
    }
}
//# sourceMappingURL=processing-records.js.map