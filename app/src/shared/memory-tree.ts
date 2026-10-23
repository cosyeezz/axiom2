export interface MemoryRecord { topic: string; section: string; item: string; content: string }
export interface MemorySource { sessionId: string; path: string; revision: string }
export interface MemoryTreeItem { id: string; name: string; contents: Array<{ id: string; text: string; sources: MemorySource[] }> }
export interface MemoryTreeSection { id: string; name: string; items: MemoryTreeItem[] }
export interface MemoryTreeTopic { id: string; name: string; sections: MemoryTreeSection[] }
export interface MemoryTree { topics: MemoryTreeTopic[]; nameChars: number }
export interface MemoryTopicSnapshot { version: 1; workspaceId: string; text: string }
export const memoryTreeScope = (workspaceId: string) => `memory-tree:${workspaceId}`;
export const memoryTopicMessageType = "axiom-memory-topics";
export const memoryTopicSnapshotType = "axiom-memory-topic-snapshot";
export function memoryTopicBlock(topics: Array<{ id: string; name: string }>) {
  return `<记忆Topic目录>\n${JSON.stringify(topics.map(({ id, name }) => ({ id, name })))}\n</记忆Topic目录>`;
}
export function parseMemoryRecords(answer: string): MemoryRecord[] {
  let value: unknown;
  try { value = JSON.parse(answer); }
  catch (error) { throw new Error(`整理输出格式错误：模型应直接返回JSON数组，实际返回了无法解析的内容。原始解析错误：${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
  if (!Array.isArray(value)) throw Error("整理结果必须是四字段JSON数组");
  return value.map((record) => {
    if (!record || typeof record !== "object" || Object.keys(record).sort().join(",") !== "content,item,section,topic") throw Error("每条记忆必须恰好包含topic、section、item、content");
    for (const key of ["topic", "section", "item", "content"] as const)
      if (typeof record[key] !== "string" || !record[key].trim()) throw Error("记忆四字段必须是具体非空字符串");
    for (const key of ["topic", "section", "item"] as const)
      if (["其他", "通用", "未分类", "优化", "处理", "开发"].includes(record[key].trim())) throw Error("记忆名称必须具体可区分");
    return { topic: record.topic, section: record.section, item: record.item, content: record.content };
  });
}
