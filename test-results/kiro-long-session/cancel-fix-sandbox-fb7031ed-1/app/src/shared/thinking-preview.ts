export type ThinkingPreviewTail = { text: string; start: number };

/** Keep overlapping server tails continuous across transport chunk boundaries. */
export function mergeThinkingPreview(previous: ThinkingPreviewTail, next: ThinkingPreviewTail): ThinkingPreviewTail {
  const overlap = next.start - previous.start;
  let result = next;
  if (overlap >= 0 && overlap <= previous.text.length &&
    next.start + next.text.length >= previous.start + previous.text.length &&
    next.text.startsWith(previous.text.slice(overlap))) {
    result = { start: previous.start, text: previous.text.slice(0, overlap) + next.text };
  }
  // DOM work remains bounded even for an indefinitely streaming thought.
  if (result.text.length > 8192) {
    let drop = result.text.length - 2048;
    const newline = result.text.indexOf("\n", drop);
    if (newline >= 0 && newline < result.text.length - 1) drop = newline + 1;
    const code = result.text.charCodeAt(drop);
    if (code >= 0xdc00 && code <= 0xdfff) drop++;
    result = { start: result.start + drop, text: result.text.slice(drop) };
  }
  return result;
}
