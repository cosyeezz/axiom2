export interface MemorySource { sessionId: string; path: string; revision: string }
export interface MemoryPurpose {
  id: string; text: string;
  source: { sessionId: string; path: "MEMORY.md"; key: string };
}
export interface MemoryDocumentRef {
  sessionId: string; path: string; title: string; state: string;
  purposeIds: string[]; ancestors: Array<{ title: string; state: string }>;
}
/** Published nodes may have both children and directly associated documents.
 * Numeric database identities are strings at the transport boundary (including "0").
 * purposeId remains only for the legacy organizer's lossless source tree. */
export interface MemoryIndexNode {
  id: string; name: string; children: MemoryIndexNode[]; purposeId?: string;
  titlePath?: string; parentId?: string; depth?: number; ancestorIds?: string[];
  purposeIds?: string[]; documentRefs?: MemoryDocumentRef[];
}
export interface MemoryQueueSummary {
  waiting: number; eligible: number; backoff: number; blocked: number;
  oldestQueuedAt: number | null; nextBatchAt: number | null; retryAt: number | null;
}
export interface MemoryTree {
  version: number; roots: MemoryIndexNode[]; purposes: MemoryPurpose[]; nameChars: number; pending: number; failed: number;
  queue?: MemoryQueueSummary;
  activeBatch?: { processingId: string; purposeIds: string[]; sessionIds: string[] };
}
export interface MemoryTopicSnapshot { version: 2; workspaceId: string; text: string }
export const memoryBatchSize = 50;
export const memoryBatchWaitMs = 30 * 60_000;
export const memoryDirectoryMaxChars = 1000;
export const memoryContextPurposeLimit = 4;
export const emptyMemoryTree = (): MemoryTree => ({ version: 0, roots: [], purposes: [], nameChars: 0, pending: 0, failed: 0 });
export const memoryTreeScope = (workspaceId: string) => `memory-tree:${workspaceId}`;
// Keep Pi's custom-entry identity, not its old Topic-ID payload or lookup protocol.
export const memoryTopicMessageType = "axiom-memory-topics";
export const memoryTopicSnapshotType = "axiom-memory-topic-snapshot";
export function memoryTopicBlock(roots: Array<{ name: string }>) {
  const names = roots.map(({ name }) => name).join("\n");
  if (Array.from(names).length > memoryDirectoryMaxChars) throw Error("一级记忆目录超过1000字符，拒绝截断");
  return `<记忆关键词目录>\n${names}\n</记忆关键词目录>\n目录仅提示何时查询，不是查询范围或答案依据；需要历史事实时调用memory_query({question})。`;
}
