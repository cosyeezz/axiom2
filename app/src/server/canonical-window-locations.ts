import type { CanonicalSourceCapture } from "../shared/canonical-source-capture.js";
import type { WindowLocationPage } from "../shared/thread-window.js";
import type { createWindowIdentity } from "./canonical-window-identity.js";
import type { windowStructure } from "./canonical-window-structure.js";

type Position = { kind: "segment"; h: number } | { kind: "source"; s: number } |
  { kind: "member"; s: number; m: number } | { kind: "call" | "result"; s: number; m: number; c: number };
/** Lazy, complete-cut lookup. Display keys locate eligible current members; they
 * never revive an older cut or authorize reads outside the occurrence's masks.
 * Extra O(sources + members + visible calls) memory, not a memory-bounded index. */
export function windowLocations(capture: CanonicalSourceCapture, structure: ReturnType<typeof windowStructure>, identity: ReturnType<typeof createWindowIdentity>) {
  const index = new Map<string, Position[]>();
  const add = (key: string, position: Position) => { const items = index.get(key); if (items) items.push(position); else index.set(key, [position]); };
  for (const [h, segment] of capture.archive.segments.entries()) add(identity.key("message", segment.id), { kind: "segment", h });
  for (const [s, source] of capture.sources.entries()) {
    const sourceKey = structure.sourceKeys[s]; add(sourceKey, { kind: "source", s });
    for (const [m, id] of source.group.ids.entries()) {
      const fact = capture.occurrences.get(source.sourceKey, m), message = capture.message(id);
      if (!fact || !message) throw new TypeError("Unavailable window location facts");
      const position: Position = { kind: "member", s, m };
      add(identity.key("message", id), position);
      add(identity.key("occurrence", JSON.stringify([sourceKey, id])), position);
      for (let c = 0; c < fact.shape.callsCount; c++) {
        const call = message.calls?.[c];
        if (!call) throw new TypeError("Unavailable window call location");
        add(identity.key("call", call.id), { kind: "call", s, m, c });
        const result = capture.message(`tool-${call.id}`);
        if (result && result.role !== "toolResult") throw new TypeError("Unavailable window result location");
        if (result) add(identity.key("message", result.id), { kind: "result", s, m, c });
      }
    }
  }
  return index as ReadonlyMap<string, readonly Position[]>;
}
export function windowLocation(position: Position, revision: string, capture: CanonicalSourceCapture): WindowLocationPage["items"][number] {
  if (position.kind === "segment") return { kind: "segment", ref: `${revision}_h_${position.h}`, sourceRef: null,
    sourceOrder: null, memberOrder: null, callOrder: null, segmentOrder: position.h };
  const { s } = position, sourceRef = `${revision}_s_${s}`, storage = capture.sources[s].storage;
  const memberOrder = "m" in position ? position.m : null, callOrder = "c" in position ? position.c : null;
  const memberRef = `${revision}_m_${s}_${memberOrder}`;
  const ref = position.kind === "source" ? sourceRef : position.kind === "member" ? memberRef
    : `${memberRef}_c_${callOrder}${position.kind === "result" ? "_r" : ""}`;
  return { kind: position.kind, ref, sourceRef, sourceOrder: s, memberOrder, callOrder,
    segmentOrder: storage.kind === "archive" ? storage.segmentOrder : null };
}
