// Bound a click to one sentence (prose) or one line (code). Explicit selections
// bypass this function and preserve the exact characters selected by the user.
export function detailBounds(text: string, offset: number, code = false): [number, number] {
  const point = Math.min(Math.max(0, offset), Math.max(0, text.length - 1));
  const boundary = (i: number) => text[i] === "\n" || (!code && (/[。！？!?；;]/u.test(text[i]) ||
    (text[i] === "." && (i + 1 === text.length || /\s/u.test(text[i + 1])))));
  let start = point, end = point;
  while (start > 0 && !boundary(start - 1)) start--;
  while (end < text.length && !boundary(end)) end++;
  if (end < text.length && text[end] !== "\n") end++;
  while (start < end && /\s/u.test(text[start])) start++;
  while (end > start && /\s/u.test(text[end - 1])) end--;
  return [start, end];
}

function textNodes(root: HTMLElement) {
  return document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (node) =>
    node.parentElement?.closest("button,.code-head,.markdown-image") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
}
export function textRange(root: HTMLElement, start: number, end: number): Range | null {
  if (start < 0 || end <= start) return null;
  const walker = textNodes(root);
  const range = document.createRange();
  let node: Node | null, cursor = 0, started = false;
  while ((node = walker.nextNode())) {
    const length = node.textContent?.length ?? 0;
    if (!started && start < cursor + length) { range.setStart(node, start - cursor); started = true; }
    if (started && end <= cursor + length) { range.setEnd(node, end - cursor); return range; }
    cursor += length;
  }
  return null;
}
export function rangeOffsets(root: HTMLElement, range: Range): [number, number] {
  const offset = (container: Node, index: number) => {
    const boundary = document.createRange(); boundary.setStart(container, index); boundary.collapse(true);
    const walker = textNodes(root);
    let node: Node | null, total = 0;
    while ((node = walker.nextNode())) {
      if (node === container) return total + index;
      const length = node.textContent?.length ?? 0;
      if (boundary.comparePoint(node, length) <= 0) total += length;
      else break;
    }
    return total;
  };
  return [offset(range.startContainer, range.startOffset), offset(range.endContainer, range.endOffset)];
}
export function clickedDetail(root: HTMLElement, target: HTMLElement, x?: number, y?: number): Range | null {
  const leaf = target.closest("p,li,th,td,pre,h1,h2,h3,h4,h5,h6") as HTMLElement | null;
  const content = leaf && root.contains(leaf) ? leaf : root.querySelector<HTMLElement>("p,li,th,td,pre,h1,h2,h3,h4,h5,h6") ?? root;
  const caret = x === undefined || y === undefined ? null : document.caretRangeFromPoint(x, y);
  let point = 0;
  if (caret && content.contains(caret.startContainer)) point = rangeOffsets(content, caret)[0];
  const text = content.textContent ?? "";
  const [start, end] = detailBounds(text, point, content.tagName === "PRE");
  return textRange(content, start, end);
}
