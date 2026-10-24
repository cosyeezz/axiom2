export type MemoryState = "未开始" | "进行中" | "已完成" | "等待" | "已放弃" | "失败" | "阻塞";
export interface MemoryNode {
  kind: "heading" | "task"; title: string; state?: MemoryState;
  depth: number; line: number; endLine: number; parent: number | null;
  abandoned: boolean; waiting: boolean; details: number[];
}
export interface MemoryOutline { title: string; titleLine: number | null; nodes: MemoryNode[]; abandonedLines: boolean[] }
export const detailFile = "references/details.md";
export const detailIds = (text: string) => [...new Set([...text.matchAll(/〔([1-9]\d*)〕/g)].map(match => Number(match[1])).filter(Number.isSafeInteger))];
const states = /^(?:~~)?\[(未开始|进行中|已完成|等待|已放弃|失败|已删除|阻塞|[xX ])\]\s*/;
const stateOf = (value: string): MemoryState => value === "x" || value === "X" ? "已完成" : value === " " ? "未开始" : value === "已删除" ? "已放弃" : value as MemoryState;
const clean = (value: string) => value.replace(states, "").replace(/〔[1-9]\d*〕/g, "").replace(/^~~|~~$/g, "").replace(/\s+#+\s*$/, "").trim();
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
        abandoned, waiting: !!inherited?.waiting || state === "等待" || state === "阻塞", details: detailIds(content) };
      const index = nodes.push(node) - 1;
      if (heading) headings.push({ index, level: heading[1].length });
      else lists.push({ index, indent });
    }
  });
  return { title, titleLine, nodes, abandonedLines };
}

export interface DetailBlock { id: number; content: string; start: number; end: number }
/** Fail closed: never return the remainder of a damaged file as a detail. */
export function parseDetailBlocks(document: string): DetailBlock[] {
  const blocks: DetailBlock[] = [], seen = new Set<number>();
  let open: { id: number; start: number; body: number } | undefined;
  for (const match of document.matchAll(/^<!-- detail:([1-9]\d*):(start|end) -->\r?$/gm)) {
    const id = Number(match[1]);
    if (!Number.isSafeInteger(id)) throw Error("详情编号无效");
    if (match[2] === "start") {
      if (open || seen.has(id)) throw Error("详情边界重复或嵌套");
      open = { id, start: match.index, body: match.index + match[0].length };
      seen.add(id);
    } else {
      if (!open || open.id !== id) throw Error("详情边界不匹配");
      blocks.push({ id, content: document.slice(open.body, match.index).replace(/^\r?\n/, "").replace(/\r?\n$/, ""), start: open.start, end: match.index + match[0].length });
      open = undefined;
    }
  }
  if (open || (document.match(/<!--\s*detail:/g)?.length ?? 0) !== blocks.length * 2) throw Error("详情边界缺失或损坏");
  return blocks;
}
