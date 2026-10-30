import type { ChatMessage, SelectionChange } from "./agent.js";
import type { ThreadGroup } from "./history.js";

type ReadonlyValue<T> = T extends object ? { readonly [K in keyof T]: ReadonlyValue<T[K]> } : T;

export type CanonicalStorage =
  | { readonly kind: "archive"; readonly segmentId: string; readonly segmentOrder: number }
  | { readonly kind: "live" };

export interface CanonicalSourceInput {
  /** Capture-local identity, independent of group.id. Internal IDs are not wire handles. */
  readonly sourceKey: string;
  readonly storage: CanonicalStorage;
  readonly group: ReadonlyValue<ThreadGroup>;
}

export interface CanonicalSourceFact {
  readonly sourceKey: string;
  readonly sourceOrder: number;
  readonly groupId: string;
  readonly storage: CanonicalStorage;
  readonly activity: boolean;
  readonly delivery?: boolean;
  readonly folded?: boolean;
  readonly hasTasks?: boolean;
  readonly hideThinking?: boolean;
  readonly selectionChange?: ReadonlyValue<SelectionChange>;
}

export interface CanonicalOccurrenceShape {
  readonly thinking: boolean;
  /** A logical renderer slot; notice/user structure does not prove nonempty text. */
  readonly body: "none" | "body" | "notice";
  /** A process terminal-attempt entry, not a direct Message error/cancelled footer. */
  readonly outcome: boolean;
  readonly callsCount: number;
}

export interface CanonicalOccurrenceFact {
  readonly source: CanonicalSourceFact;
  readonly memberOrder: number;
  readonly messageId: string;
  /** Null means legacy ownership is unknown, not that absence of an owner is proven. */
  readonly ownerRunId: string | null;
  /** Marks the complete occurrence's logical end, not an arbitrary calls-page end. */
  readonly isLastForMessage: boolean;
  readonly shape: CanonicalOccurrenceShape;
}

export interface CanonicalOccurrenceIndex {
  /** A miss is only an internal lookup miss, never domain absence or readiness authority. */
  readonly get: (sourceKey: string, memberOrder: number) => CanonicalOccurrenceFact | undefined;
}

type MessageShape = {
  role: ChatMessage["role"];
  compression: boolean;
  thinking: boolean;
  processBody: boolean;
  directBody: boolean;
  terminalAttempt: boolean;
  callsCount: number;
  ownerRunId: string | null;
};
type PendingOccurrence = Omit<CanonicalOccurrenceFact, "isLastForMessage">;

function captureSource(input: CanonicalSourceInput, sourceOrder: number): CanonicalSourceFact {
  const group = input.group, change = group.selectionChange;
  const storage: CanonicalStorage = input.storage.kind === "archive"
    ? Object.freeze({ kind: "archive", segmentId: input.storage.segmentId, segmentOrder: input.storage.segmentOrder })
    : Object.freeze({ kind: "live" });
  const selectionChange = change && Object.freeze({
    from: Object.freeze({ provider: change.from.provider, id: change.from.id, thinking: change.from.thinking }),
    to: Object.freeze({ provider: change.to.provider, id: change.to.id, thinking: change.to.thinking }),
  });
  return Object.freeze({ sourceKey: input.sourceKey, sourceOrder, groupId: group.id, storage,
    activity: group.activity, delivery: group.delivery, folded: group.folded, hasTasks: group.hasTasks,
    hideThinking: group.hideThinking, selectionChange });
}

function contributionShape(base: MessageShape, source: CanonicalSourceFact, thinkingOnly: boolean,
  callsOnly: boolean, bodyHidden: boolean): CanonicalOccurrenceShape {
  if (base.compression || base.role === "notice" || source.activity && base.role !== "assistant")
    return Object.freeze({ thinking: false, body: "notice", outcome: false, callsCount: 0 });
  if (base.role === "user")
    return Object.freeze({ thinking: false, body: "body", outcome: false, callsCount: 0 });
  if (!source.activity) return Object.freeze({
    thinking: !source.hideThinking && base.thinking,
    // Direct Message uses raw text truthiness; processSlices below uses trim.
    body: base.directBody ? "body" : "none", outcome: false,
    callsCount: source.hideThinking ? 0 : base.callsCount,
  });
  // Preserve processSlices' conditions even for overlapping lists (T+C => mask 0).
  const allowBody = !(thinkingOnly || callsOnly || bodyHidden);
  return Object.freeze({ thinking: !callsOnly && base.thinking,
    body: allowBody && base.processBody ? "body" : "none",
    outcome: allowBody && !base.processBody && base.terminalAttempt,
    callsCount: thinkingOnly ? 0 : base.callsCount });
}

/**
 * Capture facts from an already complete, ordered, bucket-cropped source sequence.
 * The caller owns canonicalization and same-capture authority; this is not their validator.
 * Construction scans all members and complete text semantics, with O(sources + members +
 * unique messages) indexing memory. No wire/RSS bound or native projection is established.
 */
export function buildCanonicalOccurrences(sources: readonly CanonicalSourceInput[],
  messages: ReadonlyMap<string, ReadonlyValue<ChatMessage>>): CanonicalOccurrenceIndex {
  const pending = new Map<string, PendingOccurrence[]>(), last = new Map<string, PendingOccurrence>();
  const bases = new Map<string, MessageShape>();
  for (const [sourceOrder, input] of sources.entries()) {
    if (pending.has(input.sourceKey)) throw new TypeError("Canonical source keys must be unique");
    const source = captureSource(input, sourceOrder), rows: PendingOccurrence[] = [];
    pending.set(source.sourceKey, rows);
    const seen = new Set<string>(), group = input.group;
    const thinking = new Set(group.thinkingOnlyIds), calls = new Set(group.callsOnlyIds), hidden = new Set(group.bodyHiddenIds);
    for (const [memberOrder, messageId] of group.ids.entries()) {
      if (seen.has(messageId)) throw new TypeError("Canonical source members must be unique");
      seen.add(messageId);
      let base = bases.get(messageId);
      if (!base) {
        const message = messages.get(messageId);
        if (!message) throw new TypeError("Canonical source message is unavailable");
        if (message.id !== messageId) throw new TypeError("Canonical source message identity does not match");
        if (message.role === "toolResult" || message.taskNotice)
          throw new TypeError("Hidden result notifications are not canonical source members");
        base = { role: message.role, compression: !!message.compression,
          thinking: !!(message.thinking || message.thinkingActive),
          processBody: !!(message.text.trim() || message.images?.length),
          directBody: !!(message.text || message.images?.length),
          terminalAttempt: !!(message.error || message.status === "failed" || message.status === "cancelled"),
          callsCount: message.calls?.length ?? 0, ownerRunId: message.runId || null };
        bases.set(messageId, base);
      }
      const row: PendingOccurrence = { source, memberOrder, messageId, ownerRunId: base.ownerRunId,
        shape: contributionShape(base, source, thinking.has(messageId), calls.has(messageId), hidden.has(messageId)) };
      rows.push(row); last.set(messageId, row);
    }
  }
  const captured = new Map<string, readonly CanonicalOccurrenceFact[]>();
  for (const [key, rows] of pending) captured.set(key, Object.freeze(rows.map(row =>
    Object.freeze({ ...row, isLastForMessage: last.get(row.messageId) === row }))));
  return Object.freeze({ get: (sourceKey: string, memberOrder: number) =>
    Number.isSafeInteger(memberOrder) && memberOrder >= 0 ? captured.get(sourceKey)?.[memberOrder] : undefined });
}
