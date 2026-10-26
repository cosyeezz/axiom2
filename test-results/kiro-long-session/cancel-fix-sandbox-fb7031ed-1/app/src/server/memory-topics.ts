import type { SessionManager } from "@earendil-works/pi-coding-agent";
import { memoryTopicMessageType, memoryTopicSnapshotType, type MemoryTopicSnapshot } from "../shared/memory-tree.js";
export function validTopicSnapshot(value: unknown): value is MemoryTopicSnapshot {
  const item = value as MemoryTopicSnapshot | undefined;
  return item?.version === 2 && typeof item.workspaceId === "string" && typeof item.text === "string";
}
/** Restore only the selected branch: abandoned compactions must never advance this snapshot. */
export function topicSnapshot(manager: Pick<SessionManager, "getBranch">, workspaceId: string) {
  let snapshot: MemoryTopicSnapshot | undefined;
  for (const entry of manager.getBranch()) {
    const candidate = entry.type === "custom" && entry.customType === memoryTopicSnapshotType ? entry.data
      : entry.type === "compaction" ? (entry.details as { axiomMemoryTopics?: unknown } | undefined)?.axiomMemoryTopics : undefined;
    if (validTopicSnapshot(candidate) && candidate.workspaceId === workspaceId) snapshot = candidate;
  }
  return snapshot;
}
export function ensureTopicSnapshot(manager: SessionManager, initial: MemoryTopicSnapshot) {
  const existing = topicSnapshot(manager, initial.workspaceId);
  if (existing) return existing;
  manager.appendCustomEntry(memoryTopicSnapshotType, initial);
  return initial;
}
export function injectTopicSnapshot<T extends { role: string }>(messages: T[], snapshot: MemoryTopicSnapshot): T[] {
  const clean = messages.filter((message) => !(message.role === "custom" && (message as T & { customType?: string }).customType === memoryTopicMessageType));
  const index = clean[0]?.role === "system" ? 1 : 0;
  return [...clean.slice(0, index), { role: "custom", customType: memoryTopicMessageType, content: snapshot.text, display: false, timestamp: 0 } as unknown as T, ...clean.slice(index)];
}
