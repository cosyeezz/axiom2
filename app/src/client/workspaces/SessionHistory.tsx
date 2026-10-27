import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { command, isVisuallyRemoved, scopeOrder, useScope } from "../transport.js";
import { Icon } from "../components.js";
import { SessionStatusIcon } from "../StatusIcons.js";
import { DeleteButton } from "../DeleteButton.js";
import { ConfirmDialog } from "../ConfirmDialog.js";
import { sessionState } from "../../shared/session-state.js";
import { compareSessions, isPrioritySession, isTopSession, sessionFamilies } from "./session-order.js";
import type { Scope, Session, Workspace } from "../../shared/protocol.js";
import { useSessionAttention } from "./useSessionAttention.js";
const noSessions: Session[] = [];
export function History({
  workspace,
  workspaces,
  selected,
  preparing = false,
  select,
  recover = select,
  onError,
}: {
  workspace?: Workspace;
  workspaces: Workspace[];
  selected: Scope | null;
  preparing?: boolean;
  recover?: (scope: Scope) => void;
  select: (scope: Scope) => void;
  onError: (error: string) => void;
}) {
  useSessionAttention(selected);
  const snapshot = useScope<Session[] | null>(workspace ? `sessions:${workspace.id}` : null, null);
  const sessions = useMemo(() => [...(snapshot ?? noSessions)].sort(compareSessions), [snapshot]);
  const paths = useMemo(() => new Map(workspaces.map((item) => [item.id, item.path])), [workspaces]);
  const pinnedSessions = useScope<Session[]>("pinned-sessions", noSessions);
  // Keep the viewed session subscribed even if it leaves the global top group.
  const viewedSessions = useScope<Session[] | null>(
    selected ? `sessions:${selected.workspaceId}` : null, null,
  );
  const [query, setQuery] = useState("");
  // Defer crossing groups during editing/confirmation so the row stays mounted.
  const [heldRows, setHeldRows] = useState<Record<string, { session: Session; top: boolean }>>({});
  const holdRow = useCallback((session: Session, top: boolean, hold: boolean) => {
    setHeldRows((previous) => {
      if (!hold && !previous[session.id]) return previous;
      const next = { ...previous };
      if (hold) next[session.id] = { session, top };
      else delete next[session.id];
      return next;
    });
  }, []);
  useEffect(() => {
    if (preparing || !workspace || !snapshot) return;
    // A foreign pinned session is valid independently of the sidebar's list.
    if (selected?.sessionId && (!viewedSessions || viewedSessions.some((s) => s.id === selected.sessionId))) return;
    if (selected?.sessionId || sessions[0])
      recover({ workspaceId: workspace.id, sessionId: sessions[0]?.id ?? "" });
  }, [snapshot, viewedSessions, selected?.sessionId, preparing]);
  // The global top subscription overlaps the current workspace; render each ID once.
  const workspaceOrder = scopeOrder(workspace ? `sessions:${workspace.id}` : ""), pinnedOrder = scopeOrder("pinned-sessions");
  const filtered = useMemo(() => {
    const overlapping = workspaceOrder >= pinnedOrder ? [...pinnedSessions, ...sessions] : [...sessions, ...pinnedSessions];
    return [...new Map([
      ...Object.values(heldRows).map(({ session }) => session), ...overlapping,
    ].map((s) => [s.id, s])).values()]
      .filter((s) => !isVisuallyRemoved(s) && s.title.toLowerCase().includes(query.toLowerCase())).sort(compareSessions);
  }, [sessions, pinnedSessions, heldRows, query, workspaceOrder, pinnedOrder]);
  const groups = useMemo(() => {
    const result: [Session[], Session[]] = [[], []];
    for (const family of sessionFamilies(filtered)) {
      // Keep related titles together even when one member is pinned/active/unread.
      // This only changes presentation; individual saved pin flags stay intact.
      const held = family.map(s => heldRows[s.id]).find(Boolean);
      const top = held?.top ?? family.some(isTopSession);
      result[top ? 0 : 1].push(...family.filter(s => top || s.workspaceId === workspace?.id));
    }
    return result;
  }, [filtered, heldRows, workspace?.id]);
  const run = useCallback(async (
    op: string,
    params: Record<string, unknown>,
    s: Session,
  ) => {
    try {
      await command(op, params, { workspaceId: s.workspaceId, sessionId: s.id });
      return true;
    } catch (e) {
      onError((e as Error).message);
      return false;
    }
  }, [onError]);
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
        {preparing && <div className="history-row" aria-busy="true"><div className="history-item" aria-current="true"><span><strong>新对话</strong><small role="status">正在后台准备…</small></span></div></div>}
        {[true, false].map((pinned) => {
          const rows = groups[pinned ? 0 : 1];
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
                  <HistoryRow
                    key={s.id}
                    session={s}
                    selected={s.id === selected?.sessionId}
                    workspacePath={pinned ? paths.get(s.workspaceId) : undefined}
                    select={select}
                    run={run}
                    top={pinned}
                    onHold={holdRow}
                  />
                ))}
                {!rows.length && (
                  <p className="meta" style={{ padding: 12 }}>
                    {query ? "没有匹配的对话" : workspace ? "暂无其他对话" : "请先打开工作空间"}
                  </p>
                )}
              </section>
            )
          );
        })}
      </div>
    </>
  );
}

