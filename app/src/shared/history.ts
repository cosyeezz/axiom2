import type { ChatMessage, RunOrigin, ThreadIndex } from "./agent.js";
import type { ToolIcon } from "./tool-summary.js";

export type ThreadGroup = NonNullable<ThreadIndex["groups"]>[number];
/** No message bodies or tool arguments in the history catalogue. */
export interface HistoryGroup extends ThreadGroup {
  revision?: string;
  estimatedHeight: number;
  process?: {
    status: "completed" | "failed" | "cancelled";
    calls: number;
    /** Explicit run metadata only; opening history does not create a run. */
    origins?: RunOrigin[];
    failed: number;
    succeeded?: number;
    /** A local tool/thinking disclosure, not evidence of a completed delivery. */
    inline?: boolean;
    /** Task cards must remain visible before delivery, including in archives. */
    hasTasks?: boolean;
    latest?: { name: string; icon: ToolIcon; target: string; status: "completed" | "failed" | "cancelled" | "unknown" };
    preview: string;
  };
}
export interface HistorySegment {
  id: string;
  revision?: string;
  compression: NonNullable<ChatMessage["compression"]>;
  messageIds: string[];
  groups: HistoryGroup[];
}
export interface HistoryIndex {
  revision: string;
  segments: HistorySegment[];
}
/** A retained live suffix must not reuse the archived prefix's identity or part masks. */
export function unarchivedGroups(groups: ThreadGroup[], archived: Set<string>): ThreadGroup[] {
  return groups.flatMap(group => {
    const ids = group.ids.filter(id => !archived.has(id));
    if (!ids.length) return [];
    const retained = new Set(ids);
    const id = ids[0] === group.ids[0] ? group.id
      : group.folded ? `final-process:${ids[0]}` : group.activity ? `process:${ids[0]}` : ids[0];
    return [{ ...group, id, ids,
      ...(group.thinkingOnlyIds ? { thinkingOnlyIds: group.thinkingOnlyIds.filter(id => retained.has(id)) } : {}),
      ...(group.callsOnlyIds ? { callsOnlyIds: group.callsOnlyIds.filter(id => retained.has(id)) } : {}),
      ...(group.bodyHiddenIds ? { bodyHiddenIds: group.bodyHiddenIds.filter(id => retained.has(id)) } : {}),
      ...(ids[0] !== group.ids[0] ? { selectionChange: undefined } : {}),
    }];
  });
}
export interface HistoryRead {
  revision: string;
  messages: ChatMessage[];
}
