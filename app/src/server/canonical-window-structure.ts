import type { CanonicalSourceCapture } from "../shared/canonical-source-capture.js";
import { taskToolName } from "../shared/tasks.js";
import type { createWindowIdentity } from "./canonical-window-identity.js";

/** Whole-cut topology, never rebuilt from loaded pages. Source keys are bucket
 * identities; a compaction may move a source while retaining its message keys.
 * No body tokens, call arguments, summary/title text or estimated row heights.
 * O(sources + members + calls + archived members), not a CPU/RSS bound. */
export function windowStructure(capture: CanonicalSourceCapture, identity: ReturnType<typeof createWindowIdentity>) {
  const sourceKeys: string[] = [], duplicates = new Map<string, number>();
  function* facts(): Generator<string> {
    yield JSON.stringify(["segments", capture.archive.segments.length]);
    for (const segment of capture.archive.segments) {
      yield JSON.stringify([segment.id, segment.messageIds.length]);
      for (const id of segment.messageIds) yield id;
    }
    yield JSON.stringify(["sources", capture.sources.length]);
    for (const source of capture.sources) {
      const group = source.group;
      const bucket = JSON.stringify([source.storage.kind, source.storage.kind === "archive" ? source.storage.segmentId : null, group.id]);
      const duplicate = duplicates.get(bucket) ?? 0; duplicates.set(bucket, duplicate + 1);
      const key = identity.key("source", JSON.stringify([bucket, duplicate])); sourceKeys.push(key);
      yield JSON.stringify([key, group.ids.length, !!group.activity, !!group.delivery, !!group.folded, !!group.hasTasks,
        !!group.hideThinking, !!group.selectionChange]);
      for (const [order, id] of group.ids.entries()) {
        const fact = capture.occurrences.get(source.sourceKey, order), message = capture.message(id);
        if (!fact || !message) throw new TypeError("Unavailable window structure facts");
        yield JSON.stringify([id, message.role, fact.ownerRunId, fact.isLastForMessage,
          fact.shape.thinking, fact.shape.body, fact.shape.outcome, fact.shape.callsCount]);
        for (let i = 0; i < fact.shape.callsCount; i++) {
          const call = message.calls?.[i];
          if (!call) throw new TypeError("Unavailable window call structure");
          yield JSON.stringify([call.id, taskToolName(call.name)]);
        }
      }
    }
  }
  const version = identity.version("structure-v1", facts());
  return Object.freeze({ version, sourceKeys: Object.freeze(sourceKeys) });
}
