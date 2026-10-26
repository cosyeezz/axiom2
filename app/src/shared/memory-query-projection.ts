import { isMemoryTitle, type MemoryIndexNode } from "./memory-tree.js";
import { memoryNodePath } from "./memory-directory.js";

/** Rendering is separate from query validation: migration can still contain
 * duplicate semantic paths which its normalized node publisher must merge. */
export function memorySemanticCatalog(roots: readonly MemoryIndexNode[]) {
  const lines: string[] = [];
  const visit = (node: MemoryIndexNode, depth: number) => {
    if (isMemoryTitle(node)) return;
    lines.push(`${"  ".repeat(depth)}${node.name}`);
    node.children.forEach(child => visit(child, depth + 1));
  };
  roots.forEach(node => visit(node, 0));
  return `目录：\n${lines.join("\n")}`;
}

/** Exactly one model-facing catalog: the complete, untruncated semantic tree.
 * Bindings are copied at capture time and never sent to the matching model. */
export function projectMemoryTree(roots: readonly MemoryIndexNode[]) {
  const bindings = new Map<string, MemoryIndexNode>();
  const visit = (input: MemoryIndexNode, ancestors: string[]) => {
    if (isMemoryTitle(input)) return;
    const parts = [...ancestors, input.name], titlePath = memoryNodePath(parts);
    if (input.titlePath !== undefined && input.titlePath !== titlePath || bindings.has(titlePath))
      throw Error("目录路径不一致或存在歧义");
    const node = structuredClone(input);
    bindings.set(titlePath, node);
    input.children.forEach(child => visit(child, parts));
  };
  roots.forEach(node => visit(node, []));
  const purposeIds = (node: MemoryIndexNode): string[] => [...node.purposeIds ?? (node.purposeId ? [node.purposeId] : []), ...node.children.flatMap(purposeIds)];
  return {
    catalog: memorySemanticCatalog(roots),
    bindings: [...bindings].map(([titlePath, node]) => ({ titlePath, nodeId: node.id, purposeIds: [...new Set(purposeIds(node))] })),
    resolve(answer: string): MemoryIndexNode[] {
      const paths: unknown = JSON.parse(answer);
      if (!Array.isArray(paths) || paths.some(path => typeof path !== "string" || !bindings.has(path)) || new Set(paths).size !== paths.length)
        throw Error("目录匹配必须返回真实、精确且不重复的完整标题路径数组");
      return paths.map(path => structuredClone(bindings.get(path)!));
    },
  };
}
