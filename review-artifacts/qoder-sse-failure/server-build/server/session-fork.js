import { randomUUID } from "node:crypto";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { AppError, object, text } from "../shared/protocol.js";
import { initializeMemory } from "./memory-files.js";
import { SessionDrafts } from "./session-drafts.js";
import { editableMessage } from "./session-rewrite.js";
import { openTranscript, transcriptForkPoint } from "./transcript.js";
/** Use Pi's native fork path on a separate manager; the source runtime is never switched. */
export function forkSession(agents, command) {
    const { store } = agents;
    const scope = { workspaceId: command.workspaceId, sessionId: command.sessionId };
    const params = object(command.params ?? {});
    if (Object.keys(params).some(key => !["messageId", "draft"].includes(key)) ||
        params.messageId !== undefined && params.draft !== undefined)
        throw new AppError("INVALID_INPUT", "分支只接受消息位置，或当前输入草稿。");
    const messageId = params.messageId === undefined ? undefined : text(params.messageId, "消息标识");
    const drafts = new SessionDrafts(store);
    let createdFile;
    try {
        const result = store.execute(command, undefined, () => {
            const source = store.session(scope.workspaceId, scope.sessionId);
            const workspace = store.workspace(scope.workspaceId);
            if (!workspace.authorized)
                throw new AppError("AUTHORIZATION_REQUIRED", "请先授权工作空间文件访问");
            const info = agents.info(scope);
            if (agents.active(scope) || info.activeTaskCount || info.queue?.length ||
                agents.compressions.info(scope)?.state === "running" || info.task && ["queued", "starting", "running", "wrapping", "stopping", "summarizing"].includes(info.task.status))
                throw new AppError("FORK_BUSY", "请等待此会话及活动子任务结束，或停止执行后创建分支。");
            agents.capabilities.state(scope);
            const row = store.db.prepare("SELECT file,selection FROM agent_sessions WHERE sessionId=?").get(scope.sessionId);
            let manager;
            let draft = { text: "", attachment: null };
            if (row?.file) {
                manager = openTranscript(String(row.file), workspace.path);
                const point = messageId ? transcriptForkPoint(manager, messageId) : undefined;
                if (point?.before)
                    draft = editableMessage(manager, messageId).draft;
                const leafId = point ? point.before ? manager.getEntry(point.entryId).parentId : point.entryId : manager.getLeafId();
                if (leafId)
                    manager.createBranchedSession(leafId);
                else
                    manager.newSession({ parentSession: String(row.file) });
            }
            else {
                if (messageId)
                    throw new AppError("NOT_FORKABLE", "此会话没有已保存的消息。");
                manager = SessionManager.create(workspace.path, join(store.root, "sessions"));
            }
            createdFile = manager.getSessionFile();
            manager.appendCustomEntry("axiom-fork", { sourceSessionId: source.id, messageId, requestId: command.requestId });
            // Pi defers writing a branch without conversation entries. Persist its public
            // header and entries now so first-message forks survive a service restart.
            if (!existsSync(createdFile))
                writeFileSync(createdFile, [manager.getHeader(), ...manager.getEntries()].map(entry => JSON.stringify(entry)).join("\n") + "\n", { flag: "wx", mode: 0o600 });
            const id = randomUUID();
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
        });
        // The receipt and session are committed now; notification failure must never
        // remove a transcript referenced by the committed session.
        createdFile = undefined;
        // Memory belongs to the new session; a later source memory is not a historical snapshot.
        try {
            initializeMemory(store.root, result.id);
        }
        catch { /* Same optional initialization as session.create. */ }
        agents.publish(`sessions:${scope.workspaceId}`);
        return result;
    }
    catch (error) {
        if (createdFile)
            rmSync(createdFile, { force: true });
        throw error;
    }
}
//# sourceMappingURL=session-fork.js.map