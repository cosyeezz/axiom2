import { useEffect, useState } from "react";
import { command, useScope } from "../transport.js";
import { Dialog, Icon } from "../components.js";
import { runLabels } from "../../shared/agent.js";
import type { Scope, Session, Workspace } from "../../shared/protocol.js";
const noSessions: Session[] = [];
export function History({
  workspace,
  selected,
  select,
  onError,
}: {
  workspace: Workspace;
  selected: string;
  select: (scope: Scope) => void;
  onError: (error: string) => void;
}) {
  const snapshot = useScope<Session[] | null>(`sessions:${workspace.id}`, null);
  const sessions = snapshot ?? noSessions;
  const [query, setQuery] = useState("");
  useEffect(() => {
    const current = sessions.find((s) => s.id === selected);
    if (current?.unread && document.visibilityState === "visible")
      void command(
        "session.read",
        {},
        { workspaceId: workspace.id, sessionId: selected },
      ).catch(() => {});
  }, [snapshot, selected]);
  const [editing, setEditing] = useState<Session | null>(null),
    [title, setTitle] = useState("");
  const [managing, setManaging] = useState<Session | null>(null);
  useEffect(() => {
    if (
      snapshot &&
      !sessions.some((s) => s.id === selected) &&
      (selected || sessions[0])
    )
      select({ workspaceId: workspace.id, sessionId: sessions[0]?.id ?? "" });
  }, [snapshot, selected]);
  const filtered = sessions.filter((s) =>
    s.title.toLowerCase().includes(query.toLowerCase()),
  );
  const run = async (
    op: string,
    params: Record<string, unknown>,
    s: Session,
  ) => {
    try {
      await command(op, params, { workspaceId: workspace.id, sessionId: s.id });
      return true;
    } catch (e) {
      onError((e as Error).message);
      return false;
    }
  };
  const rename = (s: Session) => {
    setEditing(s);
    setTitle(s.title);
  };
  return (
    <>
      <div className="search">
        <Icon name="search" />
        <input
          className="input"
          type="search"
          placeholder="搜索会话"
          aria-label="搜索置顶和当前空间的会话"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="history" id="history">
        {[true, false].map((pinned) => {
          const rows = filtered.filter((s) => s.pinned === pinned);
          return (
            (rows.length > 0 || !pinned) && (
              <section
                className="history-group"
                key={String(pinned)}
                aria-label={pinned ? "置顶会话" : "当前空间对话"}
              >
                <div className="group-label">
                  {pinned ? "置顶" : "对话记录"}
                </div>
                {rows.map((s) => (
                  <div className="history-row" key={s.id}>
                    <button
                      className="history-item"
                      aria-current={s.id === selected}
                      title={`${s.title} · 双击重命名（F2），Delete 删除`}
                      onClick={() =>
                        select({ workspaceId: workspace.id, sessionId: s.id })
                      }
                      onDoubleClick={() => rename(s)}
                      onKeyDown={(e) => {
                        if (e.key === "F2") rename(s);
                        if (
                          e.key === "Delete" &&
                          confirm("删除会话？此操作不删除项目文件。")
                        )
                          void run("session.delete", { confirmed: true }, s);
                      }}
                    >
                      <span>
                        <span className="session-title-line">
                          <strong>{s.title}</strong>
                          {(s.unread ||
                            s.activeTasks ||
                            ["starting", "running", "stopping"].includes(
                              s.runStatus ?? "",
                            )) && (
                            <svg
                              className={`session-state ${s.unread ? "unread" : "running"}`}
                              viewBox="0 0 12 12"
                              aria-label={s.unread ? "未读" : "运行中"}
                            >
                              <circle cx="6" cy="6" r="3" fill="currentColor" />
                            </svg>
                          )}
                        </span>
                        <small>
                          <span className="session-detail">
                            {new Date(s.updatedAt).toLocaleString("zh-CN", {
                              month: "2-digit",
                              day: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                              hour12: false,
                            })}{" "}
                            ·{" "}
                            {s.activeTasks
                              ? "子任务活动中"
                              : s.runStatus
                                ? runLabels[s.runStatus]
                                : "尚未运行"}
                          </span>
                        </small>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="icon-btn session-manage"
                      aria-label={`管理会话：${s.title}`}
                      onClick={() => setManaging(s)}
                    >
                      <span aria-hidden="true">⋯</span>
                    </button>
                    <button
                      className="icon-btn session-pin"
                      aria-label={`${s.pinned ? "取消置顶" : "置顶会话"}：${s.title}`}
                      aria-pressed={s.pinned}
                      onClick={() =>
                        void run("session.pin", { pinned: !s.pinned }, s)
                      }
                    >
                      <svg aria-hidden="true" viewBox="0 0 24 24">
                        <path
                          d={
                            s.pinned
                              ? "M5 5h14M12 10v10m-5-5 5 5 5-5"
                              : "M5 5h14M12 20V10m-5 5 5-5 5 5"
                          }
                        />
                      </svg>
                    </button>
                  </div>
                ))}
                {!rows.length && (
                  <p className="meta" style={{ padding: 12 }}>
                    {query ? "没有匹配的对话" : "暂无其他对话"}
                  </p>
                )}
              </section>
            )
          );
        })}
      </div>
      {managing && (
        <Dialog title="管理会话" onClose={() => setManaging(null)}>
          <p>{managing.title}</p>
          <div className="row">
            <button
              className="btn"
              onClick={() => {
                rename(managing);
                setManaging(null);
              }}
            >
              重命名
            </button>
            <button
              className="btn"
              onClick={async () => {
                if (
                  confirm("删除会话？停止所属任务，不删除项目文件。") &&
                  (await run("session.delete", { confirmed: true }, managing))
                )
                  setManaging(null);
              }}
            >
              删除会话
            </button>
            <button className="btn" onClick={() => setManaging(null)}>
              取消
            </button>
          </div>
        </Dialog>
      )}
      {editing && (
        <Dialog title="重命名会话" onClose={() => setEditing(null)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (await run("session.rename", { title }, editing))
                setEditing(null);
            }}
          >
            <p>修改名称不会影响消息内容或置顶状态。</p>
            <div className="field">
              <label htmlFor="rename-title">会话标题</label>
              <input
                className="input"
                id="rename-title"
                required
                autoFocus
                maxLength={120}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="row">
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => setEditing(null)}
              >
                取消
              </button>
              <button className="btn">保存名称</button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}
