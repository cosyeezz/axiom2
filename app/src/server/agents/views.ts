import { AppError, text, scopeKey, type Scope } from "../../shared/protocol.js";
import {
  agentScope,
  threadScope,
  messageScope,
  running,
  type AgentInfo,
  type ChatMessage,
  type Run,
  type ThreadIndex,
} from "../../shared/agent.js";
import type { Store } from "../storage.js";
import {
  boundedMessage,
  openTranscript,
  transcriptMessages,
} from "../transcript.js";
export class AgentViews {
  constructor(
    readonly store: Store,
    readonly publish: (scope: string, data?: unknown) => void,
  ) {}
  readonly messages = new Map<string, Map<string, ChatMessage>>();
  private timers = new Map<string, NodeJS.Timeout>();
  private changedMessages = new Map<string, Set<string>>();
  readonly phases = new Map<string, string>();
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
    return {
      ...(task
        ? { task: task as unknown as NonNullable<AgentInfo["task"]> }
        : {}),
      selection: row?.selection ? JSON.parse(String(row.selection)) : null,
      environment: row?.environment
        ? JSON.parse(String(row.environment))
        : null,
      usage: row?.usage ? JSON.parse(String(row.usage)) : null,
      phase: this.phases.get(scope.sessionId),
      run: run
        ? ({
            ...run,
            selection: JSON.parse(String(run.selection)),
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
      this.messages.set(scope.sessionId, messages);
    }
    return messages;
  }
  thread(scope: Scope): ThreadIndex {
    this.owner(scope);
    try {
      const ids = [...this.transcript(scope).keys()];
      return {
        ids: ids.slice(-60),
        before: ids.length > 60 ? ids.at(-60)! : null,
      };
    } catch (e) {
      return { ids: [], before: null, error: (e as Error).message };
    }
  }
  message(scope: Scope, id: string, full = false) {
    const value = this.transcript(scope).get(id);
    if (!value) {
      if (id.startsWith("tool-")) return null;
      throw new AppError("NOT_FOUND", "消息不存在或不属于此会话");
    }
    return full ? value : boundedMessage(value);
  }
  history(scope: Scope, before: unknown) {
    const ids = [...this.transcript(scope).keys()],
      end = ids.indexOf(text(before, "消息游标"));
    if (end < 0) throw new AppError("INVALID_CURSOR", "消息游标不属于此会话");
    return {
      ids: ids.slice(Math.max(0, end - 60), end),
      before: end > 60 ? ids[end - 60] : null,
    };
  }
  changed(scope: Scope) {
    this.publish(agentScope(scope), this.info(scope));
    this.publish(`sessions:${scope.workspaceId}`);
    this.publish(scopeKey(scope));
  }
  messageChanged(scope: Scope, message: ChatMessage) {
    const messages = this.transcript(scope),
      fresh = !messages.has(message.id);
    messages.set(message.id, message);
    if (fresh) this.publish(threadScope(scope), this.thread(scope));
    const pending =
      this.changedMessages.get(scope.sessionId) ?? new Set<string>();
    pending.add(message.id);
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
    for (const id of this.changedMessages.get(scope.sessionId) ?? [])
      this.publish(messageScope(scope, id), this.message(scope, id));
    this.changedMessages.delete(scope.sessionId);
  }
  refresh(scope: Scope) {
    this.messages.delete(scope.sessionId);
    this.publish(threadScope(scope), this.thread(scope));
    this.changed(scope);
  }
}
