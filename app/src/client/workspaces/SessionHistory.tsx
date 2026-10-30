import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { command } from "../transport.js";
import { Icon } from "../components.js";
import { SessionStatusIcon } from "../StatusIcons.js";
import { DeleteButton } from "../DeleteButton.js";
import { ConfirmDialog } from "../ConfirmDialog.js";
import { sessionState } from "../../shared/session-state.js";
import { isPrioritySession } from "./session-order.js";
import type { Scope, Session, Workspace } from "../../shared/protocol.js";
import type { SessionListGroup, SessionListItem } from "../../shared/session-list.js";
import type { VisualAction } from "../optimistic-actions.js";
import { useSessionAttention } from "./useSessionAttention.js";
import { useSessionRecovery } from "./useSessionRecovery.js";
import { useSessionListPages } from "./useSessionListPages.js";
import { useSessionHistoryScroll } from "./useSessionHistoryScroll.js";
import { useSessionListCounts } from "./useSessionListCounts.js";
import { useSessionListProjection } from "./useSessionListProjection.js";
import { applySessionListAction } from "./session-list-projection.js";

const sessionKey = (s: Pick<Session, "workspaceId" | "id">) => JSON.stringify([s.workspaceId, s.id]);
type HeldRow = { raw: SessionListItem; group: SessionListGroup; anchor: number; token: object; mountKey: string };
type RowLeases = {
  register(key: string, token: object, raw: SessionListItem, mountKey: string): () => void;
  current(key: string, token: object): boolean;
  hold(key: string, token: object, value: boolean, group: SessionListGroup, anchor: number): void;
};
export function History({
  workspace,
  workspaces,
  selected,
  preparing = false,
  navigation,
  select,
  recover = select,
  onError,
}: {
  workspace?: Workspace;
  workspaces: Workspace[];
  selected: Scope | null;
  preparing?: boolean;
  navigation: RefObject<number>;
  recover?: (scope: Scope, isCurrent: () => boolean) => void;
  select: (scope: Scope) => void;
  onError: (error: string) => void;
}) {
  useSessionAttention(selected);
  const paths = useMemo(() => new Map(workspaces.map((item) => [item.id, item.path])), [workspaces]);
  useSessionRecovery({ workspaceId: workspace?.id, selected, preparing, navigation, recover, onError });
  const [query, setQuery] = useState("");
  const pages = useSessionListPages(workspace?.id, query, true);
  const historyRoot = useRef<HTMLDivElement>(null);
  const scroll = useSessionHistoryScroll(historyRoot, JSON.stringify([workspace?.id, query]), pages);
  const [heldRows, setHeldRows] = useState<ReadonlyMap<string, HeldRow>>(() => new Map());
  const held = useRef(heldRows);
  // Only currently mounted rows are registered. Their raw baselines can receive
  // completed fields before a later acquire; no old page or pending row is cached.
  const mounted = useRef(new Map<string, { token: object; raw: SessionListItem; mountKey: string }>());
  const revoked = useRef(new WeakSet<object>());
  const active = useRef(true);
  useLayoutEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  const publishHeld = useCallback((next: ReadonlyMap<string, HeldRow>) => {
    held.current = next;
    if (active.current) setHeldRows(next);
  }, []);
  const leases = useMemo<RowLeases>(() => ({
    register(key, token, raw, mountKey) {
      if (revoked.current.has(token)) return () => {};
      mounted.current.set(key, { token, raw, mountKey });
      return () => {
        if (mounted.current.get(key)?.token !== token) return;
        mounted.current.delete(key);
        if (held.current.get(key)?.token === token) {
          const next = new Map(held.current); next.delete(key); publishHeld(next);
        }
      };
    },
    current: (key, token) => mounted.current.get(key)?.token === token && !revoked.current.has(token),
    hold(key, token, value, group, anchor) {
      const registration = mounted.current.get(key);
      if (registration?.token !== token || revoked.current.has(token)) return;
      const previous = held.current.get(key);
      if (value) {
        if (previous) return; // Never recapture a pending-projected whole summary.
        const next = new Map(held.current);
        next.set(key, { raw: registration.raw, group, anchor, token, mountKey: registration.mountKey }); publishHeld(next);
      } else if (previous?.token === token) {
        const next = new Map(held.current); next.delete(key); publishHeld(next);
      }
    },
  }), [publishHeld]);
  const completed = useCallback((action: VisualAction) => {
    for (const [key, registration] of mounted.current) {
      const raw = applySessionListAction(registration.raw, action);
      if (!raw) { revoked.current.add(registration.token); mounted.current.delete(key); }
      else if (raw !== registration.raw) mounted.current.set(key, { ...registration, raw });
    }
    let next: Map<string, HeldRow> | undefined;
    for (const [key, entry] of held.current) {
      const raw = applySessionListAction(entry.raw, action);
      if (raw === entry.raw) continue;
      next ??= new Map(held.current);
      if (raw) next.set(key, { ...entry, raw });
      else { revoked.current.add(entry.token); next.delete(key); }
    }
    if (next) publishHeld(next);
  }, [publishHeld]);
  const acceptServer = useCallback((rows: readonly SessionListItem[]) => {
    const server = new Map(rows.map(row => [sessionKey(row), row]));
    for (const [key, registration] of mounted.current) {
      const raw = server.get(key);
      if (raw && raw !== registration.raw) mounted.current.set(key, { ...registration, raw });
    }
    let next: Map<string, HeldRow> | undefined;
    for (const [key, entry] of held.current) {
      const raw = server.get(key);
      if (!raw || raw === entry.raw) continue; // Absence from a page is not deletion.
      next ??= new Map(held.current); next.set(key, { ...entry, raw });
    }
    if (next) publishHeld(next);
  }, [publishHeld]);
  const heldAdapter = useMemo(() => ({ rows: [...heldRows.values()].map(entry => entry.raw), completed, acceptServer }), [heldRows, completed, acceptServer]);
  const projection = useSessionListProjection(pages, heldAdapter);
  type Slot = { key: string; session: SessionListItem; raw: SessionListItem; hidden: boolean };
  const groups: Record<SessionListGroup, Slot[]> = { top: [], workspace: [] };
  const rawRows = new Map([...(pages.state.top.page?.items ?? []), ...(pages.state.workspace.page?.items ?? [])].map(row => [sessionKey(row), row]));
  const seen = new Set(heldRows.keys());
  for (const group of ["top", "workspace"] as const) {
    for (const row of projection[group]) {
      const key = sessionKey(row);
      // A non-interactive row can change render keys at a held boundary. Hand
      // its committed, completed-field baseline to the replacement, not page A.
      const raw = mounted.current.get(key)?.raw ?? rawRows.get(key);
      if (seen.has(key) || !raw) continue;
      seen.add(key); groups[group].push({ key, session: row, raw, hidden: false });
    }
  }
  const heldProjection = new Map(projection.held.map(row => [sessionKey(row), row]));
  for (const [key, entry] of [...heldRows].sort((a, b) => a[1].anchor - b[1].anchor)) {
    const row = heldProjection.get(key), rows = groups[entry.group];
    // Pending delete hides the SAME instance. Only its completed receipt revokes
    // the lease; failure can restore an off-page row without remounting it.
    rows.splice(Math.min(entry.anchor, rows.length), 0, { key, session: row ?? entry.raw, raw: entry.raw, hidden: !row });
  }
  const rowsStamp = JSON.stringify([groups.top.map(row => [row.key, row.hidden]), groups.workspace.map(row => [row.key, row.hidden]), [...heldRows.keys()]]);
  const counts = useSessionListCounts(historyRoot, workspace?.id, query, rowsStamp);
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
      <div className="history" id="history" ref={historyRoot} onScroll={scroll.onScroll}>
        {pages.state.error && <p className="meta history-list-error" role="alert">
          会话列表加载失败：{pages.state.error.message}
          <button type="button" aria-label="重试会话列表" disabled={!pages.enabled || pages.state.loading} onClick={() => void pages.refresh()}>重试</button>
        </p>}
        {workspace && !pages.enabled && !pages.state.loading && <p className="meta" role="status">已离线，显示已加载会话</p>}
        {preparing && <div className="history-row" aria-busy="true"><div className="history-item" aria-current="true"><span><strong>新对话</strong><small role="status">正在后台准备…</small></span></div></div>}
        {(["top", "workspace"] as const).map(group => {
          const rows = groups[group], frame = pages.state[group];
          const label = group === "top" ? "置顶会话" : "当前空间对话";
          const busy = !pages.enabled || pages.state.loading || frame.loading || pages.epoch !== pages.acceptedEpoch;
          let leftHeld: string | null = null;
          return <section className="history-group" key={group} aria-label={label} aria-busy={pages.state.loading || frame.loading}>
            <div className="group-label">{group === "top" ? "置顶" : "对话记录"}</div>
            {frame.error && <p className="meta history-list-error" role="alert">
              继续加载失败：{frame.error.message}
              <button type="button" aria-label={`${label}：重试加载`} disabled={busy} onClick={() => void pages.next(group)}>重试</button>
            </p>}
            {rows.map((row, anchor) => {
              const lease = heldRows.get(row.key);
              // Crossing a held boundary may remount a NORMAL row, but must not
              // remove/reinsert the pressed or focused DOM and lose native click.
              const mountKey = lease?.mountKey ?? JSON.stringify([row.key, leftHeld]);
              if (lease) leftHeld = row.key;
              const count = counts.values.get(row.key);
              const messageCount = count ? count.messageCount : counts.invalidated ? undefined : row.session.messageCount;
              return <HistoryRow key={mountKey} mountKey={mountKey} rowKey={row.key} session={row.session} raw={row.raw}
                messageCount={messageCount} countStale={count?.stale ?? false}
                group={group} anchor={anchor} hidden={row.hidden} leases={leases}
                selected={row.session.id === selected?.sessionId && row.session.workspaceId === selected.workspaceId}
                workspacePath={group === "top" ? paths.get(row.session.workspaceId) : undefined} select={select} run={run} />;
            })}
            <div ref={scroll[group]} className="history-load-tail" data-history-tail={group} aria-hidden="true" />
            {!rows.some(row => !row.hidden) && !pages.state.loading && <p className="meta" style={{ padding: 12 }}>
              {query ? "没有匹配的对话" : !workspace ? "请先打开工作空间" : group === "top" ? "暂无置顶会话" : "暂无其他对话"}
            </p>}
          </section>;
        })}
      </div>
    </>
  );
}

