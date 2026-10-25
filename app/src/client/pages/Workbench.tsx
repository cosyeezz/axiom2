import { ForkConversation } from "../chat/ForkButton.js";
import { FilePreviewHost } from "../chat/FilePreviewHost.js";
import { guardFileNavigation } from "../file-edit-guard.js";
import { MemoryToolbar } from "../memory/MemoryToolbar.js";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { command, useConnectionState } from "../transport.js";
import { Icon, PanelIcon } from "../components.js";
import {
  scopeKey,
  type Scope,
  type Session,
  type Workspace,
} from "../../shared/protocol.js";
import { AgentThread as Thread } from "../chat/AgentThread.js";
import { Composer, EmptyComposer } from "../chat/Composer.js";
import { OriginalConversationProvider } from "../chat/OriginalConversation.js";
import { TaskViews } from "../tasks/TaskViews.js";
import { History } from "../workspaces/SessionHistory.js";
import { DeletedSessions } from "../workspaces/DeletedSessions.js";
import { WorkspacePicker } from "../workspaces/WorkspacePicker.js";
import { useWorkspaceView } from "../workspaces/useWorkspaceView.js";
import { pickWorkspaceFolder, Title } from "../workspaces/WorkspaceControls.js";
import { TitleFeedback } from "../workspaces/TitleFeedback.js";
import "../styles/workbench.css";
import "../styles/chat.css";
const androidClient = /^#axiom-native=\d+$/.test(location.hash);
export default function Workbench() {
  const [error, setError] = useState("");
  const connection = useConnectionState();
  const [reading, setReading] = useState(() => androidClient || localStorage.getItem("axiom.mobile.reading") === "true");
  const restoreReadingFocus = useRef(false);
  const navigationGuard = useRef<(action: () => void) => void>((action) => action());
  const navigate = (action: () => void) => guardFileNavigation(() => navigationGuard.current(action));
  const toggleReading = () => {
    restoreReadingFocus.current = true;
    setReading((current) => { localStorage.setItem("axiom.mobile.reading", String(!current)); return !current; });
  };
  useLayoutEffect(() => {
    if (restoreReadingFocus.current) {
      restoreReadingFocus.current = false;
      document.querySelector<HTMLButtonElement>(reading ? ".mobile-expand" : ".mobile-reading-toggle")?.focus({ preventScroll: true });
    }
  }, [reading]);
  const { workspaces, workspaceId, view, select: selectView, selectSession, navigation } = useWorkspaceView(setError);
  const [collapsed, setCollapsed] = useState(false),
    [mobileOpen, setMobileOpen] = useState(false);
  const [pickingFolder, setPickingFolder] = useState(false);
  const folderRequest = useRef<AbortController | null>(null);
  useEffect(() => () => folderRequest.current?.abort(), []);
  const chooseFolder = async () => {
    if (folderRequest.current) return;
    const controller = new AbortController();
    folderRequest.current = controller;
    setPickingFolder(true);
    setError("");
    try {
      const path = await pickWorkspaceFolder(controller.signal);
      if (controller.signal.aborted || path === null) return;
      const opened = await command<Workspace>("workspace.open", { path, authorized: true });
      if (controller.signal.aborted) return;
      select({ workspaceId: opened.id, sessionId: "" });
      await create(opened.id);
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      if (folderRequest.current === controller) {
        folderRequest.current = null;
        setPickingFolder(false);
      }
    }
  };
  const mobile = useRef(matchMedia("(max-width:640px), (pointer:coarse) and (max-height:500px)"));
  const [isMobile, setIsMobile] = useState(mobile.current.matches);
  useEffect(() => {
    const change = () => {
      setIsMobile(mobile.current.matches);
      setMobileOpen(false);
    };
    mobile.current.addEventListener("change", change);
    return () => mobile.current.removeEventListener("change", change);
  }, []);
  const restoreHistoryFocus = useRef(false);
  const closeMobileHistory = () => {
    if (!isMobile || !mobileOpen) return;
    restoreHistoryFocus.current = true;
    setMobileOpen(false);
  };
  useLayoutEffect(() => {
    if (isMobile && mobileOpen) document.getElementById("collapse-history")?.focus();
    else if (restoreHistoryFocus.current) {
      restoreHistoryFocus.current = false;
      document.getElementById("toggle-history")?.focus({ preventScroll: true });
    }
  }, [isMobile, mobileOpen]);
  const workspace = workspaces.find((w) => w.id === workspaceId);
  const viewedWorkspace = workspaces.find((w) => w.id === view?.workspaceId);
  const select = (next: Scope) => {
    navigate(() => { selectView(next); closeMobileHistory(); });
  };
  const forking = useRef(false);
  const [forkBusy, setForkBusy] = useState(false);
  const fork = async (scope: Scope, params: Record<string, unknown>, requestId: string, openAfterCreate: boolean) => {
    if (forking.current) return;
    forking.current = true; setForkBusy(true); setError("");
    const startedAt = navigation.current;
    try {
      const session = await command<Session>("agent.fork", params, scope, requestId);
      if (openAfterCreate && navigation.current === startedAt) select({ workspaceId: session.workspaceId, sessionId: session.id });
    } catch (cause) { setError((cause as Error).message); throw cause; }
    finally { forking.current = false; setForkBusy(false); }
  };
  const creatingSessions = useRef(new Set<string>());
  const create = async (id = workspace?.id) => {
    if (!id) {
      void chooseFolder();
      return;
    }
    if (creatingSessions.current.has(id)) return;
    creatingSessions.current.add(id);
    const startedAt = navigation.current;
    try {
      const session = await command<Session>(
        "session.create",
        { reuseEmpty: true },
        { workspaceId: id },
      );
      if (navigation.current === startedAt)
        select({ workspaceId: id, sessionId: session.id });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      creatingSessions.current.delete(id);
    }
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === "k" &&
        !document.querySelector("dialog[open]")
      ) {
        e.preventDefault();
        navigate(() => { void create(); });
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  });
  const expanded = isMobile ? mobileOpen : !collapsed;
  return (
    <div
      className={`app${isMobile ? " mobile-workbench" : ""}${androidClient ? " android-workbench" : ""}${collapsed ? " sidebar-collapsed" : ""}${mobileOpen ? " history-open" : ""}${(isMobile || androidClient) && reading ? " reading-mode" : ""}`}
      id="app"
    >
      <button
        className="backdrop"
        aria-label="关闭历史对话"
        onClick={closeMobileHistory}
      />
      <aside className="sidebar" id="history-sidebar" aria-label="对话历史" inert={isMobile && !mobileOpen} role={isMobile && mobileOpen ? "dialog" : undefined} aria-modal={isMobile && mobileOpen ? true : undefined} onKeyDown={(event) => {
        if (!isMobile || !mobileOpen || event.defaultPrevented || event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeMobileHistory(); }
        if (event.key !== "Tab") return;
        const elements = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),summary')].filter((el) => el.getClientRects().length);
        const first = elements[0], last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}>
        <div className="sidebar-actions">
          <button
            className="new-chat"
            id="new-chat"
            data-view-navigation
            onClick={() => navigate(() => { void create(); })}
          >
            <Icon name="new-chat" />
            <span>新建会话</span>
          </button>
          <button
            className="icon-btn"
            id="collapse-history"
            aria-label="收起侧栏"
            onClick={() => {
              isMobile ? closeMobileHistory() : setCollapsed(true);
              requestAnimationFrame(() =>
                document.getElementById("toggle-history")?.focus(),
              );
            }}
          >
            <PanelIcon />
          </button>
        </div>
        <WorkspacePicker
          workspaces={workspaces}
          workspace={workspace}
          select={(w) => select({ workspaceId: w.id, sessionId: "" })}
          picking={pickingFolder}
          choose={() => void chooseFolder()}
          onError={setError}
        />
        <History
          key={workspace?.id ?? "empty"}
          workspace={workspace}
          workspaces={workspaces}
          selected={view}
          select={(next) => navigate(() => { selectSession(next); closeMobileHistory(); })}
          onError={setError}
        />
        <DeletedSessions />
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
          <Icon className="config-chevron" name="chevron-right" />
        </a>
      </aside>
      <ForkConversation.Provider value={{ busy: forkBusy, fork }}>
      <TaskViews
        key={view ? scopeKey(view) : "empty"}
        scope={view}
        composer={(scope) => (
          <Composer key={scopeKey(scope)} scope={scope} nested />
        )}
      >
        <main className="workspace" id="content" inert={isMobile && mobileOpen}>
          <button className="mobile-expand" aria-label="展开工作台" onClick={toggleReading}><PanelIcon /><span>展开</span></button>
          <header className="topnav">
            <div className="row">
              <button
                className="icon-btn mobile-toggle"
                id="toggle-history"
                aria-label="展开侧栏"
                aria-controls="history-sidebar"
                aria-expanded={expanded}
                onClick={() => {
                  if (isMobile) setMobileOpen(true);
                  else {
                    setCollapsed(false);
                    requestAnimationFrame(() =>
                      document.getElementById("collapse-history")?.focus({ preventScroll: true }),
                    );
                  }
                }}
              >
                <PanelIcon />
              </button>
              <Title workspace={viewedWorkspace} scope={view} onError={setError} />
              {view?.sessionId && <TitleFeedback key={scopeKey(view)} scope={view} />}
            </div>
            <button className="mobile-reading-toggle icon-btn" aria-label="收起工作台，只看对话" onClick={toggleReading}><Icon name="scan" /></button>
          </header>
          {isMobile && !connection.connected && <div className="mobile-connection" role="status">正在恢复连接，已有对话和草稿已保留<a href="/">重新连接</a></div>}
          <FilePreviewHost key={view ? scopeKey(view) : "empty"}>
          <OriginalConversationProvider key={view ? scopeKey(view) : "empty"} scope={view}>
          <Thread
            key={view ? "thread:" + scopeKey(view) : "thread:empty"}
            scope={view}
          />
          <MemoryToolbar key={view ? scopeKey(view) : "empty"} scope={view ?? null} workspaces={workspaces} navigationGuard={navigationGuard}>{(tools) => view?.sessionId && viewedWorkspace ? (
            <Composer key={scopeKey(view)} scope={view} tools={tools} />
          ) : (
            <EmptyComposer
              tools={tools}
              openWorkspace={() => void chooseFolder()}
              picking={pickingFolder}
              onSelect={workspace ? async (selection) => {
                const startedAt = navigation.current;
                const session = await command<Session>(
                  "session.create", { reuseEmpty: true }, { workspaceId: workspace.id },
                );
                const scope = { workspaceId: workspace.id, sessionId: session.id };
                try {
                  await command("agent.model", { selection }, scope);
                } catch (e) {
                  setError((e as Error).message);
                  throw e;
                } finally {
                  if (navigation.current === startedAt) select(scope);
                }
              } : undefined}
            />
          )}</MemoryToolbar>
          </OriginalConversationProvider>
          </FilePreviewHost>
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
      </ForkConversation.Provider>
    </div>
  );
}
