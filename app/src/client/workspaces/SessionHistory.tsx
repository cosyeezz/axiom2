import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { command, scopeOrder, useScope } from "../transport.js";
import { Icon } from "../components.js";
import { PulseRingsIcon } from "../StatusIcons.js";
import { DeleteButton } from "../DeleteButton.js";
import { ConfirmDialog } from "../ConfirmDialog.js";
import { sessionState } from "../../shared/session-state.js";
import { compareSessions, isPrioritySession, isTopSession } from "./session-order.js";
import type { Scope, Session, Workspace } from "../../shared/protocol.js";
import { useSessionAttention } from "./useSessionAttention.js";
const noSessions: Session[] = [];
export function History({
  workspace,
  workspaces,
  selected,
  select,
  onError,
}: {
  workspace?: Workspace;
  workspaces: Workspace[];
  selected: Scope | null;
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
    if (!workspace || !snapshot) return;
    // A foreign pinned session is valid independently of the sidebar's list.
    if (selected?.sessionId && (!viewedSessions || viewedSessions.some((s) => s.id === selected.sessionId))) return;
    if (selected?.sessionId || sessions[0])
      select({ workspaceId: workspace.id, sessionId: sessions[0]?.id ?? "" });
  }, [snapshot, viewedSessions, selected?.sessionId]);
  // The global top subscription overlaps the current workspace; render each ID once.
  const workspaceOrder = scopeOrder(workspace ? `sessions:${workspace.id}` : ""), pinnedOrder = scopeOrder("pinned-sessions");
  const filtered = useMemo(() => {
    const overlapping = workspaceOrder >= pinnedOrder ? [...pinnedSessions, ...sessions] : [...sessions, ...pinnedSessions];
    return [...new Map([
      ...Object.values(heldRows).map(({ session }) => session), ...overlapping,
    ].map((s) => [s.id, s])).values()]
      .filter((s) => s.title.toLowerCase().includes(query.toLowerCase())).sort(compareSessions);
  }, [sessions, pinnedSessions, heldRows, query, workspaceOrder, pinnedOrder]);
  const groups = useMemo(() => [true, false].map((pinned) => filtered.filter((s) =>
    (heldRows[s.id]?.top ?? isTopSession(s)) === pinned && (pinned || s.workspaceId === workspace?.id))), [filtered, heldRows, workspace?.id]);
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
  const navigation = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancelSelection = () => {
    if (navigation.current !== undefined) { clearTimeout(navigation.current); navigation.current = undefined; hold(false); }
  };
  useEffect(() => () => clearTimeout(navigation.current), []);
  const navigate = (keyboard: boolean) => {
    cancelSelection();
    const apply = () => { navigation.current = undefined; hold(false); select({ workspaceId: s.workspaceId, sessionId: s.id }); };
    if (keyboard) apply();
    else { hold(true); navigation.current = setTimeout(apply, 300); }
  };
  // Hold across the click window, confirmation, and command so live grouping
  // cannot replace the trigger between clicks or leave a deleted row behind.
  useEffect(() => {
    hold(editingRef.current || !!deleting || deletePending || removing);
  }, [deleting, deletePending, removing]);
  useEffect(() => () => hold(false), []);
  const rename = () => {
    cancelSelection();
    if (removingRef.current) return;
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
    hold(false);
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
    const saved = await run("session.rename", { title: nextTitle }, s);
    savingRef.current = false;
    setSaving(false);
    // A delayed acknowledgement must not steal focus from the composer or another row.
    const stillFocused = document.activeElement === input.current;
    if (saved) finish(restoreFocus && stillFocused);
    // On failure keep the draft in place for correction or retry.
    else if (restoreFocus && stillFocused) input.current?.focus();
  };
  const remove = () => { if (!removingRef.current) setDeleting(s); };
  const removeNow = async () => {
    if (removingRef.current) return;
    removingRef.current = true;
    setRemoving(true);
    try {
      await run("session.delete", { confirmed: true }, s);
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
          <PulseRingsIcon className="session-state running" label={state.indicatorLabel}
            title={s.unread ? `${state.label}，有未读结果` : state.label} />
        ) : (
          <PulseRingsIcon className="session-state unread" label={state.indicatorLabel} title={state.label} />
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
          })}{" "}·{" "}
          {state.label}
        </span>
      </small>
      {workspacePath && (
        <small className="session-workspace-path" data-tooltip={workspacePath}>
          <span className="session-detail">{workspacePath}</span>
        </small>
      )}
    </span>
  );
  return (
    <div className="history-row" data-editing={editing} data-session-id={s.id}>
      {deleting && <ConfirmDialog title="删除会话" subject={deleting.title}
        description="停止所属任务并从列表移除；保留对话、记忆与附件，不删除项目文件。" confirmLabel="删除会话" danger
        onClose={() => setDeleting(null)}
        onConfirm={() => command("session.delete", { confirmed: true }, {
          workspaceId: deleting.workspaceId, sessionId: deleting.id,
        })} />}
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
          onClick={(event) => navigate(event.detail === 0)}
          onBlur={cancelSelection}
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
