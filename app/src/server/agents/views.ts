import { statSync } from "node:fs";
import { AppError, scopeKey, type Scope } from "../../shared/protocol.js";
import {
  agentScope,
  threadScope,
  messageScope,
  type AgentInfo,
  type ChatMessage,
  type Run,
  type ThreadIndex,
} from "../../shared/agent.js";
import { threadActivity, threadEmpty, threadGroups, threadReplyThinking, threadThinking } from "../../shared/thread-layout.js";
import type { Store } from "../storage.js";
import { contextUsage } from "../context-usage.js";
import { Lru } from "../../shared/lru.js";
import {
  boundedMessage,
  openTranscript,
  transcriptMessages,
  transcriptImage,
} from "../transcript.js";
export class AgentViews {
  constructor(
    readonly store: Store,
    readonly publish: (scope: string, data?: unknown) => void,
    readonly observed: (scope: string) => boolean = () => true,
  ) {}
  readonly messages = new Lru<string, Map<string, ChatMessage>>(5);
  // In-flight deltas are execution state, not an idle history cache. They cannot
  // be reconstructed from JSONL until pi finalizes them.
  private transient = new Map<string, Map<string, ChatMessage>>();
  private contextRevision = new Map<string, number>();
  private layouts = new WeakMap<Map<string, ChatMessage>, Pick<ThreadIndex, "ids" | "groups">>();
  private originals = new Lru<string, { source: string; messages: Map<string, ChatMessage>; bytes: number }>(5);
  private originalCleanup?: NodeJS.Immediate;
  private timers = new Map<string, NodeJS.Timeout>();
  private changedMessages = new Map<string, Map<string, ChatMessage>>();
  readonly queues = new Map<string, NonNullable<AgentInfo["queue"]>>();
  private owner(scope: Scope) {
    return this.store.session(scope.workspaceId, scope.sessionId);
  }
  info(scope: Scope): AgentInfo {
    this.owner(scope);
    const row = this.store.db
      .prepare("SELECT * FROM agent_sessions WHERE sessionId=?")
      .get(scope.sessionId);
    const run = this.store.db
      .prepare(
        "SELECT * FROM runs WHERE sessionId=? ORDER BY startedAt DESC,rowid DESC LIMIT 1",
      )
      .get(scope.sessionId);
    const task = this.store.db
      .prepare("SELECT id,parentSessionId,status FROM tasks WHERE sessionId=?")
      .get(scope.sessionId);
    const usage: AgentInfo["usage"] = row?.usage ? JSON.parse(String(row.usage)) : null;
    // Repair older saved unknown readings on read, without a model request or
    // another compaction. A missing/unreadable transcript must stay unknown.
    if (usage?.context && usage.context.tokens == null && row?.file) {
      try {
        usage.context = contextUsage(openTranscript(String(row.file),
          this.store.workspace(scope.workspaceId).path), usage.context);
      } catch { /* Keep the original unknown reading. */ }
    }
    return {
      ...(task
        ? { task: task as unknown as NonNullable<AgentInfo["task"]> }
        : {}),
      activeTaskCount: Number(this.store.db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE parentSessionId=? AND status IN ('queued','starting','running','stopping')").get(scope.sessionId)?.n ?? 0),
      queue: this.queues.get(scope.sessionId) ?? [],
      selection: row?.selection ? JSON.parse(String(row.selection)) : null,
      environment: row?.environment
        ? JSON.parse(String(row.environment))
        : null,
      usage,
      completedRunDurationMs: Number(this.store.db.prepare(
        "SELECT COALESCE(SUM(MAX(0,endedAt-startedAt)),0) AS ms FROM runs WHERE sessionId=? AND endedAt IS NOT NULL",
      ).get(scope.sessionId)!.ms),
      run: run
        ? ({
            ...run,
            selection: JSON.parse(String(run.selection)),
            retry: run.retry ? JSON.parse(String(run.retry)) : null,
          } as unknown as Run)
        : null,
    };
  }
  transcript(scope: Scope) {
    this.owner(scope);
    let messages = this.messages.get(scope.sessionId);
    if (!messages) {
      const row = this.store.db
        .prepare("SELECT file FROM agent_sessions WHERE sessionId=?")
        .get(scope.sessionId);
      const manager = row?.file
        ? openTranscript(String(row.file), this.store.workspace(scope.workspaceId).path)
        : null;
      const list = manager ? transcriptMessages(manager) : [];
      // Compaction can remove both a task's card and its result notice. Keep the
      // actual unread notices in the display projection so the client can render
      // and acknowledge them; a summary alone is not proof of reading a result.
      // Only recover notices from this session's current branch, never agent input.
      if (manager && list.some((message) => message.compression)) {
        const missing = new Set(this.store.db.prepare(
          "SELECT sourceId FROM session_results WHERE sessionId=? AND kind='task' AND version>(SELECT readVersion FROM sessions WHERE id=?)",
        ).all(scope.sessionId, scope.sessionId).map((row) => String(row.sourceId)));
        for (const message of [...list, ...(this.transient.get(scope.sessionId)?.values() ?? [])])
          if (message.taskNotice && message.resultId) missing.delete(message.resultId);
        if (missing.size) {
          const notices = transcriptMessages(manager, true).filter((message) =>
            message.taskNotice && message.resultId && missing.delete(message.resultId));
          list.unshift(...notices);
        }
      }
      messages = new Map(list.map((m) => [m.id, m]));
      for (const [id, message] of this.transient.get(scope.sessionId) ?? []) messages.set(id, message);
      this.messages.set(scope.sessionId, messages);
    }
    return messages;
  }
  thread(scope: Scope): ThreadIndex {
    const owner = this.owner(scope);
    try {
      const projection = this.transcript(scope);
      let layout = this.layouts.get(projection);
      if (!layout) {
        const messages = [...projection.values()];
        layout = { ids: messages.map((message) => message.id), groups: threadGroups(messages) };
        this.layouts.set(projection, layout);
      }
      const run = this.store.db.prepare("SELECT id,status FROM runs WHERE sessionId=? ORDER BY startedAt DESC,rowid DESC LIMIT 1").get(scope.sessionId);
      return {
        contextRevision: this.contextRevision.get(scope.sessionId) ?? 0,
        runId: run ? String(run.id) : undefined,
        runStatus: run?.status as Run["status"] | undefined,
        resultVersion: owner.resultVersion,
        readVersion: owner.readVersion,
        resultTasks: this.store.db.prepare("SELECT t.taskId,t.id AS resultId FROM session_results e JOIN task_results t ON t.id=e.sourceId WHERE e.sessionId=? AND e.kind='task' AND e.version>? AND t.delivery!='discarded'").all(scope.sessionId, owner.readVersion ?? 0) as unknown as NonNullable<ThreadIndex["resultTasks"]>,
        ...layout,
      };
    } catch (e) {
      return { ids: [], groups: [], error: (e as Error).message };
    }
  }
  original(scope: Scope) {
    this.owner(scope);
    const row = this.store.db.prepare("SELECT file FROM agent_sessions WHERE sessionId=?").get(scope.sessionId);
    const file = row?.file ? String(row.file) : null;
    const stat = file ? statSync(file, { bigint: true }) : null;
    const source = `${file}:${stat?.dev}:${stat?.ino}:${stat?.size}:${stat?.mtimeNs}:${stat?.ctimeNs}:${this.contextRevision.get(scope.sessionId) ?? 0}`;
    let saved = this.originals.get(scope.sessionId);
    if (saved?.source !== source) {
      const list = file ? transcriptMessages(openTranscript(file, this.store.workspace(scope.workspaceId).path), true) : [];
      const bytes = list.reduce((total, message) => total + 256 + 2 * (message.id.length + message.text.length +
        (message.thinking?.length ?? 0) + (message.error?.length ?? 0) + (message.calls?.reduce((sum, call) => sum + call.input.length, 0) ?? 0)), 0);
      saved = { source, messages: new Map(list.map((message) => [message.id, message])), bytes };
      // Same-turn reuse has both a five-session and estimated 32 MiB text budget.
      this.originals.delete(scope.sessionId);
      if (bytes <= 32 * 1024 * 1024) {
        while ([...this.originals.values()].reduce((sum, item) => sum + item.bytes, bytes) > 32 * 1024 * 1024)
          this.originals.delete(this.originals.keys().next().value!);
        this.originals.set(scope.sessionId, saved);
      }
      if (!this.originalCleanup) this.originalCleanup = setImmediate(() => { this.originals.clear(); this.originalCleanup = undefined; });
    }
    const messages = new Map(saved.messages);
    // Current deltas may precede native persistence; never hydrate the default projection just to overlay them.
    for (const message of this.messages.peek(scope.sessionId)?.values() ?? [])
      if (!message.compression) messages.set(message.id, message);
    for (const [id, message] of this.transient.get(scope.sessionId) ?? []) messages.set(id, message);
    return messages;
  }
  message(scope: Scope, id: string, full = false) {
    const value = this.transcript(scope).get(id) ?? (full ? this.original(scope).get(id) : undefined);
    if (!value) {
      if (id.startsWith("tool-")) return null;
      throw new AppError("NOT_FOUND", "消息不存在或不属于此会话");
    }
    return full ? value : boundedMessage(value);
  }
  image(scope: Scope, messageId: string, imageId: string) {
    this.owner(scope);
    const workspace = this.store.workspace(scope.workspaceId);
    if (!workspace.authorized) throw new AppError("AUTHORIZATION_REQUIRED", "请先授权工作空间文件访问");
    const row = this.store.db.prepare("SELECT file FROM agent_sessions WHERE sessionId=?").get(scope.sessionId);
    if (!row?.file) throw new AppError("NOT_FOUND", "此会话没有已保存图片");
    // No bytes in view caches, subscriptions or persisted command receipts.
    return transcriptImage(openTranscript(String(row.file), workspace.path), messageId, imageId, true);
  }
  changed(scope: Scope) {
    if (this.observed(threadScope(scope))) this.publish(threadScope(scope), this.thread(scope));
    if (this.observed(agentScope(scope))) this.publish(agentScope(scope), this.info(scope));
    this.publish(`sessions:${scope.workspaceId}`);
    this.publish(scopeKey(scope));
  }
  messageChanged(scope: Scope, message: ChatMessage) {
    this.owner(scope);
    const messages = this.messages.peek(scope.sessionId) ??
      (this.observed(threadScope(scope)) || this.observed(`messages:${scope.workspaceId}:${scope.sessionId}`) ? this.transcript(scope) : undefined);
    const previous = messages?.get(message.id) ?? this.transient.get(scope.sessionId)?.get(message.id);
    // message_end precedes native persistence. Retain terminal deltas until a complete disk record acknowledges them.
    const active = this.transient.get(scope.sessionId) ?? new Map<string, ChatMessage>();
    active.set(message.id, message); this.transient.set(scope.sessionId, active);
    const fresh = !messages?.has(message.id),
      layoutChanged =
        previous?.role !== message.role ||
        JSON.stringify(previous?.selectionChange) !== JSON.stringify(message.selectionChange) ||
        (message.role === "assistant" &&
          !!previous?.calls?.length !== !!message.calls?.length) ||
        (!!previous && (threadEmpty(previous) !== threadEmpty(message) ||
          threadActivity(previous) !== threadActivity(message) ||
          threadThinking(previous) !== threadThinking(message) ||
          threadReplyThinking(previous) !== threadReplyThinking(message)));
    messages?.set(message.id, message);
    if (messages && (fresh || layoutChanged)) {
      this.layouts.delete(messages);
      if (this.observed(threadScope(scope))) this.publish(threadScope(scope), this.thread(scope));
    }
    const pending =
      this.changedMessages.get(scope.sessionId) ?? new Map<string, ChatMessage>();
    pending.set(message.id, message);
    this.changedMessages.set(scope.sessionId, pending);
    if (!this.timers.has(scope.sessionId))
      this.timers.set(
        scope.sessionId,
        setTimeout(() => this.flush(scope), 32),
      );
  }
  flush(scope: Scope) {
    clearTimeout(this.timers.get(scope.sessionId));
    this.timers.delete(scope.sessionId);
    for (const [id, message] of this.changedMessages.get(scope.sessionId) ?? [])
      if (this.observed(messageScope(scope, id))) this.publish(messageScope(scope, id), boundedMessage(message));
    this.changedMessages.delete(scope.sessionId);
  }
  publishMessages(scope: Scope) {
    const key = `messages:${scope.workspaceId}:${scope.sessionId}`;
    if (this.observed(key)) this.publish(key);
  }
  current(scope: Scope, id: string) {
    return this.transient.get(scope.sessionId)?.get(id) ?? this.messages.peek(scope.sessionId)?.get(id);
  }
  persisted(scope: Scope, ids: string[]) {
    const active = this.transient.get(scope.sessionId);
    for (const id of ids) {
      const message = active?.get(id);
      if (message && !message.streaming && message.status !== "running") active!.delete(id);
    }
    if (!active?.size) this.transient.delete(scope.sessionId);
  }
  forget(scope: Scope) {
    clearTimeout(this.timers.get(scope.sessionId));
    this.timers.delete(scope.sessionId); this.changedMessages.delete(scope.sessionId);
    this.transient.delete(scope.sessionId); this.originals.delete(scope.sessionId);
    this.contextRevision.delete(scope.sessionId); this.messages.delete(scope.sessionId); this.queues.delete(scope.sessionId);
  }
  settled(scope: Scope) { this.transient.delete(scope.sessionId); this.originals.delete(scope.sessionId); }
  refresh(scope: Scope) {
    this.flush(scope); // Old deltas must precede the compaction/reset snapshot.
    this.contextRevision.set(scope.sessionId, (this.contextRevision.get(scope.sessionId) ?? 0) + 1);
    this.originals.delete(scope.sessionId);
    this.transient.delete(scope.sessionId);
    this.messages.delete(scope.sessionId);
    this.publishMessages(scope);
    this.changed(scope);
  }
}
