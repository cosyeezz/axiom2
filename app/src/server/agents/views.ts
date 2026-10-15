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
import { threadActivity, threadGroups, threadReplyThinking, threadThinking } from "../../shared/thread-layout.js";
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
  ) {}
  readonly messages = new Lru<string, Map<string, ChatMessage>>(5);
  // In-flight deltas are execution state, not an idle history cache. They cannot
  // be reconstructed from JSONL until pi finalizes them.
  private transient = new Map<string, Map<string, ChatMessage>>();
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
      const list = row?.file
        ? transcriptMessages(
            openTranscript(
              String(row.file),
              this.store.workspace(scope.workspaceId).path,
            ),
          )
        : [];
      messages = new Map(list.map((m) => [m.id, m]));
      for (const [id, message] of this.transient.get(scope.sessionId) ?? []) messages.set(id, message);
      this.messages.set(scope.sessionId, messages);
    }
    return messages;
  }
  thread(scope: Scope): ThreadIndex {
    const owner = this.owner(scope);
    try {
      const messages = [...this.transcript(scope).values()];
      const run = this.store.db.prepare("SELECT id,status FROM runs WHERE sessionId=? ORDER BY startedAt DESC,rowid DESC LIMIT 1").get(scope.sessionId);
      return {
        runId: run ? String(run.id) : undefined,
        runStatus: run?.status as Run["status"] | undefined,
        resultVersion: owner.resultVersion,
        readVersion: owner.readVersion,
        resultTasks: this.store.db.prepare("SELECT t.taskId,t.id AS resultId FROM session_results e JOIN task_results t ON t.id=e.sourceId WHERE e.sessionId=? AND e.kind='task' AND e.version>?").all(scope.sessionId, owner.readVersion ?? 0) as unknown as NonNullable<ThreadIndex["resultTasks"]>,
        ids: messages.map((message) => message.id),
        groups: threadGroups(messages),
      };
    } catch (e) {
      return { ids: [], groups: [], error: (e as Error).message };
    }
  }
  original(scope: Scope) {
    this.owner(scope);
    const row = this.store.db.prepare("SELECT file FROM agent_sessions WHERE sessionId=?").get(scope.sessionId);
    const saved = row?.file ? transcriptMessages(openTranscript(String(row.file),
      this.store.workspace(scope.workspaceId).path), true) : [];
    const messages = new Map(saved.map((message) => [message.id, message]));
    // Include the current in-memory turn, which may not have reached JSONL yet.
    for (const message of this.transcript(scope).values())
      if (!message.compression) messages.set(message.id, message);
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
    this.publish(threadScope(scope), this.thread(scope));
    this.publish(agentScope(scope), this.info(scope));
    this.publish(`sessions:${scope.workspaceId}`);
    this.publish(scopeKey(scope));
  }
  messageChanged(scope: Scope, message: ChatMessage) {
    if (message.streaming || message.status === "running") {
      const active = this.transient.get(scope.sessionId) ?? new Map<string, ChatMessage>();
      active.set(message.id, message); this.transient.set(scope.sessionId, active);
    } else {
      const active = this.transient.get(scope.sessionId); active?.delete(message.id);
      if (!active?.size) this.transient.delete(scope.sessionId);
    }
    const messages = this.transcript(scope),
      previous = messages.get(message.id),
      fresh = !messages.has(message.id),
      layoutChanged =
        previous?.role !== message.role ||
        JSON.stringify(previous?.selectionChange) !== JSON.stringify(message.selectionChange) ||
        (message.role === "assistant" &&
          !!previous?.calls?.length !== !!message.calls?.length) ||
        (!!previous && (threadActivity(previous) !== threadActivity(message) ||
          threadThinking(previous) !== threadThinking(message) ||
          threadReplyThinking(previous) !== threadReplyThinking(message)));
    messages.set(message.id, message);
    if (fresh || layoutChanged)
      this.publish(threadScope(scope), this.thread(scope));
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
      this.publish(messageScope(scope, id), boundedMessage(message));
    this.changedMessages.delete(scope.sessionId);
  }
  publishMessages(scope: Scope) {
    this.publish(`messages:${scope.workspaceId}:${scope.sessionId}`, [...this.transcript(scope).values()].map(boundedMessage));
  }
  settled(scope: Scope) { this.transient.delete(scope.sessionId); }
  refresh(scope: Scope) {
    this.flush(scope); // Old deltas must precede the compaction/reset snapshot.
    this.messages.delete(scope.sessionId);
    this.publish(threadScope(scope), this.thread(scope));
    this.publishMessages(scope);
    this.changed(scope);
  }
}
