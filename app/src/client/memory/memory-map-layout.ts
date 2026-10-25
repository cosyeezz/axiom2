import type { MemoryDocumentRef, MemoryIndexNode, MemoryPurpose } from "../../shared/memory-tree.js";
import { memoryNodePath, uniqueMemoryDocuments } from "../../shared/memory-directory.js";

export type MemoryMapNode = {
  id: string; label: string; kind: "Directory" | "Purpose"; parent?: string;
  purpose?: MemoryPurpose; children: MemoryMapNode[];
  titlePath?: string; documents?: MemoryDocumentRef[]; sources?: MemoryPurpose[];
};
export type MapPosition = MemoryMapNode & { x: number; y: number; width: number; side: -1 | 1; branch: number; open: boolean };
export const mapNodeHeight = 64;
const gap = 48, rowGap = 22, rootWidth = 180;
function labelWidth(node: MemoryMapNode) {
  // Keep short topics compact; long titles wrap to two lines instead of creating card-sized columns.
  const text = Array.from(node.label).reduce((width, char) => width + (/[^\u0000-\u00ff]/u.test(char) ? 14 : 7.5), 0);
  return Math.min(216, Math.max(112, text + 30 + (node.documents?.length ? 44 : node.kind === "Purpose" ? 20 : 0)));
}
export function memoryMapNodes(roots: MemoryIndexNode[], purposes: MemoryPurpose[]): MemoryMapNode[] {
  const byId = new Map(purposes.map(purpose => [purpose.id, purpose]));
  const visit = (node: MemoryIndexNode, parent?: string, titles: string[] = []): MemoryMapNode => {
    const purposeIds = node.purposeIds ?? (node.purposeId ? [node.purposeId] : []), parts = [...titles, node.name];
    return { id: node.id, label: node.name, kind: purposeIds.length ? "Purpose" : "Directory", parent,
      purpose: node.purposeId ? byId.get(node.purposeId) : undefined,
      titlePath: node.titlePath ?? memoryNodePath(parts), documents: uniqueMemoryDocuments(node.documentRefs ?? []),
      sources: purposeIds.flatMap(id => byId.has(id) ? [byId.get(id)!] : []),
      children: node.children.map(child => visit(child, node.id, parts)) };
  };
  return roots.map(root => visit(root));
}
/** Measure visible subtrees first, then center each parent over its children. */
export function layoutMemoryMap(roots: MemoryMapNode[], expanded: ReadonlySet<string>, query = "") {
  const search = query.trim().toLocaleLowerCase(), matches = new Set<string>(), heights = new Map<string, number>();
  const measure = (node: MemoryMapNode): number => {
    const children = node.children.map(child => measure(child));
    const match = !search || `${node.label} ${node.purpose?.source.path ?? ""} ${(node.documents ?? []).map(ref => `${ref.title} ${ref.path}`).join(" ")}`.toLocaleLowerCase().includes(search) || node.children.some(child => matches.has(child.id));
    if (!match) return 0;
    matches.add(node.id);
    const shown = (search || expanded.has(node.id)) ? children.filter(Boolean) : [];
    const height = Math.max(mapNodeHeight, shown.reduce((sum, value) => sum + value, 0) + Math.max(0, shown.length - 1) * rowGap);
    heights.set(node.id, height); return height;
  };
  roots.forEach(measure);
  const positions: MapPosition[] = [], sides = { [-1]: 0, [1]: 0 }, assignments: Array<{ node: MemoryMapNode; side: -1 | 1; branch: number; top: number }> = [];
  roots.forEach((node, branch) => {
    if (!matches.has(node.id)) return;
    // Stable branch sides: expanding a branch never moves it across the root.
    const side = branch % 2 === 0 ? 1 : -1;
    assignments.push({ node, side, branch, top: sides[side] }); sides[side] += heights.get(node.id)! + rowGap;
  });
  const height = Math.max(mapNodeHeight, sides[-1] - rowGap, sides[1] - rowGap);
  const place = (node: MemoryMapNode, side: -1 | 1, branch: number, distance: number, top: number) => {
    const size = heights.get(node.id)!, width = labelWidth(node);
    const x = side === 1 ? distance : -distance - width;
    const open = !!search || expanded.has(node.id);
    positions.push({ ...node, x, y: top + size / 2 - mapNodeHeight / 2, width, side, branch, open });
    if (open) {
      let y = top;
      node.children.forEach(child => { if (matches.has(child.id)) { place(child, side, branch, distance + width + gap, y); y += heights.get(child.id)! + rowGap; } });
    }
  };
  assignments.forEach(({ node, side, branch, top }) => place(node, side, branch, rootWidth / 2 + gap, top + (height - (sides[side] - rowGap)) / 2));
  let minX = -rootWidth / 2, maxX = rootWidth / 2;
  positions.forEach(node => { minX = Math.min(minX, node.x); maxX = Math.max(maxX, node.x + node.width); });
  const offsetX = 48 - minX, offsetY = 40;
  positions.forEach(node => { node.x += offsetX; node.y += offsetY; });
  const root = { x: offsetX - rootWidth / 2, y: height / 2 - mapNodeHeight / 2 + offsetY, width: rootWidth };
  const byId = new Map(positions.map(node => [node.id, node]));
  const edges = positions.map(node => {
    const parent = node.parent !== undefined ? byId.get(node.parent) : undefined;
    const from = parent ?? root;
    const x1 = node.side === 1 ? from.x + from.width : from.x, y1 = from.y + mapNodeHeight / 2;
    const x2 = node.side === 1 ? node.x : node.x + node.width, y2 = node.y + mapNodeHeight / 2;
    const bend = Math.abs(x2 - x1) * .5;
    return { id: node.id, branch: node.branch, path: `M ${x1} ${y1} C ${x1 + bend * node.side} ${y1}, ${x2 - bend * node.side} ${y2}, ${x2} ${y2}` };
  });
  return { positions, edges, root, width: maxX - minX + 96, height: height + offsetY * 2 };
}
