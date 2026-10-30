import { useCallback, useSyncExternalStore } from "react";
import { scopeKey, type Scope, type Session } from "../../shared/protocol.js";
import { sessionListScope } from "../../shared/session-list.js";
import { scopeAuthority, subscribeScope, useConnectionState } from "../transport.js";

function useAuthority<T>(scope: string | null): T | undefined {
  // Connection lifecycle can invalidate facts without notifying an individual scope.
  useConnectionState();
  const listen = useCallback((fn: () => void) => scope ? subscribeScope(scope, fn) : () => {}, [scope]);
  // Observe the fact itself, not just its delivery order: a receipt-only local
  // merge can remove authority without increasing that order.
  return useSyncExternalStore(listen, () => scope ? scopeAuthority<T>(scope) : undefined);
}

/** undefined = not yet authoritative; null = explicitly absent; Session = valid,
 * independently of which title page or search results currently contain it. */
export function useSelectedSession(scope: Scope | null) {
  return useAuthority<Session | null>(scope?.sessionId ? scopeKey(scope) : null);
}

export function useSessionListAuthority() {
  return useAuthority<{ revision: number }>(sessionListScope);
}
