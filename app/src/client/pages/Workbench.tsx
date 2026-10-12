import { useEffect, useRef, useState } from "react";
import { command, useScope } from "../transport.js";
import { Icon, PanelIcon } from "../components.js";
import {
  scopeKey,
  type Scope,
  type Session,
  type Workspace,
} from "../../shared/protocol.js";
import { AgentThread as Thread } from "../chat/AgentThread.js";
import { Composer, EmptyComposer } from "../chat/Composer.js";
import { TaskViews } from "../tasks/TaskViews.js";
import { PreviewPanel } from "../preview/PreviewPanel.js";
import { History } from "../workspaces/SessionHistory.js";
import { OpenFolder, Title } from "../workspaces/WorkspaceControls.js";
import "../styles/workbench.css";
import "../styles/chat.css";
const noWorkspaces: Workspace[] = [];
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
  const [previewScope, setPreviewScope] = useState<Scope | null>(null);
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
      <TaskViews
        key={view ? scopeKey(view) : "empty"}
        scope={view}
        composer={(scope) => (
          <Composer key={scopeKey(scope)} scope={scope} nested />
        )}
      >
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
            <button
              className="btn"
              disabled={!view?.sessionId}
              onClick={() => setPreviewScope(view)}
            >
              预览与评论
            </button>
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
      </TaskViews>
      {previewScope && (
        <PreviewPanel
          key={scopeKey(previewScope)}
          scope={previewScope}
          onClose={() => setPreviewScope(null)}
        />
      )}
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
