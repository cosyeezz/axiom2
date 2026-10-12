import { useEffect, useRef, useState } from "react";
import { command, useConnection, useScope } from "../transport.js";
import { useDraft, updateDraft, clearSubmittedDraft } from "../drafts.js";
import { Dialog, Icon, PanelIcon } from "../components.js";
import {
  scopeKey,
  type Configuration,
  type Scope,
  type Session,
  type Workspace,
} from "../../shared/protocol.js";
import { AgentThread as Thread, ModelPicker } from "../chat.js";
import {
  agentScope,
  emptyAgent,
  running,
  runLabels,
} from "../../shared/agent.js";
import "../styles/workbench.css";
import "../styles/chat.css";

const noWorkspaces: Workspace[] = [],
  noSessions: Session[] = [];
const noConfig: Configuration = {
  revision: "",
  providerCount: 0,
  modelCount: 0,
  available: [],
  dataRoot: "",
};
function initialView(): Scope | null {
  try {
    return JSON.parse(sessionStorage.getItem("view") || "null");
  } catch {
    return null;
  }
}

export default function Workbench() {
  const workspaces = useScope("workspaces", noWorkspaces);
  const [view, setView] = useState<Scope | null>(initialView);
  const navigation = useRef(0);
  const [collapsed, setCollapsed] = useState(false),
    [mobileOpen, setMobileOpen] = useState(false);
  const [openFolder, setOpenFolder] = useState(false),
    [error, setError] = useState("");
  const mobile = useRef(matchMedia("(max-width:640px)"));
  const [isMobile, setIsMobile] = useState(mobile.current.matches);
  useEffect(() => {
    const change = () => {
      setIsMobile(mobile.current.matches);
      setMobileOpen(false);
    };
    mobile.current.addEventListener("change", change);
    return () => mobile.current.removeEventListener("change", change);
  }, []);
  const workspace = workspaces.find((w) => w.id === view?.workspaceId);
  const select = (next: Scope) => {
    navigation.current++;
    setView(next);
    try {
      sessionStorage.setItem("view", JSON.stringify(next));
    } catch {
      setError("查看位置无法保存；当前页面仍可使用。");
    }
    setMobileOpen(false);
  };
  const create = async (id = workspace?.id) => {
    if (!id) {
      setOpenFolder(true);
      return;
    }
    const startedAt = navigation.current;
    try {
      const session = await command<Session>(
        "session.create",
        {},
        { workspaceId: id },
      );
      if (navigation.current === startedAt)
        select({ workspaceId: id, sessionId: session.id });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const switchWorkspace = (w: Workspace) =>
    select({ workspaceId: w.id, sessionId: "" });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === "k" &&
        !document.querySelector("dialog[open]")
      ) {
        e.preventDefault();
        void create();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  });
  const expanded = isMobile ? mobileOpen : !collapsed;
  return (
    <div
      className={`app${collapsed ? " sidebar-collapsed" : ""}${mobileOpen ? " history-open" : ""}`}
      id="app"
    >
      <button
        className="backdrop"
        aria-label="关闭历史对话"
        onClick={() => setMobileOpen(false)}
      />
      <aside className="sidebar" id="history-sidebar" aria-label="对话历史">
        <div className="row brand">
          <span className="axiom-wordmark" role="img" aria-label="AXIOM">
            <span className="brand-mark axiom-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M12 2 22 8 12 14 2 8Z" />
                <path className="facet" d="m2 10 9 5.4V22l-9-5.4Z" />
                <path d="m13 15.4 9-5.4v6.6L13 22Z" />
              </svg>
            </span>
            <strong aria-hidden="true">XIOM</strong>
          </span>
          <button
            className="icon-btn"
            id="collapse-history"
            aria-label="收起侧栏"
            onClick={() => {
              isMobile ? setMobileOpen(false) : setCollapsed(true);
              requestAnimationFrame(() =>
                document.getElementById("toggle-history")?.focus(),
              );
            }}
          >
            <PanelIcon />
          </button>
        </div>
        <details
          className="workspace-picker"
          id="workspace-picker"
          onKeyDown={(e) => {
            if (e.key === "Escape") e.currentTarget.open = false;
          }}
        >
          <summary aria-label="切换工作空间">
            <Icon name="workspace" />
            <span className="workspace-copy">
              <strong>{workspace?.name || "选择工作空间"}</strong>
            </span>
            <Icon name="chevron" />
          </summary>
          <div className="workspace-menu">
            <div className="workspace-list">
              {workspaces.map((w) => (
                <button
                  className="workspace-option"
                  key={w.id}
                  aria-current={w.id === workspace?.id}
                  title={w.path}
                  onClick={(e) => {
                    switchWorkspace(w);
                    e.currentTarget.closest("details")!.open = false;
                  }}
                >
                  <Icon name="workspace" />
                  <span className="workspace-copy">
                    <strong>{w.name}</strong>
                  </span>
                </button>
              ))}
            </div>
            <button
              id="add-workspace"
              onClick={(e) => {
                e.currentTarget.closest("details")!.open = false;
                setOpenFolder(true);
              }}
            >
              <Icon name="folder-plus" />
              打开文件夹…
            </button>
          </div>
        </details>
        <button
          className="btn new-chat"
          id="new-chat"
          onClick={() => void create()}
        >
          <Icon name="new-chat" />
          <span>新建会话</span>
        </button>
        {workspace ? (
          <History
            key={workspace.id}
            workspace={workspace}
            selected={view?.sessionId ?? ""}
            select={select}
            onError={setError}
          />
        ) : (
          <>
            <div className="search">
              <Icon name="search" />
              <input
                className="input"
                type="search"
                placeholder="搜索会话"
                aria-label="搜索置顶和当前空间的会话"
                disabled
              />
            </div>
            <div className="history">
              <div className="group-label">对话记录</div>
              <p className="meta" style={{ padding: 12 }}>
                请先打开工作空间
              </p>
            </div>
          </>
        )}
        <a
          className="sidebar-foot config-entry"
          href="/settings.html"
          aria-label="打开应用配置"
        >
          <span className="avatar" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="m9 3-.5 2.5-2 1.2L4 6l-2 3.5 2 1.7v2.6l-2 1.7L4 19l2.5-.7 2 1.2L9 22h6l.5-2.5 2-1.2 2.5.7 2-3.5-2-1.7v-2.6l2-1.7L20 6l-2.5.7-2-1.2L15 3Z" />
              <circle cx="12" cy="12.5" r="3" />
            </svg>
          </span>
          <span>
            配置
            <span className="meta" style={{ display: "block" }}>
              应用配置
            </span>
          </span>
          <svg
            className="config-chevron"
            aria-hidden="true"
            viewBox="0 0 24 24"
          >
            <path d="m9 6 6 6-6 6" />
          </svg>
        </a>
      </aside>
      <main className="workspace" id="content">
        <header className="topnav">
          <div className="row">
            <button
              className="icon-btn mobile-toggle"
              id="toggle-history"
              aria-label="展开侧栏"
              aria-controls="history-sidebar"
              aria-expanded={expanded}
              onClick={() =>
                isMobile ? setMobileOpen(true) : setCollapsed(false)
              }
            >
              <PanelIcon />
            </button>
            <Title workspace={workspace} scope={view} onError={setError} />
          </div>
        </header>
        <Thread
          key={view ? "thread:" + scopeKey(view) : "empty"}
          scope={view}
        />
        {view?.sessionId && workspace ? (
          <Composer key={scopeKey(view)} scope={view} />
        ) : (
          <EmptyComposer />
        )}
        {error && (
          <p className="execution-alert" role="alert">
            {error}
            <button
              className="icon-btn"
              aria-label="关闭错误提示"
              onClick={() => setError("")}
            >
              <Icon name="close" />
            </button>
          </p>
        )}
      </main>
      {openFolder && (
        <OpenFolder
          close={() => setOpenFolder(false)}
          opened={(w) => {
            setOpenFolder(false);
            void create(w.id);
          }}
        />
      )}
    </div>
  );
}
function OpenFolder({
  close,
  opened,
}: {
  close: () => void;
  opened: (w: Workspace) => void;
}) {
  const [path, setPath] = useState(""),
    [authorized, setAuthorized] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Dialog title="打开工作空间" onClose={close}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            opened(
              await command<Workspace>("workspace.open", { path, authorized }),
            );
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p>
          输入本地服务可访问的项目绝对路径。浏览器上传文件不等于打开工作空间。
        </p>
        <div className="field">
          <label htmlFor="workspace-path">项目目录</label>
          <input
            autoFocus
            className="input"
            id="workspace-path"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            required
            maxLength={4096}
            placeholder="例如 F:\项目 或 /home/user/project"
          />
        </div>
        <label>
          <input
            type="checkbox"
            required
            checked={authorized}
            onChange={(e) => setAuthorized(e.target.checked)}
          />
          授权编码工具访问此项目。上下文隔离不是文件系统沙箱；项目扩展仍需单独授权。
        </label>
        <p className="workspace-error" role="alert">
          {error}
        </p>
        <div className="row">
          <button type="button" className="btn btn-ghost" onClick={close}>
            取消
          </button>
          <button className="btn" disabled={busy || !authorized}>
            {busy ? "正在确认…" : "打开文件夹"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
function History({
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
                            {s.runStatus ? runLabels[s.runStatus] : "尚未运行"}
                          </span>
                        </small>
                      </span>
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
function Title({
  workspace,
  scope,
  onError,
}: {
  workspace?: Workspace;
  scope: Scope | null;
  onError: (s: string) => void;
}) {
  const session = useScope<Session | null>(
    scope?.sessionId ? scopeKey(scope) : null,
    null,
  );
  return (
    <div className="title-block">
      <h1 id="chat-title">{session?.title || "新对话"}</h1>
      <div className="title-meta">
        <span id="title-path" title={workspace?.path}>
          {workspace?.path || "未关联文件夹"}
        </span>
        <span className="path-actions">
          <button
            className="icon-btn"
            disabled={!workspace}
            aria-label="复制工作空间路径"
            onClick={() =>
              navigator.clipboard
                .writeText(workspace!.path)
                .catch(() => onError("无法访问剪贴板，请手动复制路径"))
            }
          >
            <Icon name="copy" />
          </button>
          <button
            className="icon-btn"
            disabled={!workspace}
            aria-label="打开系统文件管理器"
            onClick={async () => {
              const response = await fetch(
                `/api/workspace/reveal?id=${workspace!.id}`,
                { method: "POST" },
              );
              if (!response.ok) onError("无法打开系统文件管理器");
            }}
          >
            <Icon name="workspace" />
          </button>
        </span>
      </div>
    </div>
  );
}
function Composer({ scope }: { scope: Scope }) {
  const info = useScope(agentScope(scope), emptyAgent),
    config = useScope("configuration", noConfig),
    connection = useConnection();
  const active = running(info.run),
    selected = config.available.some(
      (m) =>
        m.provider === info.selection?.provider && m.id === info.selection.id,
    );
  const pendingKey = `pending:${scopeKey(scope)}`;
  const [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(() => {
      try {
        return (
          JSON.parse(sessionStorage.getItem(pendingKey) || "null")?.requestId ??
          ""
        );
      } catch {
        return "";
      }
    });
  const latestDraft = useRef({ text: "", attachment: null } as Pick<
    import("../../shared/protocol.js").Draft,
    "text" | "attachment"
  >);
  const draft = useDraft(scope),
    input = useRef<HTMLTextAreaElement>(null),
    file = useRef<HTMLInputElement>(null),
    [error, setError] = useState("");
  latestDraft.current = draft;
  const submit = async (op = "prompt") => {
    if (
      busy ||
      (!active && uncertain) ||
      connection !== "已连接本地服务" ||
      (!active && !selected)
    )
      return;
    const captured = latestDraft.current,
      requestId = crypto.randomUUID();
    setBusy(true);
    setError("");
    let sent = false;
    try {
      if (!active)
        sessionStorage.setItem(
          pendingKey,
          JSON.stringify({
            requestId,
            op: active ? "agent.stop" : op,
            text: captured.text,
            attachment: captured.attachment,
          }),
        );
      sent = true;
      await command(
        active ? "agent.stop" : op,
        active
          ? { runId: info.run!.id }
          : op !== "prompt"
            ? {}
            : { text: captured.text, attachment: captured.attachment },
        scope,
        requestId,
      );
      if (!active && op === "prompt") clearSubmittedDraft(scope, captured);
      if (!active) sessionStorage.removeItem(pendingKey);
    } catch (e) {
      if (!active && (e as { code?: string }).code === "UNCERTAIN")
        setUncertain(requestId);
      else if (!active) {
        try {
          sessionStorage.removeItem(pendingKey);
        } catch {}
      }
      setError(
        sent
          ? (e as Error).message
          : "浏览器恢复记录无法保存，未发送任务。请检查浏览器存储。",
      );
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    const node = input.current!;
    node.style.height = "44px";
    node.style.height = `${Math.min(180, Math.max(44, node.scrollHeight))}px`;
  }, [draft.text]);
  return (
    <section className="composer-area">
      <div className="container">
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="screen-reader" htmlFor="prompt">
            描述你的编码任务
          </label>
          <textarea
            className="textarea"
            ref={input}
            id="prompt"
            maxLength={12000}
            placeholder="描述任务或粘贴代码，支持 Markdown 与彩色重点提示…"
            value={draft.text}
            onChange={(e) => updateDraft(scope, { text: e.target.value })}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing &&
                e.keyCode !== 229
              ) {
                e.preventDefault();
                if (!active) void submit();
              }
            }}
          />
          <div className="attachment">
            {draft.attachment && (
              <>
                {draft.attachment.name}
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="移除附件"
                  onClick={() => updateDraft(scope, { attachment: null })}
                >
                  <Icon name="close" />
                </button>
              </>
            )}
          </div>
          <div className="composer-tools">
            <div className="row">
              <button
                type="button"
                className="icon-btn"
                id="attach"
                aria-label="附加文本或代码文件"
                onClick={() => file.current?.click()}
              >
                <Icon name="plus" />
              </button>
              <input
                ref={file}
                type="file"
                hidden
                accept=".txt,.md,.js,.jsx,.ts,.tsx,.json,.py,.css,.html"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  const owner = { ...scope };
                  try {
                    if (
                      f.size > 100000 ||
                      !/\.(txt|md|js|jsx|ts|tsx|json|py|css|html)$/i.test(
                        f.name,
                      )
                    )
                      throw Error("请使用小于 100 KB 的文本或代码文件");
                    const text = await f.text();
                    if (text.includes("\0")) throw Error("附件不是文本文件");
                    updateDraft(owner, { attachment: { name: f.name, text } });
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              />
              <ModelPicker scope={scope} />
            </div>
            <button
              className={`btn btn-primary send${active ? " is-running" : ""}`}
              type="submit"
              aria-label={active ? "停止执行" : "发送消息"}
              title={
                active
                  ? "停止此会话"
                  : selected
                    ? "发送消息"
                    : "请先选择可用模型"
              }
              disabled={
                busy ||
                (!active && !!uncertain) ||
                connection !== "已连接本地服务" ||
                (!active &&
                  (!selected ||
                    (!draft.text.trim() && !draft.attachment) ||
                    info.run?.cleanup === "unconfirmed"))
              }
            >
              {active ? (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              ) : (
                <Icon name="arrow" />
              )}
            </button>
          </div>
        </form>
        {!active &&
          info.run &&
          ["cancelled", "interrupted", "failed"].includes(info.run.status) && (
            <button
              className="btn"
              disabled={
                busy ||
                !!uncertain ||
                !selected ||
                info.run.cleanup !== "confirmed"
              }
              onClick={() => void submit("agent.continue")}
            >
              显式继续
            </button>
          )}
        {uncertain && (
          <button
            className="btn"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const receipt = await command<{ status: string }>(
                  "agent.receipt",
                  { requestId: uncertain },
                  scope,
                );
                setError(
                  `请求状态：${receipt.status}。草稿保留；不会自动重发。`,
                );
                if (
                  ["committed", "failed", "not_found"].includes(receipt.status)
                ) {
                  const pending = JSON.parse(
                    sessionStorage.getItem(pendingKey) || "null",
                  );
                  if (
                    receipt.status === "committed" &&
                    pending?.op === "prompt"
                  )
                    clearSubmittedDraft(scope, pending);
                  sessionStorage.removeItem(pendingKey);
                  setUncertain("");
                }
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            核实发送状态（不重发）
          </button>
        )}
        <Usage scope={scope} />
        <Connection extra={error || draft.error} />
      </div>
    </section>
  );
}
function EmptyComposer() {
  return (
    <section className="composer-area">
      <div className="container">
        <form className="composer" onSubmit={(e) => e.preventDefault()}>
          <textarea
            className="textarea"
            id="prompt"
            aria-label="描述你的编码任务"
            placeholder="描述任务或粘贴代码，支持 Markdown 与彩色重点提示…"
            disabled
          />
          <div className="composer-tools">
            <div className="row">
              <button
                className="icon-btn"
                id="attach"
                aria-label="附加文本或代码文件"
                disabled
              >
                <Icon name="plus" />
              </button>
              <ModelPicker />
            </div>
            <button
              className="btn btn-primary send"
              aria-label="发送消息"
              disabled
            >
              <Icon name="arrow" />
            </button>
          </div>
        </form>
        <Usage />
        <Connection />
      </div>
    </section>
  );
}
function Connection({ extra = "" }: { extra?: string }) {
  const status = useConnection();
  return (
    <div className="composer-foot">
      <span className="status" role="status">
        {extra || status}
      </span>
      <span>Enter 发送 · Shift + Enter 换行</span>
    </div>
  );
}
function Usage({ scope }: { scope?: Scope }) {
  const info = useScope(scope ? agentScope(scope) : null, emptyAgent),
    usage = info.usage;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running(info.run)) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [info.run?.id, info.run?.status]);
  const elapsed = info.run
    ? ((info.run.endedAt ?? now) - info.run.startedAt) / 1000
    : null;
  const cacheTotal = usage
    ? usage.input + usage.cacheRead + usage.cacheWrite
    : 0;
  return (
    <div className="usage" aria-label="Token、缓存、耗时与预计花费统计">
      <div className="usage-row">
        <span
          className="usage-metric"
          data-od-id="context-capacity"
          title={
            usage
              ? `主会话累计 Token：${usage.total}；上下文为 pi 估算`
              : "上下文占用：未知"
          }
        >
          <svg className="usage-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3.34 19a10 10 0 1 1 17.32 0" />
            <path className="gauge-needle" d="m12 14 4-4" />
          </svg>
          <strong>{usage?.context?.tokens?.toLocaleString() ?? "—"}</strong>
          <strong>· {usage?.context?.percent?.toFixed(1) ?? "—"}%</strong>
        </span>
        <span
          className="usage-metric"
          data-od-id="cache-tokens"
          title={
            usage
              ? `主会话缓存读取 ${usage.cacheRead} · 写入 ${usage.cacheWrite}`
              : "缓存命中率：未知"
          }
        >
          <svg className="usage-icon" viewBox="0 0 24 24" aria-hidden="true">
            <g className="cache-body">
              <ellipse cx="11" cy="5" rx="8" ry="3" />
              <path d="M3 5v14c0 1.7 3.6 3 8 3M19 5v5M3 12c0 1.7 3.6 3 8 3" />
            </g>
            <path className="cache-bolt" d="m19 12-4 6h4l-1 4 5-7h-4z" />
          </svg>
          <strong>
            {usage && cacheTotal
              ? ((usage.cacheRead / cacheTotal) * 100).toFixed(0)
              : "—"}
            %
          </strong>
        </span>
        <span
          className="usage-metric"
          data-od-id="run-duration"
          title="当前执行耗时（服务端起止时间）"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
          <strong>
            {elapsed != null ? `${Math.max(0, elapsed).toFixed(0)}s` : "—"}
          </strong>
        </span>
        <span
          className="usage-metric"
          data-od-id="estimated-cost"
          title="主会话累计预计费用（pi 定价）；未提供价格显示未知"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 6v12m3-9h-4.5a2 2 0 0 0 0 4h3a2 2 0 0 1 0 4H9" />
          </svg>
          <strong>
            {usage?.cost != null ? `$${usage.cost.toFixed(4)}` : "—"}
          </strong>
        </span>
      </div>
    </div>
  );
}
