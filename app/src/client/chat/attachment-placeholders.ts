import type { Attachment, PickedAttachment } from "../../shared/protocol.js";

const prefix = { file: "file", image: "imag", folder: "folder" } as const;
export function assignReferences(text: string, existing: readonly { id?: string }[], items: readonly PickedAttachment[]): Attachment[] {
  const used = new Set([...existing.map((a) => a.id), ...Array.from(text.matchAll(/\[((?:file|imag|folder)[1-9]\d*)\]/g), (m) => m[1])]);
  return items.map((item) => {
    const p = prefix[item.kind];
    const numbers = [...used].filter((id): id is string => !!id && id.startsWith(p)).map((id) => Number(id.slice(p.length)));
    let n = Math.max(0, ...numbers.filter((n) => Number.isSafeInteger(n) && n <= 999999999)) + 1;
    if (n > 999999999) n = 1;
    while (used.has(`${p}${n}`)) n++;
    const id = `${p}${n}`;
    used.add(id);
    return { ...item, id, text: "" };
  });
}
export function removeAttachmentReferences(text: string, ids: readonly string[]) {
  const removed = new Set(ids.map((id) => `[${id}]`));
  return text.replace(/\[(?:file|imag|folder)[1-9]\d*\]/g, (token) => removed.has(token) ? "" : token);
}
