export const memoryBatchSize = 50;
export const memoryBatchWaitMs = 30 * 60_000;
export const memoryDirectoryMaxChars = 1000;
export const memoryContextPurposeLimit = 4;
export const emptyMemoryTree = () => ({ version: 0, roots: [], purposes: [], nameChars: 0, pending: 0, failed: 0 });
export const memoryTreeScope = (workspaceId) => `memory-tree:${workspaceId}`;
// Keep Pi's custom-entry identity, not its old Topic-ID payload or lookup protocol.
export const memoryTopicMessageType = "axiom-memory-topics";
export const memoryTopicSnapshotType = "axiom-memory-topic-snapshot";
export function memoryTopicBlock(roots) {
    const names = roots.map(({ name }) => name).join("\n");
    if (Array.from(names).length > memoryDirectoryMaxChars)
        throw Error("一级记忆目录超过1000字符，拒绝截断");
    return `<记忆关键词目录>\n${names}\n</记忆关键词目录>\n目录仅提示何时查询，不是查询范围或答案依据；需要历史事实时调用memory_query({question})。`;
}
//# sourceMappingURL=memory-tree.js.map