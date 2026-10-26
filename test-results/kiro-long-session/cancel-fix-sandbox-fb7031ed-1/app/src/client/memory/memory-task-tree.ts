import type { MemoryNode } from "../../shared/memory-outline.js";

export type MemoryTreeItem = { node: MemoryNode; key: string; children: MemoryTreeItem[] };
/** State, line numbers and revision never change identity. Unique sibling titles
 * are matched within the same parent, which preserves their full ancestry. */
export function reconcileMemoryTree(nodes: MemoryNode[], previous: MemoryTreeItem[], nextKey: () => string): MemoryTreeItem[] {
  const items: MemoryTreeItem[] = nodes.map(node => ({ node, key: "", children: [] })), roots: MemoryTreeItem[] = [];
  items.forEach(item => {
    const parent = item.node.parent;
    if (parent != null && items[parent]) items[parent].children.push(item); else roots.push(item);
  });
  const reconcile = (current: MemoryTreeItem[], old: MemoryTreeItem[]) => {
    const available = new Set(old), matches = new Map<MemoryTreeItem, MemoryTreeItem>();
    const match = (predicate: (a: MemoryTreeItem, b: MemoryTreeItem) => boolean) => {
      for (const item of current) {
        if (matches.has(item)) continue;
        const candidate = [...available].find(other => predicate(item, other));
        if (candidate) { matches.set(item, candidate); available.delete(candidate); }
      }
    };
    match((a, b) => a.node.title.normalize("NFC") === b.node.title.normalize("NFC"));
    for (const item of current) {
      const prior = matches.get(item);
      item.key = prior?.key ?? nextKey();
      reconcile(item.children, prior?.children ?? []);
    }
  };
  reconcile(roots, previous);
  return roots;
}
