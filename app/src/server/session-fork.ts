import { randomUUID } from "node:crypto";
import { closeSync, openSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { AppError, object, text, type Command, type Draft } from "../shared/protocol.js";
import type { Agents } from "./agents.js";
import { copyForkMemory } from "./memory-fork.js";
import { SessionDrafts } from "./session-drafts.js";
import { editableMessage } from "./session-rewrite.js";
import { openTranscript, transcriptForkPoint } from "./transcript.js";

/** Fork saved history on a read-only manager; the source runtime keeps its sole writer. */
export function forkSession(agents: Agents, command: Command) {
  const { store } = agents;
  const scope = { workspaceId: command.workspaceId!, sessionId: command.sessionId! };
  const params = object(command.params ?? {});
  if (Object.keys(params).some(key => !["messageId", "draft"].includes(key)) ||
      params.messageId !== undefined && params.draft !== undefined)
    throw new AppError("INVALID_INPUT", "分支只接受消息位置，或当前输入草稿。");
  const messageId = params.messageId === undefined ? undefined : text(params.messageId, "消息标识");
  const drafts = new SessionDrafts(store);
  let createdFile: string | undefined;
  let createdMemory: string | undefined;
  try {
    const result = store.execute(command, undefined, () => {
      const source = store.session(scope.workspaceId, scope.sessionId);
      const workspace = store.workspace(scope.workspaceId);
      if (!workspace.authorized) throw new AppError("AUTHORIZATION_REQUIRED", "请先授权工作空间文件访问");
      agents.capabilities.state(scope);
      const row = store.db.prepare("SELECT file,selection FROM agent_sessions WHERE sessionId=?").get(scope.sessionId);
      let manager: SessionManager;
      let draft: Draft = { text: "", attachment: null };
      if (row?.file) {
        // Native open may repair/migrate the source file. Snapshot saved entries
        // without writing it, even while its worker appends the next message.
        manager = openTranscript(String(row.file), workspace.path, { readOnly: true });
        const point = messageId ? transcriptForkPoint(manager, messageId) : undefined;
        if (point?.before) draft = editableMessage(manager, messageId!).draft;
        const leafId = point ? point.before ? manager.getEntry(point.entryId)!.parentId : point.entryId : manager.getLeafId();
        if (leafId) manager.createBranchedSession(leafId);
        else manager.newSession({ parentSession: String(row.file) });
      } else {
        if (messageId) throw new AppError("NOT_FORKABLE", "此会话没有已保存的消息。");
        manager = SessionManager.inMemory(workspace.path);
      }
      manager.appendCustomEntry("axiom-fork", { sourceSessionId: source.id, messageId, requestId: command.requestId });
      const target = SessionManager.create(workspace.path, row?.file ? dirname(String(row.file)) : join(store.root, "sessions"), {
        id: manager.getSessionId(), parentSession: row?.file ? String(row.file) : undefined,
      });
      const file = target.getSessionFile()!;
      const fd = openSync(file, "wx", 0o600);
      createdFile = file;
      // Persist the native branch, including empty/first-message forks, only to
      // its new file. Later source output and task state never join this snapshot.
      try {
        writeFileSync(fd, [target.getHeader(), ...manager.getEntries()].map(entry => JSON.stringify(entry)).join("\n") + "\n");
      } finally { closeSync(fd); }
      const id = randomUUID();
      createdMemory = copyForkMemory(store.root, source.id, id);
      store.db.prepare("INSERT INTO sessions(id,workspaceId,title,titleState,updatedAt,forkParentSessionId) VALUES(?,?,?,'pending',?,?)")
        .run(id, workspace.id, `${source.title.slice(0, 114)} · 分支`, Date.now(), source.id);
      store.db.prepare("INSERT INTO agent_sessions(sessionId,selection,file) VALUES(?,?,?)")
        .run(id, row?.selection ?? null, createdFile);
      store.db.prepare(`INSERT INTO session_capabilities(sessionId,selection,catalog,revision,lockedAt,legacy)
        SELECT ?,selection,catalog,0,lockedAt,legacy FROM session_capabilities WHERE sessionId=?`).run(id, source.id);
      drafts.save({ workspaceId: workspace.id, sessionId: id }, {
        draft: params.draft ?? draft, writer: `fork-${id}`, sequence: 1, revision: 0,
      });
      return store.session(workspace.id, id);
    }) as import("../shared/protocol.js").Session;
    // The receipt and session are committed now; notification failure must never
    // remove their transcript or memory. Receipt replay must not recopy memory.
    createdFile = undefined;
    createdMemory = undefined;
    agents.publish(`sessions:${scope.workspaceId}`);
    return result;
  } catch (error) {
    if (createdMemory) rmSync(createdMemory, { recursive: true, force: true });
    if (createdFile) rmSync(createdFile, { force: true });
    throw error;
  }
}
