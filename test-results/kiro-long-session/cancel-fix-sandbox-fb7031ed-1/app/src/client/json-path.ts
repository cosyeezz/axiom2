/** Locate a JSON string value, never a property name. Offsets include its quotes. */
export function jsonPathRange(text: string, start: number, end = start): { start: number; end: number } | undefined {
  const strings = /"(?:[^"\\]|\\.)*"/g;
  for (const match of text.matchAll(strings)) {
    const from = match.index, to = from + match[0].length;
    if (start < from || end > to) continue;
    if (/^\s*:/.test(text.slice(to))) return undefined;
    return { start: from, end: to };
  }
  return undefined;
}
