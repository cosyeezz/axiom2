import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../components.js";
import { command, useConnectionState, useScope } from "../transport.js";
import { AppError, type DeletedSession, type DeletedSessionCursor, type DeletedSessionPage } from "../../shared/protocol.js";
import "../styles/deleted-sessions.css";

export function DeletedSessions() {
  const [open, setOpen] = useState(false);
  return (
    <section className="deleted-sessions" aria-label="已删除会话">
      <button type="button" className="deleted-sessions-toggle" aria-expanded={open}
        aria-controls="deleted-session-panel" onClick={() => setOpen(!open)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" /></svg>
        <span>已删除会话</span>
      </button>
      {open && <DeletedSessionList />}
    </section>
  );
}

function loadError(failure: unknown) {
  return failure instanceof AppError && failure.code === "UNKNOWN_OPERATION"
    ? "当前后台尚未支持已删除会话，请在任务结束后重启后台服务。"
    : failure instanceof Error ? failure.message : "加载失败，请重试。";
}

function DeletedSessionList() {
  const revision = useScope<{ revision: number } | null>("deleted-sessions", null);
  const connection = useConnectionState();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<DeletedSession[]>([]);
  const [next, setNext] = useState<DeletedSessionCursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const generation = useRef(0), busy = useRef(false);
  const scroll = useRef<HTMLDivElement>(null), sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const current = ++generation.current;
    setItems([]); setNext(null); setError("");
    scroll.current?.scrollTo({ top: 0 });
    busy.current = connection.connected; setLoading(connection.connected);
    if (!connection.connected) {
      setError("尚未连接后台服务，连接恢复后将自动加载。");
      return () => { ++generation.current; };
    }
    // Notifications invalidate pages; a missing subscription must never block the first read.
    const controller = new AbortController();
    void command<DeletedSessionPage>("deleted-sessions.list", { query }, {}, undefined, controller.signal).then((page) => {
      if (generation.current !== current) return;
      setItems(page.items); setNext(page.next);
    }).catch((failure) => {
      if (generation.current === current) setError(loadError(failure));
    }).finally(() => {
      if (generation.current === current) { busy.current = false; setLoading(false); }
    });
    return () => { ++generation.current; controller.abort(); };
  }, [query, revision, retry, connection.connected, connection.generation]);
  const loadMore = useCallback(() => {
    if (!next || busy.current) return;
    const current = generation.current;
    busy.current = true; setLoading(true); setError("");
    void command<DeletedSessionPage>("deleted-sessions.list", { query, cursor: next }).then((page) => {
      if (generation.current !== current) return;
      setItems((previous) => [...new Map([...previous, ...page.items].map((item) => [item.id, item])).values()]);
      setNext(page.next);
    }).catch((failure) => {
      if (generation.current === current) setError(loadError(failure));
    }).finally(() => {
      if (generation.current === current) { busy.current = false; setLoading(false); }
    });
  }, [next, query]);
  useEffect(() => {
    if (!sentinel.current || !next || loading || error) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMore();
    }, { root: scroll.current, rootMargin: "80px" });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [loadMore, next, loading, error]);
  return (
    <div id="deleted-session-panel" className="deleted-session-panel">
      <div className="search">
        <Icon name="search" />
        <input className="input" type="search" aria-label="搜索已删除会话" placeholder="搜索已删除会话"
          maxLength={200} value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>
      <div className="deleted-session-scroll" ref={scroll}>
        <ul className="deleted-session-list" aria-label="已删除会话列表" aria-busy={loading}>
          {items.map((session) => <DeletedSessionRow key={session.id} session={session} />)}
        </ul>
        {!loading && !error && !items.length && <p className="meta deleted-session-message">{query.trim() ? "没有匹配的已删除会话" : "暂无已删除会话"}</p>}
        {loading && <p className="meta deleted-session-message" role="status">正在加载…</p>}
        {error && <div className="deleted-session-message"><p className="meta" role="alert">{error}</p>
          <button type="button" className="btn" onClick={() => next ? loadMore() : setRetry((value) => value + 1)}>重试</button>
        </div>}
        <div ref={sentinel} className="deleted-session-sentinel" aria-hidden="true" />
      </div>
    </div>
  );
}

function DeletedSessionRow({ session }: { session: DeletedSession }) {
  const [restoring, setRestoring] = useState(false), [error, setError] = useState("");
  const pending = useRef(false);
  const restore = async () => {
    if (pending.current) return;
    pending.current = true; setRestoring(true); setError("");
    try {
      await command("session.restore", {}, { workspaceId: session.workspaceId, sessionId: session.id });
    } catch (failure) { setError((failure as Error).message); }
    finally { pending.current = false; setRestoring(false); }
  };
  return (
    <li className="deleted-session-row" data-deleted-session-id={session.id}>
      <div className="deleted-session-description">
        <strong data-tooltip={session.title}>{session.title}</strong>
        <small data-tooltip={session.workspacePath}>{session.workspaceName}</small>
      </div>
      <button type="button" className="deleted-session-restore" aria-label={`恢复会话：${session.title}`}
        disabled={restoring} onClick={() => void restore()}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4v6h6M4 10a8 8 0 1 1 1 8" /></svg>
        <span>{restoring ? "恢复中" : "恢复"}</span>
      </button>
      {error && <p className="meta deleted-session-error" role="alert">{error}</p>}
    </li>
  );
}
