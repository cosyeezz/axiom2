import type { ImageAttachment } from "../../shared/protocol.js";

/** Never recycle an ID still referenced in the text, including references being read. */
export function nextImageNumber(text: string, images: readonly ImageAttachment[]) {
  const numbers = [...images.map((image) => Number(image.id.match(/\d+$/)?.[0])),
    ...Array.from(text.matchAll(/\[(?:img|imag)([1-9]\d*)\]/g), (match) => Number(match[1]))];
  const used = new Set(numbers.filter((n) => Number.isSafeInteger(n) && n > 0 && n <= 999999999));
  const next = Math.max(0, ...used) + 1;
  if (next <= 999999996) return next; // Leave room for a four-image paste.
  let free = 1;
  while ([0, 1, 2, 3].some((offset) => used.has(free + offset))) free++;
  return free;
}
export function insertImageReferences(text: string, start: number, end: number, ids: string[]) {
  const references = ids.map((id) => `[${id}]`).join(" ");
  return { text: text.slice(0, start) + references + text.slice(end), cursor: start + references.length };
}
export function removeImageReferences(text: string, ids: string[]) {
  const removed = new Set(ids.map((id) => `[${id}]`));
  return text.replace(/\[(?:img|imag)[1-9]\d*\]/g, (token) => removed.has(token) ? "" : token);
}
