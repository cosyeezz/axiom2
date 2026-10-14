import type { Draft } from "../../shared/protocol.js";

const references = (text: string) => Array.from(text.matchAll(/\[((?:file|imag|folder)[1-9]\d*)\]/g), (m) => m[1]);
const attachments = (draft: Draft) => [...(draft.attachment ? [draft.attachment] : []), ...(draft.attachments ?? [])];

/** Restore only server-confirmed unconsumed inputs. Keep concurrent typing and
 * rebase each input's local attachment IDs without rewriting another input. */
export function mergeRecalledDrafts(current: Draft, recalled: readonly Draft[]): Draft {
  if (!recalled.length) return current;
  const boundIds = (draft: Draft) => [...attachments(draft).flatMap((a) => a.id ? [a.id] : []), ...(draft.images ?? []).map((i) => i.id)];
  const ids = (draft: Draft) => [...references(draft.text), ...boundIds(draft)];
  const reserved = new Set([current, ...recalled].flatMap(ids));
  const used = new Set(ids(current));
  const restored = recalled.map((draft) => {
    const mapping = new Map<string, string>();
    // Literal references in quoted prose are not attachment bindings.
    for (const id of new Set(boundIds(draft))) {
      let next = id;
      if (used.has(id)) {
        const prefix = id.replace(/\d+$/, "");
        let n = 1;
        while (reserved.has(`${prefix}${n}`)) n++;
        next = `${prefix}${n}`;
        reserved.add(next);
      }
      used.add(next);
      mapping.set(id, next);
    }
    for (const id of references(draft.text)) used.add(mapping.get(id) ?? id);
    return {
      text: draft.text.replace(/\[((?:file|imag|folder)[1-9]\d*)\]/g, (token, id) => mapping.has(id) ? `[${mapping.get(id)}]` : token),
      attachments: attachments(draft).map((a) => ({ ...a, ...(a.id ? { id: mapping.get(a.id)! } : {}) })),
      images: (draft.images ?? []).map((image) => ({ ...image, id: mapping.get(image.id)! })),
    };
  });
  return {
    text: [...restored.map((d) => d.text), current.text].filter(Boolean).join("\n\n"),
    attachment: current.attachment,
    attachments: [...(current.attachments ?? []), ...restored.flatMap((d) => d.attachments)],
    images: [...(current.images ?? []), ...restored.flatMap((d) => d.images)],
  };
}
