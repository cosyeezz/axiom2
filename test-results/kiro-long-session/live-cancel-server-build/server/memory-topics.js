import { memoryTopicMessageType, memoryTopicSnapshotType } from "../shared/memory-tree.js";
export function validTopicSnapshot(value) {
    const item = value;
    return item?.version === 2 && typeof item.workspaceId === "string" && typeof item.text === "string";
}
/** Restore only the selected branch: abandoned compactions must never advance this snapshot. */
export function topicSnapshot(manager, workspaceId) {
    let snapshot;
    for (const entry of manager.getBranch()) {
        const candidate = entry.type === "custom" && entry.customType === memoryTopicSnapshotType ? entry.data
            : entry.type === "compaction" ? entry.details?.axiomMemoryTopics : undefined;
        if (validTopicSnapshot(candidate) && candidate.workspaceId === workspaceId)
            snapshot = candidate;
    }
    return snapshot;
}
export function ensureTopicSnapshot(manager, initial) {
    const existing = topicSnapshot(manager, initial.workspaceId);
    if (existing)
        return existing;
    manager.appendCustomEntry(memoryTopicSnapshotType, initial);
    return initial;
}
export function injectTopicSnapshot(messages, snapshot) {
    const clean = messages.filter((message) => !(message.role === "custom" && message.customType === memoryTopicMessageType));
    const index = clean[0]?.role === "system" ? 1 : 0;
    return [...clean.slice(0, index), { role: "custom", customType: memoryTopicMessageType, content: snapshot.text, display: false, timestamp: 0 }, ...clean.slice(index)];
}
//# sourceMappingURL=memory-topics.js.map