export type MemoryState = "未开始" | "进行中" | "已完成" | "等待" | "已放弃" | "失败" | "阻塞";
export interface MemoryNode {
  kind: "heading" | "task"; title: string; state?: MemoryState;
  depth: number; line: number; endLine: number; parent: number | null;
  abandoned: boolean; waiting: boolean;
}
export interface MemoryOutline { title: string; titleLine: number | null; nodes: MemoryNode[]; abandonedLines: boolean[] }
// Normalize English headings to the existing persisted/UI states; legacy Chinese and checkboxes remain valid.
const englishStates: Record<string, MemoryState> = {
  "not started": "未开始", "in progress": "进行中", completed: "已完成",
  waiting: "等待", abandoned: "已放弃", failed: "失败",
};
const states = /^(?:~~)?\[(未开始|进行中|已完成|等待|已放弃|失败|已删除|阻塞|not started|in progress|completed|waiting|abandoned|failed|[x ])\]\s*/i;
const stateOf = (value: string): MemoryState => englishStates[value.toLowerCase()] ?? (value === "x" || value === "X" ? "已完成" : value === " " ? "未开始" : value === "已删除" ? "已放弃" : value as MemoryState);
const clean = (value: string) => value.replace(/\s+#+\s*$/, "").replace(states, "").replace(/^~~|~~$/g, "").trim();
/** `body` has fences, comments and footnote definitions blanked without changing line numbers. */
export function memoryOutline(body: string): MemoryOutline {
  const lines = body.split(/\r?\n/), nodes: MemoryNode[] = [], abandonedLines: boolean[] = [];
  const headings: Array<{ index: number; level: number }> = [], lists: Array<{ index: number; indent: number }> = [];
  let title = "", titleLine: number | null = null, seenContent = false, previousBlank = false;
  const close = (stack: Array<{ index: number }>, until: () => boolean, line: number) => {
    while (stack.length && until()) nodes[stack.pop()!.index].endLine = line;
  };
  lines.forEach((line, number) => {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    const list = /^(\s*)[-*+]\s+(.+?)\s*$/.exec(line);
    const indent = line.match(/^\s*/)?.[0].replaceAll("\t", "    ").length ?? 0;
    if (heading) {
      close(lists, () => true, number);
      close(headings, () => headings.at(-1)!.level >= heading[1].length, number);
    } else if (list || line.trim() && previousBlank) close(lists, () => lists.at(-1)!.indent >= indent, number);
    const content = heading?.[2] ?? list?.[2] ?? "", match = states.exec(content);
    const firstTitle = !seenContent && heading?.[1] === "#" && !match;
    if (firstTitle) { title = clean(content); titleLine = number; }
    previousBlank = !line.trim();
    if (line.trim()) seenContent = true;
    const parent = lists.at(-1)?.index ?? headings.at(-1)?.index ?? null;
    const inherited = parent === null ? undefined : nodes[parent];
    const state = match ? stateOf(match[1]) : undefined;
    // A strikethrough alone is display markup, never an inferred execution state.
    const abandoned = !!inherited?.abandoned || state === "已放弃";
    abandonedLines.push(abandoned);
    if (!firstTitle && (heading || list && state)) {
      const node: MemoryNode = { kind: heading ? "heading" : "task", title: clean(content), state,
        depth: inherited ? inherited.depth + 1 : 0, line: number, endLine: lines.length, parent,
        abandoned, waiting: !!inherited?.waiting || state === "等待" || state === "阻塞" };
      const index = nodes.push(node) - 1;
      if (heading) headings.push({ index, level: heading[1].length });
      else lists.push({ index, indent });
    }
  });
  return { title, titleLine, nodes, abandonedLines };
}
