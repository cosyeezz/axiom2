import type { ChatMessage } from "./agent.js";
import { buildCanonicalOccurrences, type CanonicalOccurrenceIndex, type CanonicalSourceInput } from "./canonical-occurrences.js";
import { unarchivedGroups, type HistoryIndex, type ThreadGroup } from "./history.js";

type ReadonlyValue<T> = T extends object ? { readonly [K in keyof T]: ReadonlyValue<T[K]> } : T;
type FullMessages = ReadonlyMap<string, ReadonlyValue<ChatMessage>>;

export interface CanonicalCaptureInput {
  readonly archive: { readonly index: ReadonlyValue<HistoryIndex>; readonly messages: FullMessages };
  /** Existing current-context groups, NOT original-global groups cropped to a suffix. */
  readonly currentGroups: readonly ReadonlyValue<ThreadGroup>[];
  readonly currentMessages: FullMessages;
  readonly transientMessages: FullMessages;
}

export interface CanonicalSourceCapture {
  readonly archive: ReadonlyValue<HistoryIndex>;
  /** Keys are local to this capture object, not wire handles or authorization. */
  readonly sources: readonly ReadonlyValue<CanonicalSourceInput>[];
  readonly occurrences: CanonicalOccurrenceIndex;
  /** A miss is a lookup miss, not domain absence or readiness. */
  readonly message: (id: string) => ReadonlyValue<ChatMessage> | undefined;
}

/** Trusted normalized display data consists of ordinary acyclic records/arrays. */
function snapshot<T>(value: T): ReadonlyValue<T> {
  if (value === null || typeof value !== "object") return value as ReadonlyValue<T>;
  const copy = Array.isArray(value) ? value.map(item => snapshot(item))
    : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, snapshot(item)]));
  return Object.freeze(copy) as ReadonlyValue<T>;
}

function assertFull(key: string, message: ReadonlyValue<ChatMessage>) {
  if (key !== message.id) throw new TypeError("Canonical capture message identity does not match");
  if (message.truncated === true ||
    message.textLength !== undefined && message.textLength !== message.text.length ||
    message.thinkingLength !== undefined && message.thinkingLength !== (message.thinking?.length ?? 0) ||
    message.calls?.some(call => call.inputLength !== undefined && call.inputLength !== call.input.length))
    throw new TypeError("Canonical capture requires complete display messages");
}

/**
 * Capture-local consistency only: the caller must supply complete, trusted adapter
 * products. This cannot establish their native branch/file/cache generation.
 * Full traversal/copying and the occurrence index's full scans remain intentional.
 */
export function captureCanonicalSources(input: CanonicalCaptureInput): CanonicalSourceCapture {
  const winning = new Map<string, ReadonlyValue<ChatMessage>>();
  for (const layer of [input.archive.messages, input.currentMessages, input.transientMessages]) {
    for (const [id, message] of layer) {
      assertFull(id, message);
      winning.set(id, message);
    }
  }
  const messages = new Map([...winning].map(([id, message]) => [id, snapshot(message)]));
  const archive = snapshot(input.archive.index);
  const checkpoints = new Set<string>();
  for (const segment of archive.segments) {
    if (checkpoints.has(segment.id)) throw new TypeError("Canonical capture checkpoints must be unique");
    checkpoints.add(segment.id);
    const compression = messages.get(segment.id)?.compression;
    if (!compression || compression.number !== segment.compression.number ||
      compression.title !== segment.compression.title || compression.before !== segment.compression.before ||
      compression.after !== segment.compression.after)
      throw new TypeError("Canonical capture checkpoint metadata is unavailable or inconsistent");
  }
  const membership = new Set<string>();
  const sources: ReadonlyValue<CanonicalSourceInput>[] = [];
  for (const [segmentOrder, segment] of archive.segments.entries()) {
    const local = new Set<string>();
    for (const id of segment.messageIds) {
      if (checkpoints.has(id) || membership.has(id))
        throw new TypeError("Canonical capture archive membership must be disjoint");
      if (!messages.has(id)) throw new TypeError("Canonical capture archive message is unavailable");
      local.add(id);
      membership.add(id);
    }
    const storage = Object.freeze({ kind: "archive" as const, segmentId: segment.id, segmentOrder });
    for (const group of segment.groups) {
      if (group.ids.some(id => !local.has(id)))
        throw new TypeError("Canonical capture group is outside its archive membership");
      sources.push(Object.freeze({ sourceKey: `source:${sources.length}`, storage, group }));
    }
  }
  const archived = new Set([...checkpoints, ...membership]);
  // This legacy helper only reads its arguments despite its mutable parameter type.
  // Pass our own snapshot, never caller-owned arrays or nested group data.
  const current = snapshot(input.currentGroups);
  const live = unarchivedGroups(current as ThreadGroup[], archived);
  const storage = Object.freeze({ kind: "live" as const });
  for (const group of live)
    sources.push(Object.freeze({ sourceKey: `source:${sources.length}`, storage, group: snapshot(group) }));
  const occurrences = buildCanonicalOccurrences(sources, messages);
  return Object.freeze({ archive, sources: Object.freeze(sources), occurrences,
    message: (id: string) => messages.get(id) });
}
