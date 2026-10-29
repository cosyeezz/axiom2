import { readFileSync } from "node:fs";
import {
  estimateTokens,
  buildSessionProjection,
  type CompactionEntry,
  type CompactionEntryDraft,
  type SessionEntry,
  type SessionHeader,
  type SessionManager,
  type SessionBeforeCompactEvent,
} from "@earendil-works/pi-coding-agent";

type Reader = Pick<SessionManager, "getHeader" | "getBranch">;
export interface CompressionSnapshot {
  header: SessionHeader;
  entries: SessionEntry[];
}
const bytes = (value: unknown) => JSON.stringify(value);
const copy = <T>(value: T): T => JSON.parse(bytes(value));
const conflict = () => new Error("压缩结果或所属会话无效；未替换上下文。");

// Safety comes from the caller's pi/idle boundary, not from requiring every
// historical tool call to have succeeded. Failed streams and stopped processes
// can leave calls without results; those entries remain valid summary input.
function assertRetainedTools(entries: SessionEntry[], firstKeptEntryId: string) {
  const retained = new Set(entries.slice(entries.findIndex((entry) => entry.id === firstKeptEntryId)).map((entry) => entry.id));
  const calls = new Map<string, string>();
  for (const { sourceEntry, messages } of buildSessionProjection(entries).entries) {
    for (const message of messages) {
      if (message.role === "assistant") {
        for (const block of message.content)
          if (block.type === "toolCall") calls.set(block.id, sourceEntry.id);
      } else if (message.role === "toolResult") {
        const call = calls.get(message.toolCallId);
        // Reject a newly split pair, not an already-incomplete historical turn.
        if (retained.has(sourceEntry.id) && call && !retained.has(call)) throw conflict();
      }
    }
  }
}

export function captureCompression(manager: Reader): CompressionSnapshot {
  const header = manager.getHeader();
  if (!header || header.type !== "session" || !header.id) throw conflict();
  const entries = manager.getBranch();
  return copy({ header, entries });
}

/** Prepare a stopped snapshot before Pi's retained-tail minimum-size check.
 * Use only the effective projection: old archived/omitted raw entries stay out.
 * Pi's public compact() still owns summary prompts, merging and file metadata.
 */
export function prepareFullCompression(
  entries: SessionEntry[], settings: SessionBeforeCompactEvent["preparation"]["settings"],
): SessionBeforeCompactEvent["preparation"] {
  const projection = buildSessionProjection(entries);
  const previous = projection.entries.find(item => item.sourceEntry.type === "compaction" && item.messages.length)?.sourceEntry;
  const preparation: SessionBeforeCompactEvent["preparation"] = {
    firstKeptEntryId: entries.at(-1)?.id ?? "",
    messagesToSummarize: [], turnPrefixMessages: [], isSplitTurn: false,
    tokensBefore: projection.messages.reduce((total, message) => total + estimateTokens(message), 0),
    previousSummary: previous?.type === "compaction" ? previous.summary : undefined,
    fileOps: { read: new Set(), written: new Set(), edited: new Set() }, settings,
  };
  if (previous?.type === "compaction" && !previous.fromHook) {
    const details = previous.details as { readFiles?: unknown; modifiedFiles?: unknown } | undefined;
    if (Array.isArray(details?.readFiles)) for (const file of details.readFiles) if (typeof file === "string") preparation.fileOps.read.add(file);
    if (Array.isArray(details?.modifiedFiles)) for (const file of details.modifiedFiles) if (typeof file === "string") preparation.fileOps.edited.add(file);
  }
  includeAllCompressionMessages(preparation, entries);
  return preparation;
}

/** Pi's zero recent-token budget still retains its final cut point. Include
 * that tail in the full summary without changing the original transcript.
 */
export function includeAllCompressionMessages(preparation: SessionBeforeCompactEvent["preparation"], entries: SessionEntry[]) {
  const messages = buildSessionProjection(entries).entries
    .filter((entry) => entry.sourceEntry.type !== "compaction")
    .flatMap((entry) => entry.messages.filter((message) => message.role !== "system"));
  if (!messages.length) throw new Error("没有可摘要的会话消息。");
  preparation.messagesToSummarize = messages;
  preparation.turnPrefixMessages = [];
  preparation.isSplitTurn = false;
  // Keep native file-list metadata complete when the formerly retained tail
  // contains direct or nested read/write/edit calls.
  const add = (name: string, args: Record<string, unknown>) => {
    if (typeof args?.path !== "string") return;
    if (name === "read") preparation.fileOps.read.add(args.path);
    if (name === "write") preparation.fileOps.written.add(args.path);
    if (name === "edit") preparation.fileOps.edited.add(args.path);
  };
  for (const message of messages) {
    if (message.role === "assistant") {
      for (const block of message.content) if (block.type === "toolCall") add(block.name, block.arguments);
    } else if (message.role === "toolResult") {
      for (const call of message.nestedCalls?.calls ?? []) if (call.arguments) add(call.name, call.arguments);
    }
  }
}