const HistoryRow = memo(function HistoryRow({ session: s, messageCount, countStale, raw, rowKey, mountKey, group, anchor, hidden, leases, selected, workspacePath, select, run }: {
  session: SessionListItem;
  messageCount: number | undefined;
  countStale: boolean;
  raw: SessionListItem;
  rowKey: string;
  mountKey: string;
  group: SessionListGroup;
  anchor: number;
  hidden: boolean;
  leases: RowLeases;
  selected: boolean;
  workspacePath?: string;
  select: (scope: Scope) => void;
  run: (op: string, params: Record<string, unknown>, session: Session) => Promise<boolean>;
}) {
  const token = useRef<object>({}).current;
  const initialRaw = useRef(raw);
  useLayoutEffect(() => leases.register(rowKey, token, initialRaw.current, mountKey), [leases, rowKey, token, mountKey]);
  const current = () => leases.current(rowKey, token);
  const root = useRef<HTMLDivElement>(null);
  const [deleting, setDeleting] = useState<Session | null>(null);
  const [removing, setRemoving] = useState(false);
  const removingRef = useRef(false);
  const confirming = useRef(false);
  const deletePending = useRef(false);
  const pinning = useRef(0);
  const focused = useRef(false);
  const restoring = useRef(false);
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
  const hold = () => leases.hold(rowKey, token, pointerNavigation.current || focused.current || restoring.current || editingRef.current ||
    savingRef.current || pinning.current > 0 || confirming.current || deletePending.current || removingRef.current, group, anchor);
  const restoreButton = () => {
    if (!current() || root.current?.hidden) return;
    button.current?.focus({ preventScroll: true });
    focused.current = !!root.current?.contains(document.activeElement);
  };
  useLayoutEffect(() => {
    if (hidden) {
      // The confirmation is a body portal, so hiding the row alone cannot hide it.
      confirming.current = false;
      setDeleting(null);
    } else if (restoring.current) {
      restoring.current = false;
      restoreButton(); hold();
    }
  }, [hidden, removing]);
  const navigate = (pointer: boolean) => {
    if (pointer) pointerNavigation.current = true;
    hold();
    select({ workspaceId: s.workspaceId, sessionId: s.id });
  };
  const leaveRow = () => { pointerNavigation.current = false; hold(); };
  const rename = () => {
    if (hidden || removingRef.current || savingRef.current || !current()) return;
    editingRef.current = true; hold();
    setTitle(s.title);
    composing.current = false;
    blurredDuringComposition.current = false;
    setEditing(true);
  };
  const finish = (restoreFocus: boolean) => {
    editingRef.current = false;
    setEditing(false);
    if (restoreFocus) restoring.current = true;
    hold();
    if (restoreFocus) requestAnimationFrame(() => {
      if (!current()) return;
      restoring.current = false;
      restoreButton(); hold();
    });
  };
  const save = async (restoreFocus: boolean) => {
    if (!editingRef.current || savingRef.current || !current()) return;
    if (composing.current) {
      blurredDuringComposition.current = true;
      return;
    }
    const nextTitle = (input.current?.value ?? title).trim();
    if (!nextTitle || nextTitle === s.title) { finish(restoreFocus); return; }
    savingRef.current = true; setSaving(true); hold();
    const result = run("session.rename", { title: nextTitle }, s);
    finish(restoreFocus);
    await result;
    savingRef.current = false;
    if (current()) { setSaving(false); hold(); }
  };
  const remove = () => {
    if (hidden || removingRef.current || !current()) return;
    pointerNavigation.current = false;
    confirming.current = true; hold();
    setDeleting(s);
  };
  const closeDelete = () => { confirming.current = false; setDeleting(null); hold(); };
  const removeNow = async () => {
    if (hidden || removingRef.current || !current()) return;
    removingRef.current = true; setRemoving(true); hold();
    try {
      const removed = await run("session.delete", { confirmed: true }, s);
      if (removed) pointerNavigation.current = false;
      // Recover the hidden trigger only if the user has not focused elsewhere.
      else if (current() && document.activeElement === document.body) restoring.current = true;
    } finally {
      removingRef.current = false;
      if (current()) { setRemoving(false); hold(); }
    }
  };
  const pin = async () => {
    if (hidden || removingRef.current || !current()) return;
    pinning.current++; hold();
    try { await run("session.pin", { pinned: !s.pinned }, s); }
    finally { pinning.current--; if (current()) hold(); }
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
        <span className="session-message-count" aria-busy={countStale} data-tooltip={countStale ? "正在刷新消息数量" : messageCount === undefined ? "消息数量暂不可用" : "用户与助手消息，包含压缩前历史，不含工具结果"}>
          · {messageCount ?? "—"} 条消息
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
    <div ref={root} className="history-row" data-editing={editing} data-session-id={s.id} data-workspace-id={s.workspaceId}
      data-family-id={s.familyId} data-family-top={s.familyTop} hidden={hidden} inert={hidden} style={hidden ? { display: "none" } : undefined}
      onPointerDownCapture={event => { if (event.button === 0 && !hidden) { pointerNavigation.current = true; hold(); } }}
      onPointerLeave={leaveRow}
      onFocusCapture={event => { focused.current = !!root.current?.contains(event.target as Node); hold(); }}
      onBlurCapture={() => queueMicrotask(() => { if (current()) { focused.current = !!root.current?.contains(document.activeElement); hold(); } })}>
      {deleting && !hidden && <ConfirmDialog title="删除会话" subject={deleting.title}
        description="停止所属任务并从列表移除；保留对话、记忆与附件，不删除项目文件。" confirmLabel="删除会话" danger
        onClose={closeDelete}
        onConfirm={() => { confirming.current = false; setDeleting(null); void removeNow(); }} />}
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
          disabled={removing || hidden}
          aria-label={`${s.pinned ? "取消置顶" : "置顶会话"}：${s.title}`}
          data-tooltip={s.pinned ? "取消置顶" : "置顶会话"}
          aria-pressed={s.pinned}
          onClick={() => void pin()}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d={s.pinned ? "M5 5h14M12 10v10m-5-5 5 5 5-5" : "M5 5h14M12 20V10m-5 5 5-5 5 5"} />
          </svg>
        </button>
        <DeleteButton
          className="icon-btn session-delete"
          label={`删除会话：${s.title}`}
          title="删除会话"
          disabled={removing || hidden}
          onConfirm={remove}
          onDelete={() => void removeNow()}
          onPendingChange={value => { deletePending.current = value; hold(); }}
        />
      </div>
    </div>
  );
});
