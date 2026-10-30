import { useCallback, useSyncExternalStore } from "react";
import type { Scope } from "../../shared/protocol.js";
import { threadMetadataScope, type ThreadMetadata } from "../../shared/agent.js";
import { scopeSnapshot, subscribeScope, useConnectionState } from "../transport.js";

/** Full fields can change beyond their bounded preview during a native history rebuild. */
export function useHistoryRevision(scope: Scope) {
  const key = threadMetadataScope(scope);
  const listen = useCallback((notify: () => void) => subscribeScope(key, notify), [key]);
  const revision = useSyncExternalStore(listen, () => scopeSnapshot<ThreadMetadata>(key)?.contextRevision ?? 0);
  const connection = useConnectionState();
  return `${connection.generation}:${revision}`;
}
