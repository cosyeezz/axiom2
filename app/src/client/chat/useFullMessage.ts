import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../../shared/agent.js";
import type { Scope } from "../../shared/protocol.js";
import { useHistoryRevision } from "./useHistoryRevision.js";
import { detailRead } from "./detail-read.js";

/** Full text belongs to the current preview and history generation, including archived messages. */
export function useFullMessage(scope: Scope, source: ChatMessage | null, automatic = false) {
  const revision = useHistoryRevision(scope);
  const key = JSON.stringify(["full", scope.workspaceId, scope.sessionId, source?.id, source?.detailsRevision, source?.text, source?.thinking, source?.calls, source?.images, source?.error, source?.status, source?.truncated, revision]);
  const current = useRef(key);
  current.current = key;
  const pending = useRef<{ release: () => void } | null>(null);
  const [state, setState] = useState<{ key: string; message?: ChatMessage; loading?: boolean; error?: string }>({ key });
  useEffect(() => () => { pending.current?.release(); pending.current = null; }, [key, automatic]);
  const load = useCallback(async () => {
    if (!source || pending.current) return;
    const read = detailRead<ChatMessage>(key, "message.get", { id: source.id }, scope);
    pending.current = read;
    setState({ key, loading: true });
    try {
      const message = await read.promise;
      if (pending.current === read && current.current === key) setState({ key, message });
    } catch (cause) {
      if (pending.current === read && current.current === key) setState({ key, error: (cause as Error).message });
    } finally {
      read.release();
      if (pending.current === read) pending.current = null;
    }
  }, [key]);
  useEffect(() => { if (automatic) void load(); }, [automatic, load]);
  const visible = state.key === key ? state : undefined;
  return { message: visible?.message, loading: visible?.loading, error: visible?.error, load };
}