const HistoryRow = memo(function HistoryRow({ session: s, selected, workspacePath, select, run, top, onHold }: {
  session: Session;
  selected: boolean;
  workspacePath?: string;
  select: (scope: Scope) => void;
  run: (op: string, params: Record<string, unknown>, session: Session) => Promise<boolean>;
  top: boolean;
  onHold: (session: Session, top: boolean, hold: boolean) => void;
}) {
  const hold = (value: boolean) => onHold(s, top, value);
  const [deleting, setDeleting] = useState<Session | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [removing, setRemoving] = useState(false);
  const removingRef = useRef(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(s.title);
  const [saving, setSaving] = useState(false);
  const editingRef = useRef(false);
  const savingRef = useRef(false);
  const composing = useRef(false);
  const blurredDuringComposition = useRef(false);
  const button = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const pointerNavigation = useRef(false);
  const navigate = (pointer: boolean) => {
    if (pointer) { pointerNavigation.current = true; hold(true); }
    select({ workspaceId: s.workspaceId, sessionId: s.id });
  };
  // Select immediately, but keep the row in its group under the pointer so a
  // read acknowledgement cannot replace the target before double-click rename.
  const leaveRow = () => {
    pointerNavigation.current = false;
    hold(editingRef.current || !!deleting || deletePending || removingRef.current);
  };
  useEffect(() => {
    hold(pointerNavigation.current || editingRef.current || !!deleting || deletePending || removing);
  }, [deleting, deletePending, removing]);
  useEffect(() => () => hold(false), []);
  const rename = () => {
    if (removingRef.current || savingRef.current) return;
    hold(true);
    setTitle(s.title);
    composing.current = false;
    blurredDuringComposition.current = false;
    editingRef.current = true;
    setEditing(true);
  };
  const finish = (restoreFocus: boolean) => {
    editingRef.current = false;
    setEditing(false);
    hold(pointerNavigation.current);
    if (restoreFocus) requestAnimationFrame(() => {
      const target = button.current ?? document.querySelector<HTMLButtonElement>(
        `[data-session-id="${CSS.escape(s.id)}"] button.history-item`,
      );
      target?.focus();
    });
  };
  const save = async (restoreFocus: boolean) => {
    if (!editingRef.current || savingRef.current) return;
    if (composing.current) {
      blurredDuringComposition.current = true;
      return;
    }
    const nextTitle = (input.current?.value ?? title).trim();
    if (!nextTitle || nextTitle === s.title) {
      finish(restoreFocus);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    // Commit the visible title and leave editing immediately. The shared intent
    // overlay rolls back only this field if the background save is rejected.
    const result = run("session.rename", { title: nextTitle }, s);
    finish(restoreFocus);
    await result;
    savingRef.current = false;
    setSaving(false);
  };
  const remove = () => {
    if (removingRef.current) return;
    pointerNavigation.current = false;
    setDeleting(s);
  };
  const removeNow = async () => {
    if (removingRef.current) return;
    removingRef.current = true;
    setRemoving(true);
    try {
      const removed = await run("session.delete", { confirmed: true }, s);
      if (removed) pointerNavigation.current = false;
    } finally {
      removingRef.current = false;
      setRemoving(false);
    }
  };
  const state = sessionState(s);
  const content = (
    <span>
      <span className="session-title-line">
        {isPrioritySession(s) && (state.active || !selected) && (state.active ? (
          <SessionStatusIcon state="running" label={state.indicatorLabel}
            title={s.unread ? `${state.label}，有未读结果` : state.label} />
        ) : (
          <SessionStatusIcon state="unread" label={state.indicatorLabel} title={state.label} />
        ))}
        {editing ? (
          <input
            ref={input}
            className="session-title-input"
            aria-label="会话标题"
            aria-busy={saving}
            autoFocus
            maxLength={120}
            readOnly={saving}
            value={title}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setTitle(e.target.value)}
            onCompositionStart={() => { composing.current = true; }}
            onCompositionEnd={() => {
              composing.current = false;
              if (blurredDuringComposition.current) {
                blurredDuringComposition.current = false;
                void save(false);
              }
            }}
            onBlur={() => { void save(false); }}
            onKeyDown={(e) => {
              if (composing.current || e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === "Enter") {
                e.preventDefault();
                void save(true);
              } else if (e.key === "Escape" && !savingRef.current) {
                e.preventDefault();
                e.stopPropagation();
                finish(true);
              }
            }}
          />
        ) : <strong>{s.title}</strong>}
      </span>
      <small>
        <span className="session-detail">
          {new Date(s.updatedAt).toLocaleString("zh-CN", {
            month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
          })}
        </span>
        <span className="session-message-count" data-tooltip={s.messageCount === undefined ? "消息数量暂不可用" : "用户与助手消息，包含压缩前历史，不含工具结果"}>
          · {s.messageCount ?? "—"} 条消息
        </span>
        <span className="session-detail">· {state.label}</span>
      </small>
      {workspacePath && (
        <small className="session-workspace-path" data-tooltip={workspacePath}>
          <span className="session-detail">{workspacePath}</span>
        </small>
      )}
    </span>
  );
  return (
    <div className="history-row" data-editing={editing} data-session-id={s.id} onPointerLeave={leaveRow}>
      {deleting && <ConfirmDialog title="删除会话" subject={deleting.title}
        description="停止所属任务并从列表移除；保留对话、记忆与附件，不删除项目文件。" confirmLabel="删除会话" danger
        onClose={() => setDeleting(null)}
        onConfirm={() => { setDeleting(null); void removeNow(); }} />}
      {editing ? (
        <div className="history-item" aria-current={selected}>{content}</div>
      ) : (
        <button
          ref={button}
          type="button"
          className="history-item"
          data-view-navigation
          aria-current={selected}
          data-tooltip={`${s.title}${workspacePath ? ` · ${workspacePath}` : ""} · 双击重命名（F2），Delete 删除`}
          onClick={(event) => { if (event.detail < 2) navigate(event.detail > 0); }}
          onDoubleClick={rename}
          onKeyDown={(e) => {
            if (e.key === "F2") { e.preventDefault(); rename(); }
            if (e.key === "Delete") { e.preventDefault(); remove(); }
          }}
        >{content}</button>
      )}
      <div className="session-actions">
        <button
          type="button"
          className="icon-btn session-pin"
          disabled={removing}
          aria-label={`${s.pinned ? "取消置顶" : "置顶会话"}：${s.title}`}
          data-tooltip={s.pinned ? "取消置顶" : "置顶会话"}
          aria-pressed={s.pinned}
          onClick={() => void run("session.pin", { pinned: !s.pinned }, s)}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d={s.pinned ? "M5 5h14M12 10v10m-5-5 5 5 5-5" : "M5 5h14M12 20V10m-5 5 5-5 5 5"} />
          </svg>
        </button>
        <DeleteButton
          className="icon-btn session-delete"
          label={`删除会话：${s.title}`}
          title="删除会话"
          disabled={removing}
          onConfirm={remove}
          onDelete={() => void removeNow()}
          onPendingChange={setDeletePending}
        />
      </div>
    </div>
  );
});
