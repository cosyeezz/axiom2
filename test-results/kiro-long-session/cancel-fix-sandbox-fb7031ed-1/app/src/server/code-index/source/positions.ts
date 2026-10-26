import type { SourceRef } from "../contracts.js";
import { stableId } from "../domain/json.js";
import { requireIndex } from "../domain/errors.js";

export function lineOffsets(text: string): number[] {
  const offsets = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\r") { if (text[i + 1] === "\n") i++; offsets.push(i + 1); }
    else if (text[i] === "\n") offsets.push(i + 1);
  }
  return offsets;
}
export function validBoundary(text: string, offset: number): boolean {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > text.length) return false;
  if (offset === 0 || offset === text.length) return true;
  const previous = text.charCodeAt(offset - 1), next = text.charCodeAt(offset);
  return !(previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) && !(previous === 13 && next === 10);
}
export function positionAt(text: string, offset: number, starts = lineOffsets(text)): SourceRef["range"]["start"] {
  requireIndex(validBoundary(text, offset), "INVALID_INPUT", "源码位置切断了字符或换行。");
  let lo = 0, hi = starts.length;
  while (lo + 1 < hi) { const mid = (lo + hi) >>> 1; if (starts[mid] <= offset) lo = mid; else hi = mid; }
  return { line: lo, character: offset - starts[lo] };
}
export function offsetAt(text: string, position: SourceRef["range"]["start"], starts = lineOffsets(text)): number {
  requireIndex(Number.isSafeInteger(position.line) && Number.isSafeInteger(position.character) && position.line >= 0 && position.line < starts.length && position.character >= 0, "INVALID_INPUT", "源码位置无效。");
  const value = starts[position.line] + position.character;
  const lineEnd = position.line + 1 < starts.length ? starts[position.line + 1] : text.length;
  requireIndex(value <= lineEnd && (position.line + 1 === starts.length || value < lineEnd) && validBoundary(text, value), "INVALID_INPUT", "源码位置超出当前行。");
  return value;
}
export function sourceRef(workspaceId: string, path: string, contentHash: string, text: string, start: number, end: number): SourceRef {
  requireIndex(start <= end, "INVALID_INPUT", "源码范围顺序无效。");
  const starts = lineOffsets(text);
  const range: SourceRef["range"] = { start: positionAt(text, start, starts), end: positionAt(text, end, starts), encoding: "utf-16" };
  // Workspace aliases rebind authorization; identity belongs to the shared index.
  return { id: stableId("src", { path, contentHash, range }), workspaceId, path, contentHash, range };
}
export function refOffsets(text: string, ref: SourceRef): [number, number] {
  const starts = lineOffsets(text), begin = offsetAt(text, ref.range.start, starts), end = offsetAt(text, ref.range.end, starts);
  requireIndex(begin <= end, "INVALID_INPUT", "源码范围顺序无效。");
  return [begin, end];
}
/** Largest legal prefix which fits the actual JSON-escaped UTF-8 representation. */
export function textPageEnd(text: string, start: number, end: number, maxBytes: number): number {
  requireIndex(validBoundary(text, start) && validBoundary(text, end) && start <= end, "INVALID_INPUT", "源码分页范围无效。");
  let at = start, bytes = 2;
  while (at < end) {
    const code = text.codePointAt(at)!;
    const width = code > 0xffff || (code === 13 && text.charCodeAt(at + 1) === 10) ? 2 : 1;
    const cost = width === 2 && code === 13 ? 4 : code === 34 || code === 92 || [8, 9, 10, 12, 13].includes(code) ? 2 : code < 32 ? 6 : code < 128 ? 1 : code < 2048 ? 2 : code <= 0xffff ? 3 : 4;
    if (bytes + cost > maxBytes) break;
    at += width; bytes += cost;
  }
  return at;
}
export function mergeIntervals(intervals: [number, number][], next: [number, number]): [number, number][] {
  const sorted = [...intervals, next].sort((a, b) => a[0] - b[0]);
  const result: [number, number][] = [];
  for (const item of sorted) { const prior = result.at(-1); if (prior && item[0] <= prior[1]) prior[1] = Math.max(prior[1], item[1]); else result.push([...item]); }
  return result;
}