export function hasCompression(manager: Reader, id: string): boolean {
  return manager.getBranch().some((entry) => entry.type === "compaction" &&
    (entry.details as { axiomCompressionId?: string } | undefined)?.axiomCompressionId === id);
}

// SessionManager appends synchronously, but mutates memory before writing. Never
// acknowledge memory alone after a failed disk write (or an unflushed session).
export function compressionPersisted(manager: SessionManager, id: string): boolean {
  const entry = manager.getBranch().find((entry) => entry.type === "compaction" &&
    (entry.details as { axiomCompressionId?: string } | undefined)?.axiomCompressionId === id);
  if (!entry) return false;
  if (!manager.isPersisted()) return true;
  const file = manager.getSessionFile();
  if (!file) return false;
  try {
    return readFileSync(file, "utf8").split("\n").some((line) => line === bytes(entry));
  } catch { return false; }
}

export function compressionDraft(
  manager: Reader, snapshot: CompressionSnapshot, entry: CompactionEntry, id: string,
): CompactionEntryDraft {
  const header = manager.getHeader(), branch = manager.getBranch();
  if (!id || !header || !snapshot?.header || header.id !== snapshot.header.id ||
      !Array.isArray(snapshot.entries) || !entry || entry.type !== "compaction" || !entry.id ||
      typeof entry.summary !== "string" || !entry.summary.trim() ||
      typeof entry.firstKeptEntryId !== "string") throw conflict();
  const capturedIds = new Set(snapshot.entries.map((item) => item.id));
  // Pi's independent safety net may commit while the host summary is in flight.
  // A late snapshot must not replace that newer summary or revive its old tail.
  if (branch.some((item) => item.type === "compaction" && !capturedIds.has(item.id) &&
      !(item.details as { axiomCompressionId?: string } | undefined)?.axiomCompressionId))
    throw new Error("Pi 原生压缩已更新上下文，此前的后台摘要已作废；未覆盖原生压缩结果。");
  // The caller owns the native safe point. Other historical edits retain the
  // host's existing semantics. Locate the tail by identity, not old length.
  const retainNone = entry.firstKeptEntryId === entry.id;
  const keptIndex = snapshot.entries.findIndex((item) => item.id === entry.firstKeptEntryId);
  const kept = snapshot.entries[keptIndex];
  if (!retainNone && (!kept || (kept.type === "message" && kept.message.role === "toolResult")))
    throw conflict();
  const retainedIds = new Set(retainNone ? [] : snapshot.entries.slice(keptIndex).map((item) => item.id));
  const firstKeptEntryId = branch.find((item) => !capturedIds.has(item.id) || retainedIds.has(item.id))?.id ?? null;
  // Validate the retained range too: no standalone tool result may be retained
  // after its corresponding assistant call has disappeared into the summary.
  if (firstKeptEntryId) assertRetainedTools(branch, firstKeptEntryId);
  return {
    type: "compaction",
    summary: entry.summary,
    firstKeptEntryId,
    details: {
      ...(entry.details && typeof entry.details === "object" && !Array.isArray(entry.details)
        ? copy(entry.details) : { nativeDetails: entry.details }),
      axiomCompressionId: id,
    },
    ...(entry.usage ? { usage: copy(entry.usage) } : {}),
  };
}

// Caller must own the session's idle writer gate. No active worker may hold a
// separate SessionManager for this file. Returns false for an already-applied id.
export function applyCompression(
  manager: SessionManager, snapshot: CompressionSnapshot, entry: CompactionEntry, id: string,
): boolean {
  if (!snapshot?.header || manager.getHeader()?.id !== snapshot.header.id) throw conflict();
  if (hasCompression(manager, id)) {
    if (!compressionPersisted(manager, id)) throw conflict();
    return false;
  }
  const draft = compressionDraft(manager, snapshot, entry, id);
  const before = manager.buildSessionProjection().messages.reduce((n, message) => n + estimateTokens(message), 0);
  manager.appendCompaction(draft.summary, draft.firstKeptEntryId, before, draft.details, true, draft.usage);
  if (!compressionPersisted(manager, id)) throw conflict();
  return true;
}
